import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Membership } from '../common/decorators';
import type { AddTeamMemberDto, CreateTeamDto, UpdateTeamDto } from './dto';

const teamMemberSelect = {
    id: true,
    userId: true,
    roleInTeam: true,
    createdAt: true,
    user: {
        select: { id: true, name: true, email: true, avatarUrl: true, jobTitle: true },
    },
} satisfies Prisma.TeamMemberSelect;

/** Tasks that are still work in progress: not archived and not DONE. */
const OPEN_TASK_WHERE = {
    isArchived: false,
    status: { not: 'DONE' },
} satisfies Prisma.TaskWhereInput;

@Injectable()
export class TeamsService {
    constructor(private prisma: PrismaService) { }

    // ---------------------------------------------------------------- helpers

    /** Loads a team or throws 404, always scoped to the caller's workspace. */
    async loadTeam(workspaceId: string, id: string) {
        const team = await this.prisma.team.findFirst({
            where: { id, workspaceId },
            include: {
                members: { select: teamMemberSelect, orderBy: { createdAt: 'asc' } },
            },
        });
        if (!team) throw new NotFoundException('Team not found');

        const epics = await this.prisma.epic.findMany({
            where: { teamId: team.id, workspaceId },
            orderBy: [{ reference: 'asc' }],
            select: {
                id: true,
                reference: true,
                title: true,
                status: true,
                dueDate: true,
                _count: { select: { tasks: true } },
            },
        });

        const epicsWithOpen = await Promise.all(
            epics.map(async (epic) => ({
                ...epic,
                taskCount: epic._count.tasks,
                openTasks: await this.prisma.task.count({
                    where: { ...OPEN_TASK_WHERE, epicId: epic.id },
                }),
            })),
        );

        return {
            id: team.id,
            name: team.name,
            description: team.description,
            type: team.type,
            createdAt: team.createdAt,
            updatedAt: team.updatedAt,
            members: team.members,
            memberCount: team.members.length,
            epics: epicsWithOpen,
            epicCount: epicsWithOpen.length,
            openTasks: epicsWithOpen.reduce((sum, epic) => sum + epic.openTasks, 0),
        };
    }

