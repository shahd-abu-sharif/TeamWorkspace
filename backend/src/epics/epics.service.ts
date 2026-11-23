import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Membership } from '../common/decorators';
import type { CreateEpicDto, EpicQueryDto, UpdateEpicDto } from './dto';

export interface EpicTeamWarning {
    code: 'ASSIGNEES_OUTSIDE_TEAM';
    message: string;
    tasks: {
        id: string;
        reference: number;
        title: string;
        assignees: { userId: string; name: string }[];
    }[];
}

const epicListSelect = {
    id: true,
    reference: true,
    title: true,
    description: true,
    status: true,
    priority: true,
    startDate: true,
    dueDate: true,
    teamId: true,
    createdAt: true,
    updatedAt: true,
    team: {
        select: {
            id: true,
            name: true,
            type: true,
            _count: { select: { members: true } },
        },
    },
    _count: { select: { tasks: true } },
} satisfies Prisma.EpicSelect;

@Injectable()
export class EpicsService {
    constructor(private prisma: PrismaService) { }

    private async assertTeam(workspaceId: string, teamId: string) {
        const team = await this.prisma.team.findFirst({
            where: { id: teamId, workspaceId },
            select: { id: true },
        });
        if (!team) throw new BadRequestException('Team not found in this workspace');
    }

    /** Next per-workspace reference (EPIC-1, EPIC-2, ...), computed in a transaction. */
    private async nextReference(tx: Prisma.TransactionClient, workspaceId: string) {
        const last = await tx.epic.findFirst({
            where: { workspaceId },
            orderBy: { reference: 'desc' },
            select: { reference: true },
        });
        return (last?.reference ?? 0) + 1;
    }

    /**
     * Tasks whose assignees are not members of `teamId`. Used to warn (never to
     * silently rewrite) when an epic is moved to another team.
     */
    async assigneesOutsideTeam(workspaceId: string, epicId: string, teamId: string) {
        const [tasks, members] = await Promise.all([
            this.prisma.task.findMany({
                where: { epicId, workspaceId, assignees: { some: {} } },
                orderBy: { reference: 'asc' },
                select: {
                    id: true,
                    reference: true,
                    title: true,
                    assignees: {
                        select: { userId: true, user: { select: { name: true } } },
                    },
                },
            }),
            this.prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } }),
        ]);

        const allowed = new Set(members.map((member) => member.userId));
        return tasks
            .map((task) => ({
                id: task.id,
                reference: task.reference,
                title: task.title,
                assignees: task.assignees
                    .filter((assignee) => !allowed.has(assignee.userId))
                    .map((assignee) => ({ userId: assignee.userId, name: assignee.user.name })),
            }))
            .filter((task) => task.assignees.length > 0);
    }

    private buildWarning(tasks: Awaited<ReturnType<EpicsService['assigneesOutsideTeam']>>): EpicTeamWarning | null {
        if (!tasks.length) return null;
        return {
            code: 'ASSIGNEES_OUTSIDE_TEAM',
            message: `${tasks.length} task(s) in this epic are assigned to people outside the selected team. Their work is unchanged — reassign those tasks or add the people to the team.`,
            tasks,
        };
    }

    async list(m: Membership, query: EpicQueryDto) {
        const where: Prisma.EpicWhereInput = { workspaceId: m.workspaceId };
        if (query.unassigned) where.teamId = null;
        else if (query.teamId) where.teamId = query.teamId;

        const epics = await this.prisma.epic.findMany({
            where,
            orderBy: [{ reference: 'desc' }],
            select: epicListSelect,
        });

        return Promise.all(
            epics.map(async (epic) => ({
                ...epic,
                taskCount: epic._count.tasks,
                openTasks: await this.prisma.task.count({
                    where: { epicId: epic.id, isArchived: false, status: { not: 'DONE' } },
                }),
            })),
        );
    }

    async findOne(m: Membership, id: string) {
        const epic = await this.prisma.epic.findFirst({
            where: { id, workspaceId: m.workspaceId },
            select: {
                ...epicListSelect,
                tasks: {
                    orderBy: { reference: 'asc' },
                    select: {
                        id: true,
                        reference: true,
                        title: true,
                        status: true,
                        priority: true,
                        dueDate: true,
                        estimatedHrs: true,
                        assignees: {
                            select: { userId: true, user: { select: { id: true, name: true, avatarUrl: true } } },
                        },
                        _count: { select: { subtasks: true } },
                    },
                },
            },
        });
        if (!epic) throw new NotFoundException('Epic not found');

        const { tasks, ...rest } = epic;
        return {
            ...rest,
            taskCount: epic._count.tasks,
            openTasks: tasks.filter((task) => task.status !== 'DONE').length,
            tasks: tasks.map(({ _count, ...task }) => ({ ...task, subtaskCount: _count.subtasks })),
        };
    }

    async create(m: Membership, dto: CreateEpicDto) {
        if (dto.teamId) await this.assertTeam(m.workspaceId, dto.teamId);

        return this.prisma.$transaction(async (tx) => {
            const reference = await this.nextReference(tx, m.workspaceId);
            return tx.epic.create({
                data: {
                    workspaceId: m.workspaceId,
                    reference,
                    title: dto.title,
                    description: dto.description ?? null,
                    status: dto.status,
                    priority: dto.priority,
                    startDate: dto.startDate ?? undefined,
                    dueDate: dto.dueDate ?? undefined,
                    teamId: dto.teamId ?? null,
                    createdById: m.userId,
                },
                select: epicListSelect,
            });
        });
    }

    /**
     * Changing `teamId` never touches tasks, assignees, timers or subtasks.
     * If existing assignees are outside the new team we return a warning so the
     * UI can ask the user to confirm/reassign.
     */
    async update(m: Membership, id: string, dto: UpdateEpicDto) {
        const before = await this.prisma.epic.findFirst({
            where: { id, workspaceId: m.workspaceId },
            select: { id: true, teamId: true },
        });
        if (!before) throw new NotFoundException('Epic not found');

        const teamChanged = dto.teamId !== undefined && dto.teamId !== before.teamId;
        if (teamChanged && dto.teamId) await this.assertTeam(m.workspaceId, dto.teamId);

        const epic = await this.prisma.epic.update({
            where: { id },
            data: {
                title: dto.title,
                description: dto.description,
                status: dto.status,
                priority: dto.priority,
                startDate: dto.startDate,
                dueDate: dto.dueDate,
                ...(dto.teamId !== undefined ? { teamId: dto.teamId } : {}),
            },
            select: epicListSelect,
        });

        const warning =
            teamChanged && dto.teamId
                ? this.buildWarning(await this.assigneesOutsideTeam(m.workspaceId, id, dto.teamId))
                : null;

        return { ...epic, warning };
    }

    /** Deleting an epic detaches its tasks instead of cascading a delete. */
    async remove(m: Membership, id: string) {
        const epic = await this.prisma.epic.findFirst({
            where: { id, workspaceId: m.workspaceId },
            select: { id: true },
        });
        if (!epic) throw new NotFoundException('Epic not found');

        return this.prisma.$transaction(async (tx) => {
            const detached = await tx.task.updateMany({
                where: { epicId: id },
                data: { epicId: null },
            });
            await tx.epic.delete({ where: { id } });
            return { ok: true, detachedTasks: detached.count };
        });
    }
}
