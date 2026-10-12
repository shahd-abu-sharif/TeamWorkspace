// apps/api/src/workspace/workspace.controller.ts
import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { CurrentMembership, CurrentUser, Roles, SkipWorkspace } from '../common/decorators';
import type { Membership } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class WorkspaceController {
  constructor(private prisma: PrismaService) { }

  @Get('workspaces')
  @SkipWorkspace()
  async mine(@CurrentUser() user: { id: string }) {
    return this.prisma.workspace.findMany({
      where: { members: { some: { userId: user.id, isActive: true } } },
      select: { id: true, name: true, slug: true, logoUrl: true },
    });
  }

  @Patch('workspace')
  @Roles('LEADER')
  update(@CurrentMembership() m: Membership, @Body() body: { name?: string; logoUrl?: string }) {
    return this.prisma.workspace.update({
      where: { id: m.workspaceId },
      data: { name: body.name, logoUrl: body.logoUrl },
    });
  }

  @Get('workspace/settings')
  @Roles('LEADER')
  settings(@CurrentMembership() m: Membership) {
    return this.prisma.workspace.findUnique({ where: { id: m.workspaceId } });
  }

  // ---------------------------------------------------------------- members

  @Get('members')
  members(@CurrentMembership() m: Membership) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId: m.workspaceId },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true, jobTitle: true, lastLoginAt: true, lastSeenAt: true, isOnline: true },
        },
      },
    });
  }

  @Post('members/presence')
  async heartbeat(@CurrentMembership() m: Membership) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: m.userId }, data: { lastSeenAt: now, isOnline: true } }),
      this.prisma.chatMessageReceipt.updateMany({
        where: { userId: m.userId, deliveredAt: null, message: { workspaceId: m.workspaceId } },
        data: { deliveredAt: now },
      }),
    ]);
    return { ok: true };
  }

  @Post('members/presence/offline')
  async endPresence(@CurrentMembership() m: Membership) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: m.userId }, data: { lastSeenAt: now, isOnline: false } }),
      this.prisma.taskTimeEntry.updateMany({
        where: { userId: m.userId, endedAt: null, task: { workspaceId: m.workspaceId } },
        data: { endedAt: now },
      }),
    ]);
    return { ok: true };
  }

  @Patch('members/me/tags')
  async updateMyTags(@CurrentMembership() m: Membership, @Body() body: { specialties?: unknown }) {
    if (!Array.isArray(body.specialties) || body.specialties.length > 12 || body.specialties.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40)) {
      throw new BadRequestException('Provide up to 12 tags, each between 1 and 40 characters');
    }
    const specialties = [...new Set(body.specialties.map((tag) => (tag as string).trim()))];
    await this.prisma.workspaceMember.updateMany({
      where: { workspaceId: m.workspaceId, userId: m.userId, isActive: true },
      data: { specialties, specialty: null },
    });
    return { specialties };
  }

  @Patch('members/:id')
  @Roles('LEADER')
  updateMember(
    @CurrentMembership() m: Membership,
    @Param('id') id: string,
    @Body() body: { role?: 'LEADER' | 'MEMBER'; specialty?: string | null; specialties?: string[]; isActive?: boolean },
  ) {
    return this.prisma.workspaceMember.updateMany({
      where: { id, workspaceId: m.workspaceId },
      data: {
        role: body.role,
        specialty: body.specialty,
        specialties: body.specialties,
        isActive: body.isActive,
      },
    }).then((result) => {
      if (!result.count) throw new NotFoundException('Member not found in this workspace');
      return { ok: true };
    });
  }

  @Delete('members/:id')
  @Roles('LEADER')
  async removeMember(@CurrentMembership() m: Membership, @Param('id') id: string) {
    // Prevent a leader from removing themselves and orphaning the workspace.
    const target = await this.prisma.workspaceMember.findFirst({ where: { id, workspaceId: m.workspaceId } });
    if (!target) throw new NotFoundException('Member not found in this workspace');
    if (target?.userId === m.userId) {
      await this.prisma.workspaceMember.update({ where: { id }, data: { isActive: false } });
      return { ok: true, deactivatedSelf: true };
    }
    await this.prisma.workspaceMember.delete({ where: { id } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- taxonomy

  @Get('workstreams')
  workstreams(@CurrentMembership() m: Membership) {
    return this.prisma.workstream.findMany({ where: { workspaceId: m.workspaceId }, orderBy: { name: 'asc' } });
  }

  @Post('workstreams')
  @Roles('LEADER')
  createWorkstream(@CurrentMembership() m: Membership, @Body() body: { name: string; color?: string }) {
    return this.prisma.workstream.upsert({
      where: { workspaceId_name: { workspaceId: m.workspaceId, name: body.name } },
      update: { color: body.color },
      create: { workspaceId: m.workspaceId, name: body.name, color: body.color ?? '#2563EB' },
    });
  }

  @Get('tags')
  tags(@CurrentMembership() m: Membership) {
    return this.prisma.tag.findMany({ where: { workspaceId: m.workspaceId }, orderBy: { name: 'asc' } });
  }

  @Get('milestones')
  milestones(@CurrentMembership() m: Membership) {
    return this.prisma.milestone.findMany({
      where: { workspaceId: m.workspaceId },
      orderBy: { dueDate: 'asc' },
    });
  }

  @Post('milestones')
  @Roles('LEADER')
  createMilestone(
    @CurrentMembership() m: Membership,
    @Body() body: { name: string; description?: string; dueDate: string; ownerId?: string },
  ) {
    return this.prisma.milestone.create({
      data: {
        workspaceId: m.workspaceId,
        name: body.name,
        description: body.description,
        dueDate: new Date(body.dueDate),
        ownerId: body.ownerId,
      },
    });
  }
}
