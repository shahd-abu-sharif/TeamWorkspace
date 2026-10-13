// apps/api/src/auth/auth.service.ts
import {
    BadRequestException,
    ConflictException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { type ForgotDto, type InviteDto, type LoginDto, type RegisterDto, type ResetDto } from './dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

function ttlSeconds(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const match = /^(\d+)(s|m|h|d)?$/.exec(value);
    if (!match) return fallback;
    const amount = Number(match[1]);
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as 's' | 'm' | 'h' | 'd'] ?? 1;
    return amount * multiplier;
}

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwt: JwtService,
        private notifications: NotificationsService,
    ) { }

    // ---------------------------------------------------------------- invitations

    async createInvitation(workspaceId: string, invitedById: string, dto: InviteDto) {
        const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existingUser) {
            const already = await this.prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
            });
            if (already) throw new ConflictException('This person is already a workspace member');
        }

        const pending = await this.prisma.invitation.findFirst({
            where: { workspaceId, email: dto.email, status: 'PENDING' },
        });
        if (pending) {
            await this.prisma.invitation.update({
                where: { id: pending.id },
                data: { status: 'REVOKED' },
            });
        }

        const rawToken = randomBytes(32).toString('hex');
        const invitation = await this.prisma.invitation.create({
            data: {
                workspaceId,
                email: dto.email,
                role: dto.role as Role,
                specialty: dto.specialty,
                specialties: dto.specialties ?? (dto.specialty ? [dto.specialty] : []),
                invitedById,
                tokenHash: sha256(rawToken),
                expiresAt: new Date(Date.now() + INVITE_TTL_MS),
            },
            include: { workspace: { select: { name: true } } },
        });

        // The raw token is the only copy that exists — it is returned once so the
        // leader can share the link. Replace this with a transactional email in prod.
        // const acceptUrl = `${process.env.WEB_ORIGIN}/accept-invite?token=${rawToken}`;
        const appUrl = process.env.WEB_APP_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173';
        const acceptUrl = `${appUrl}/accept-invite?token=${rawToken}`;

        return {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expiresAt,
            acceptUrl,
        };
    }

    async listInvitations(workspaceId: string) {
        await this.expireStale(workspaceId);
        return this.prisma.invitation.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                email: true,
                role: true,
                specialty: true,
                specialties: true,
                status: true,
                expiresAt: true,
                acceptedAt: true,
                createdAt: true,
            },
        });
    }

    async revokeInvitation(workspaceId: string, id: string) {
        const inv = await this.prisma.invitation.findFirst({ where: { id, workspaceId } });
        if (!inv) throw new BadRequestException('Invitation not found');
        return this.prisma.invitation.update({ where: { id }, data: { status: 'REVOKED' } });
    }

    async previewInvitation(rawToken: string) {
        const invitation = await this.prisma.invitation.findUnique({
            where: { tokenHash: sha256(rawToken) },
            include: { workspace: { select: { name: true, logoUrl: true } } },
        });
        if (!invitation) throw new BadRequestException('Invalid invitation link');
        if (invitation.status !== 'PENDING' || invitation.expiresAt < new Date()) {
            throw new BadRequestException('This invitation has expired or already been used');
        }
        return {
            email: invitation.email,
            role: invitation.role,
            specialty: invitation.specialty,
            specialties: invitation.specialties,
            workspace: invitation.workspace,
            expiresAt: invitation.expiresAt,
        };
    }

    private async expireStale(workspaceId: string) {
        await this.prisma.invitation.updateMany({
            where: { workspaceId, status: 'PENDING', expiresAt: { lt: new Date() } },
            data: { status: 'EXPIRED' },
        });
    }

    // ---------------------------------------------------------------- registration / login

    async register(dto: RegisterDto) {
        const tokenHash = sha256(dto.token);
        const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash } });

        if (!invitation) throw new BadRequestException('Invalid invitation');
        if (invitation.status !== 'PENDING') throw new BadRequestException('Invitation already used');
        if (invitation.expiresAt < new Date()) {
            await this.prisma.invitation.update({
                where: { id: invitation.id },
                data: { status: 'EXPIRED' },
            });
            throw new BadRequestException('Invitation expired');
        }

        const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

        const user = await this.prisma.$transaction(async (tx) => {
            const created = await tx.user.upsert({
                where: { email: invitation.email },
                update: { name: dto.name, passwordHash, isActive: true },
                create: { email: invitation.email, name: dto.name, passwordHash },
            });

            await tx.workspaceMember.upsert({
                where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: created.id } },
                update: { role: invitation.role, specialty: invitation.specialty, specialties: invitation.specialties, isActive: true },
                create: {
                    workspaceId: invitation.workspaceId,
                    userId: created.id,
                    role: invitation.role,
                    specialty: invitation.specialty,
                    specialties: invitation.specialties,
                },
            });

            await tx.invitation.update({
                where: { id: invitation.id },
                data: { status: 'ACCEPTED', acceptedAt: new Date() },
            });

            await tx.notificationPreference.upsert({
                where: { userId: created.id },
                update: {},
                create: { userId: created.id },
            });

            return created;
        });

        return this.issueSession(user.id, invitation.workspaceId);
    }

    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        // Always run a verify to keep response timing uniform.
        const hash = user?.passwordHash ?? '$argon2id$v=19$m=65536,t=3,p=4$invalid$invalid';
        const ok = await argon2.verify(hash, dto.password).catch(() => false);
        if (!user || !ok || !user.isActive) throw new UnauthorizedException('Invalid credentials');

        const membership = await this.prisma.workspaceMember.findFirst({
            where: { userId: user.id, isActive: true },
            orderBy: { role: 'asc' }, // LEADER sorts before MEMBER
        });
        if (!membership) throw new UnauthorizedException('No active workspace membership');

        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        return this.issueSession(user.id, membership.workspaceId);
    }

    private async issueSession(userId: string, workspaceId: string) {
        const accessToken = await this.jwt.signAsync(
            { sub: userId },
            {
                secret: process.env.JWT_ACCESS_SECRET,
                expiresIn: ttlSeconds(process.env.JWT_ACCESS_TTL, 15 * 60),
                issuer: 'tadreeby-team-hub',
            },
        );
        const refreshToken = await this.jwt.signAsync(
            { sub: userId, typ: 'refresh' },
            {
                secret: process.env.JWT_REFRESH_SECRET,
                expiresIn: ttlSeconds(process.env.JWT_REFRESH_TTL, 30 * 24 * 60 * 60),
                issuer: 'tadreeby-team-hub',
            },
        );
        return { accessToken, refreshToken, workspaceId, user: await this.me(userId) };
    }

    async refresh(refreshToken: string) {
        try {
            const payload = await this.jwt.verifyAsync(refreshToken, {
                secret: process.env.JWT_REFRESH_SECRET,
                issuer: 'tadreeby-team-hub',
            });
            if (payload.typ !== 'refresh') throw new Error('wrong token type');
            const membership = await this.prisma.workspaceMember.findFirst({
                where: { userId: payload.sub, isActive: true },
            });
            if (!membership) throw new Error('no membership');
            return this.issueSession(payload.sub, membership.workspaceId);
        } catch {
            throw new UnauthorizedException('Session expired');
        }
    }

    async me(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                avatarUrl: true,
                jobTitle: true,
                memberships: {
                    where: { isActive: true },
                    select: {
                        role: true,
                        specialty: true,
                        specialties: true,
                        workspace: { select: { id: true, name: true, logoUrl: true } },
                    },
                },
            },
        });
        if (!user) throw new UnauthorizedException();
        return user;
    }

    async updateProfile(userId: string, name: string) {
        await this.prisma.user.update({ where: { id: userId }, data: { name } });
        return this.me(userId);
    }

    // ---------------------------------------------------------------- password reset

    async forgotPassword(dto: ForgotDto) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        // Never reveal whether the account exists.
        if (!user) return { ok: true };

        const rawToken = randomBytes(32).toString('hex');
        await this.prisma.passwordResetToken.create({
            data: { userId: user.id, tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
        });
        // Email delivery is external configuration — see README.
        return { ok: true, resetUrl: `${process.env.WEB_ORIGIN}/reset-password?token=${rawToken}` };
    }

    async resetPassword(dto: ResetDto) {
        const record = await this.prisma.passwordResetToken.findUnique({
            where: { tokenHash: sha256(dto.token) },
        });
        if (!record || record.usedAt || record.expiresAt < new Date()) {
            throw new BadRequestException('Reset link is invalid or expired');
        }
        const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
        await this.prisma.$transaction([
            this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
            this.prisma.passwordResetToken.update({
                where: { id: record.id },
                data: { usedAt: new Date() },
            }),
        ]);
        return { ok: true };
    }
}
