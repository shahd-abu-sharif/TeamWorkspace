import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TeamType } from '@prisma/client';
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
    createdAt: true,
    updatedAt: true,
    teams: {
        select: {
            team: {
                select: {
                    id: true,
                    name: true,
                    type: true,
                    members: { select: { userId: true } },
                },
            },
        },
    },
    _count: { select: { tasks: true } },
} satisfies Prisma.EpicSelect;

type EpicWithTeams = {
    teams: { team: { id: string; name: string; type: TeamType; members: { userId: string }[] } }[];
    _count?: { tasks: number };
};

/** Flattens the join rows into `teams: [{ id, name, type, memberIds }]`. */
function shapeEpic<T extends EpicWithTeams & Record<string, unknown>>(epic: T) {
    const { teams, _count, ...rest } = epic;
    return {
        ...rest,
        teams: teams.map(({ team }) => ({
            id: team.id,
            name: team.name,
            type: team.type,
            memberIds: team.members.map((member) => member.userId),
        })),
        ...(_count ? { taskCount: _count.tasks } : {}),
    };
}

@Injectable()
export class EpicsService {
    constructor(private prisma: PrismaService) { }

    /** Every team on an epic must belong to the caller's workspace. */
    private async assertTeams(workspaceId: string, teamIds: string[]) {
        const unique = [...new Set(teamIds)];
        if (!unique.length) return unique;
        const found = await this.prisma.team.findMany({
            where: { id: { in: unique }, workspaceId },
            select: { id: true },
        });
        if (found.length !== unique.length) {
            throw new BadRequestException('One or more teams do not belong to this workspace');
        }
        return unique;
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
     * Tasks whose assignees belong to none of `teamIds`. Used to warn (never to
     * silently rewrite) when an epic's teams change.
     */
    async assigneesOutsideTeam(workspaceId: string, epicId: string, teamIds: string[]) {
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
            teamIds.length
                ? this.prisma.teamMember.findMany({
                      where: { teamId: { in: teamIds } },
                      select: { userId: true },
                  })
                : Promise.resolve([] as { userId: string }[]),
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
            message: `${tasks.length} task(s) in this epic are assigned to people outside the epic's teams. Their work is unchanged — reassign those tasks or add the people to a team.`,
            tasks,
        };
    }

    async list(m: Membership, query: EpicQueryDto) {
        const where: Prisma.EpicWhereInput = { workspaceId: m.workspaceId };
        if (query.unassigned) where.teams = { none: {} };
        else if (query.teamId) where.teams = { some: { teamId: query.teamId } };

        const epics = await this.prisma.epic.findMany({
            where,
            orderBy: [{ reference: 'desc' }],
            select: epicListSelect,
        });

        return Promise.all(
            epics.map(async (epic) => ({
                ...shapeEpic(epic),
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
            ...shapeEpic(rest),
            openTasks: tasks.filter((task) => task.status !== 'DONE').length,
            tasks: tasks.map(({ _count, ...task }) => ({ ...task, subtaskCount: _count.subtasks })),
        };
    }

    async create(m: Membership, dto: CreateEpicDto) {
        // `teamId` is the legacy single-team field; `teamIds` is the list.
        const teamIds = await this.assertTeams(
            m.workspaceId,
            dto.teamIds ?? (dto.teamId ? [dto.teamId] : []),
        );

        return this.prisma.$transaction(async (tx) => {
            const reference = await this.nextReference(tx, m.workspaceId);
            const created = await tx.epic.create({
                data: {
                    workspaceId: m.workspaceId,
                    reference,
                    title: dto.title,
                    description: dto.description ?? null,
                    status: dto.status,
                    priority: dto.priority,
                    startDate: dto.startDate ?? undefined,
                    dueDate: dto.dueDate ?? undefined,
                    createdById: m.userId,
                    teams: { create: teamIds.map((teamId) => ({ teamId })) },
                },
                select: epicListSelect,
            });
            return shapeEpic(created);
        });
    }

    /**
     * Changing teams never touches tasks, assignees, timers or subtasks. If
     * existing assignees belong to none of the new teams we return a warning so
     * the UI can ask the user to confirm/reassign.
     */
    async update(m: Membership, id: string, dto: UpdateEpicDto) {
        const before = await this.prisma.epic.findFirst({
            where: { id, workspaceId: m.workspaceId },
            select: { id: true, teams: { select: { teamId: true } } },
        });
        if (!before) throw new NotFoundException('Epic not found');

        const requested =
            dto.teamIds ??
            (dto.teamId !== undefined ? (dto.teamId ? [dto.teamId] : []) : undefined);
        const teamIds =
            requested === undefined ? undefined : await this.assertTeams(m.workspaceId, requested);
        const beforeIds = before.teams.map((row) => row.teamId).sort();
        const teamChanged =
            teamIds !== undefined &&
            JSON.stringify([...teamIds].sort()) !== JSON.stringify(beforeIds);

        const epic = await this.prisma.$transaction(async (tx) => {
            if (teamIds !== undefined) {
                await tx.epicTeam.deleteMany({
                    where: {
                        epicId: id,
                        teamId: { notIn: teamIds.length ? teamIds : ['__none__'] },
                    },
                });
                if (teamIds.length) {
                    await tx.epicTeam.createMany({
                        data: teamIds.map((teamId) => ({ epicId: id, teamId })),
                        skipDuplicates: true,
                    });
                }
            }
            return tx.epic.update({
                where: { id },
                data: {
                    title: dto.title,
                    description: dto.description,
                    status: dto.status,
                    priority: dto.priority,
                    startDate: dto.startDate,
                    dueDate: dto.dueDate,
                },
                select: epicListSelect,
            });
        });

        const warning =
            teamChanged && teamIds
                ? this.buildWarning(await this.assigneesOutsideTeam(m.workspaceId, id, teamIds))
                : null;

        return { ...shapeEpic(epic), warning };
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