    /** Team leads may manage their own team's members; workspace leaders may manage any. */
    async assertCanManageMembers(m: Membership, teamId: string) {
        if (m.role === 'LEADER') return;
        const lead = await this.prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: m.userId } },
            select: { roleInTeam: true },
        });
        if (lead?.roleInTeam !== 'LEAD') {
            throw new ForbiddenException('Only workspace admins or this team lead can manage members');
        }
    }

    private async assertActiveWorkspaceMember(workspaceId: string, userId: string) {
        const member = await this.prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId } },
            select: { isActive: true },
        });
        if (!member?.isActive) {
            throw new BadRequestException('That person is not an active member of this workspace');
        }
    }

    // ---------------------------------------------------------------- teams

    async list(m: Membership) {
        const teams = await this.prisma.team.findMany({
            where: { workspaceId: m.workspaceId },
            orderBy: [{ type: 'asc' }, { name: 'asc' }],
            include: {
                members: { select: { userId: true, roleInTeam: true } },
                _count: { select: { epics: true, members: true } },
            },
        });

        return Promise.all(
            teams.map(async (team) => ({
                id: team.id,
                name: team.name,
                description: team.description,
                type: team.type,
                memberCount: team._count.members,
                epicCount: team._count.epics,
                openTasks: await this.prisma.task.count({
                    where: { ...OPEN_TASK_WHERE, epic: { teamId: team.id } },
                }),
                members: team.members,
            })),
        );
    }

    async findOne(m: Membership, id: string) {
        return this.loadTeam(m.workspaceId, id);
    }

    async create(m: Membership, dto: CreateTeamDto) {
        const existing = await this.prisma.team.findFirst({
            where: { workspaceId: m.workspaceId, name: dto.name },
            select: { id: true },
        });
        if (existing) throw new ConflictException('A team with that name already exists');

        return this.prisma.team.create({
            data: {
                workspaceId: m.workspaceId,
                name: dto.name,
                description: dto.description ?? null,
                type: dto.type,
            },
            include: { members: { select: teamMemberSelect } },
        });
    }

    async update(m: Membership, id: string, dto: UpdateTeamDto) {
        await this.loadTeam(m.workspaceId, id);

        if (dto.name) {
            const clash = await this.prisma.team.findFirst({
                where: { workspaceId: m.workspaceId, name: dto.name, id: { not: id } },
                select: { id: true },
            });
            if (clash) throw new ConflictException('A team with that name already exists');
        }

        return this.prisma.team.update({
            where: { id },
            data: { name: dto.name, description: dto.description, type: dto.type },
            include: { members: { select: teamMemberSelect } },
        });
    }

    /**
     * Deleting a team never deletes work: `Epic.teamId` is ON DELETE SET NULL,
     * so every epic (and therefore every task, subtask and time entry under it)
     * simply becomes team-less.
     */
    async remove(m: Membership, id: string) {
        await this.loadTeam(m.workspaceId, id);
        const detachedEpics = await this.prisma.epic.count({ where: { teamId: id } });
        await this.prisma.team.delete({ where: { id } });
        return { ok: true, detachedEpics };
    }

    // ---------------------------------------------------------------- members

    async addMember(m: Membership, teamId: string, dto: AddTeamMemberDto) {
        await this.loadTeam(m.workspaceId, teamId);
        await this.assertCanManageMembers(m, teamId);
        await this.assertActiveWorkspaceMember(m.workspaceId, dto.userId);

        const existing = await this.prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: dto.userId } },
            select: { id: true },
        });
        if (existing) throw new ConflictException('That person is already in this team');

        return this.prisma.teamMember.create({
            data: { teamId, userId: dto.userId, roleInTeam: dto.roleInTeam },
            select: teamMemberSelect,
        });
    }

    async removeMember(m: Membership, teamId: string, userId: string) {
        await this.loadTeam(m.workspaceId, teamId);
        await this.assertCanManageMembers(m, teamId);

        const row = await this.prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId } },
            select: { id: true },
        });
        if (!row) throw new NotFoundException('That person is not in this team');

        await this.prisma.teamMember.delete({ where: { id: row.id } });

        // Tasks already assigned to this person are intentionally left alone;
        // they surface as a warning on the team detail screen instead.
        const openAssignedTasks = await this.prisma.task.count({
            where: { ...OPEN_TASK_WHERE, epic: { teamId }, assignees: { some: { userId } } },
        });
        return { ok: true, openAssignedTasks };
    }

    // ---------------------------------------------------------------- workload

    async workload(m: Membership, teamId: string) {
        const team = await this.prisma.team.findFirst({
            where: { id: teamId, workspaceId: m.workspaceId },
            select: { id: true, name: true, type: true, members: { select: teamMemberSelect } },
        });
        if (!team) throw new NotFoundException('Team not found');

        // One pass over the team's open tasks, aggregated in memory: teams are small.
        const tasks = await this.prisma.task.findMany({
            where: { ...OPEN_TASK_WHERE, epic: { teamId } },
            select: {
                id: true,
                estimatedHrs: true,
                actualHrs: true,
                assignees: { select: { userId: true } },
            },
        });

        const perUser = new Map<string, { openTasks: number; openEstimatedHrs: number; loggedHours: number }>();
        let unassignedTasks = 0;

        for (const task of tasks) {
            if (!task.assignees.length) {
                unassignedTasks += 1;
                continue;
            }
            for (const assignee of task.assignees) {
                const bucket = perUser.get(assignee.userId) ?? {
                    openTasks: 0,
                    openEstimatedHrs: 0,
                    loggedHours: 0,
                };
                bucket.openTasks += 1;
                bucket.openEstimatedHrs += task.estimatedHrs ?? 0;
                bucket.loggedHours += task.actualHrs ?? 0;
                perUser.set(assignee.userId, bucket);
            }
        }

        const members = team.members.map((member) => {
            const bucket = perUser.get(member.userId);
            return {
                userId: member.userId,
                name: member.user.name,
                avatarUrl: member.user.avatarUrl,
                jobTitle: member.user.jobTitle,
                roleInTeam: member.roleInTeam,
                openTasks: bucket?.openTasks ?? 0,
                openEstimatedHrs: Math.round((bucket?.openEstimatedHrs ?? 0) * 100) / 100,
                loggedHours: Math.round((bucket?.loggedHours ?? 0) * 100) / 100,
            };
        });

        return {
            teamId: team.id,
            teamName: team.name,
            type: team.type,
            members,
            openTasks: tasks.length,
            unassignedTasks,
        };
    }
}
