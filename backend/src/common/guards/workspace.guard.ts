// apps/api/src/common/guards/workspace.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY, SKIP_WORKSPACE_KEY } from '../decorators';

@Injectable()
export class WorkspaceGuard implements CanActivate {
    constructor(private prisma: PrismaService, private reflector: Reflector) { }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const skip = this.reflector.getAllAndOverride<boolean>(SKIP_WORKSPACE_KEY, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);
        if (skip || isPublic) return true;

        const req = ctx.switchToHttp().getRequest();
        const workspaceId =
            req.headers['x-workspace-id'] ?? req.params?.workspaceId ?? req.query?.workspaceId;

        if (!workspaceId || typeof workspaceId !== 'string') {
            throw new ForbiddenException('Missing x-workspace-id header');
        }

        const membership = await this.prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId: req.user.id } },
        });
        if (!membership || !membership.isActive) {
            throw new ForbiddenException('You are not an active member of this workspace');
        }

        req.membership = {
            userId: req.user.id,
            workspaceId,
            role: membership.role,
        };
        return true;
    }
}