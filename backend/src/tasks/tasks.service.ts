import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { ActivityType, Prisma, Priority, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Membership } from '../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { TaskAccessService } from './task-access.service';
import {
    BulkUpdateSchema,
    CreateTaskDto,
    MemberUpdateSchema,
    TaskQueryDto,
    UpdateTaskDto,
} from './dto';
import { z } from 'zod';
import { FilesService } from '../files/files.service';

const STATUS_ORDER: TaskStatus[] = [
    'BACKLOG',
    'TODO',
    'IN_PROGRESS',
    'IN_REVIEW',
    'BLOCKED',
    'DONE',
];

@Injectable()
export class TasksService {
    constructor(
        private prisma: PrismaService,
        private access: TaskAccessService,
        private notifications: NotificationsService,
        private files: FilesService,
    ) { }

    // ---------------------------------------------------------------- queries

    async list(m: Membership, query: TaskQueryDto) {
        const where: Prisma.TaskWhereInput = {
            workspaceId: m.workspaceId,
            ...(query.includeArchived ? {} : { isArchived: false }),
        };

        if (m.role !== 'LEADER') {
            where.OR = [
                { assignees: { some: { userId: m.userId } } },
                { collaborators: { some: { userId: m.userId } } },
            ];
        }

        if (query.mine) {
            const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
            where.AND = [
                ...existingAnd,
                {
                    OR: [
                        { assignees: { some: { userId: m.userId } } },
                        { collaborators: { some: { userId: m.userId } } },
                    ],
                },
            ];
        }

        if (query.q) {
            where.AND = [
                ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
                {
                    OR: [
                        { title: { contains: query.q, mode: 'insensitive' } },
                        { description: { contains: query.q, mode: 'insensitive' } },
                    ],
                },
            ];
        }
        if (query.status) where.status = { in: asArray(query.status) };
        if (query.priority) where.priority = { in: asArray(query.priority) };
        if (query.assigneeId) where.assignees = { some: { userId: query.assigneeId } };
        if (query.workstreamId) where.workstreamId = query.workstreamId;
        if (query.tag) where.tags = { some: { tag: { name: query.tag } } };
        if (query.unassigned) where.assignees = { none: {} };
        if (query.awaitingReview) where.status = 'IN_REVIEW';
        if (query.overdue) {
            where.dueDate = { lt: new Date() };
            where.status = { not: 'DONE' };
        }
        if (query.dueFrom || query.dueTo) {
            where.dueDate = {
                ...(typeof where.dueDate === 'object' ? where.dueDate : {}),
                ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
                ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
            };
        }

        const orderBy: Prisma.TaskOrderByWithRelationInput =
            query.sort === 'priority'
                ? { priority: query.order }
                : { [query.sort]: query.order } as Prisma.TaskOrderByWithRelationInput;

        const [total, items] = await this.prisma.$transaction([
            this.prisma.task.count({ where }),
            this.prisma.task.findMany({
                where,
                orderBy: [{ ...orderBy }, { id: 'asc' }],
                skip: (query.page - 1) * query.pageSize,
                take: query.pageSize,
                include: {
                    assignees: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
                    collaborators: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
                    dependencies: { select: { dependsOn: { select: { id: true } } } },
                    workstream: { select: { id: true, name: true, color: true } },
                    tags: { include: { tag: true } },
                    _count: { select: { comments: true, attachments: true, dependencies: true } },
                },
            }),
        ]);

        return { items, total, page: query.page, pageSize: query.pageSize };
    }

    // async board(m: Membership) {
    //     const tasks = await this.prisma.task.findMany({
    //         where: {
    //             workspaceId: m.workspaceId,
    //             isArchived: false,
    //             ...(m.role === 'LEADER'
    //                 ? {}
    //                 : {
    //                     OR: [
    //                         { assignees: { some: { userId: m.userId } } },
    //                         { collaborators: { some: { userId: m.userId } } },
    //                     ],
    //                 }),
    //         },
    //         orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
    //         include: {
    //             assignees: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
    //             workstream: { select: { id: true, name: true, color: true } },
    //             tags: { include: { tag: true } },
    //         },
    //     });

    //     return STATUS_ORDER.reduce<Record<string, unknown[]>>((acc, status) => {
    //         acc[status] = tasks.filter((t) => t.status === status);
    //         return acc;
    //     }, {});
    // }



    async board(m: Membership) {
        const tasks = await this.prisma.task.findMany({
            where: {
                workspaceId: m.workspaceId,
                isArchived: false,

                OR: [
                    { assignees: { some: { userId: m.userId } } },
                    { collaborators: { some: { userId: m.userId } } },
                ],

            },
            orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
            include: {
                assignees: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
                workstream: { select: { id: true, name: true, color: true } },
                tags: { include: { tag: true } },
            },
        });

        return STATUS_ORDER.reduce<Record<string, unknown[]>>((acc, status) => {
            acc[status] = tasks.filter((t) => t.status === status);
            return acc;
        }, {});
    }

    async findOne(m: Membership, id: string) {
        const task = await this.access.loadForRead(id, m);
        const [comments, activities, timeEntries] = await Promise.all([
            this.prisma.taskComment.findMany({
                where: { taskId: id },
                orderBy: { createdAt: 'asc' },
                include: { author: { select: { id: true, name: true, avatarUrl: true } } },
            }),
            this.prisma.taskActivity.findMany({
                where: { taskId: id },
                orderBy: { createdAt: 'desc' },
                take: 100,
                include: { actor: { select: { id: true, name: true } } },
            }),
            this.prisma.taskTimeEntry.findMany({
                where: { taskId: id },
                orderBy: { startedAt: 'asc' },
                include: { user: { select: { id: true, name: true } } },
            }),
        ]);
        const now = Date.now();
        const trackedSeconds = timeEntries.reduce((total, entry) => total + Math.max(0, Math.floor(((entry.endedAt ?? new Date(now)).getTime() - entry.startedAt.getTime()) / 1000)), 0);
        return { ...task, comments, activities, timeEntries, trackedSeconds };
    }

    // ---------------------------------------------------------------- Timer Controls

    async startTimer(m: Membership, id: string) {
        const task = await this.access.assertCanWrite(id, m);
        if (!this.isInvolved(task, m.userId) && m.role !== 'LEADER') {
            throw new ForbiddenException('Only assignees can track time on this task');
        }

        const now = new Date();

        await this.prisma.$transaction(async (tx) => {
            // Close any existing open entries for this user
            await tx.taskTimeEntry.updateMany({
                where: { taskId: id, userId: m.userId, endedAt: null },
                data: { endedAt: now },
            });

            // Create new open entry
            await tx.taskTimeEntry.create({
                data: { taskId: id, userId: m.userId, startedAt: now },
            });

            // Auto move to IN_PROGRESS if it's TODO or BACKLOG
            const taskData: Prisma.TaskUpdateInput = {};
            if (task.status === 'TODO' || task.status === 'BACKLOG') {
                taskData.status = 'IN_PROGRESS';
                taskData.startedAt = task.startedAt ?? now;
            }
            if (Object.keys(taskData).length) {
                await tx.task.update({ where: { id }, data: taskData });
            }
        });

        return this.findOne(m, id);
    }

    async pauseTimer(m: Membership, id: string) {
        const task = await this.access.assertCanWrite(id, m);
        if (!this.isInvolved(task, m.userId) && m.role !== 'LEADER') {
            throw new ForbiddenException('Only assignees can track time on this task');
        }

        const now = new Date();

        await this.prisma.$transaction(async (tx) => {
            await tx.taskTimeEntry.updateMany({
                where: { taskId: id, userId: m.userId, endedAt: null },
                data: { endedAt: now },
            });

            // Recalculate actual hours
            const entries = await tx.taskTimeEntry.findMany({ where: { taskId: id } });
            const totalSeconds = entries.reduce((sum, entry) => {
                const end = entry.endedAt ? entry.endedAt.getTime() : now.getTime();
                return sum + Math.max(0, (end - entry.startedAt.getTime()) / 1000);
            }, 0);
            await tx.task.update({
                where: { id },
                data: { actualHrs: Number((totalSeconds / 3600).toFixed(2)) },
            });
        });

        return this.findOne(m, id);
    }

    // ---------------------------------------------------------------- writes

    async create(m: Membership, dto: CreateTaskDto) {
        this.access.assertLeader(m);
        await this.validateRelations(m.workspaceId, dto);

        const task = await this.prisma.$transaction(async (tx) => {
            const reference = await this.nextReference(tx, m.workspaceId);

            const created = await tx.task.create({
                data: {
                    workspaceId: m.workspaceId,
                    reference,
                    title: dto.title,
                    description: dto.description,
                    workstreamId: dto.workstreamId ?? null,
                    createdById: m.userId,
                    priority: dto.priority as Priority,
                    status: dto.status as TaskStatus,
                    startedAt: dto.status === 'IN_PROGRESS' ? new Date() : null,
                    startDate: dto.startDate ?? null,
                    dueDate: dto.dueDate ?? null,
                    estimatedHrs: dto.estimatedHrs ?? null,
                    progress: dto.status === 'DONE' ? 100 : dto.progress,
                    completedAt: dto.status === 'DONE' ? new Date() : null,
                    links: dto.links, // ← الروابط
                    assignees: { create: dto.assigneeIds.map((userId) => ({ userId })) },
                    collaborators: { create: dto.collaboratorIds.map((userId) => ({ userId })) },
                    tags: { create: await this.resolveTags(tx, m.workspaceId, dto.tagNames) },
                },
            });

            if (dto.dependencyIds.length) {
                await this.addDependenciesTx(tx, created.id, dto.dependencyIds, m.workspaceId);
            }
            if (dto.status === 'IN_PROGRESS') {
                await this.syncTimeEntries(tx, created.id, dto.assigneeIds);
            }

            await tx.taskActivity.create({
                data: {
                    workspaceId: m.workspaceId,
                    taskId: created.id,
                    actorId: m.userId,
                    type: 'CREATED',
                    summary: `created task “${created.title}”`,
                    metadata: { assigneeIds: dto.assigneeIds },
                },
            });

            return created;
        });

        await this.notifications.notifyAssignment(task.id, m.workspaceId, dto.assigneeIds, m.userId, false);
        await this.notifications.notifyTaskInvolvement(
            task.id, m.workspaceId, dto.collaboratorIds, m.userId, 'Added to a task',
        );
        return this.findOne(m, task.id);
    }

    async update(m: Membership, id: string, dto: UpdateTaskDto) {
        this.access.assertLeader(m);
        const before = await this.prisma.task.findFirstOrThrow({
            where: { id, workspaceId: m.workspaceId },
            include: { assignees: true, collaborators: true, tags: { include: { tag: true } }, dependencies: true },
        });
        await this.validateRelations(m.workspaceId, dto);
        this.assertStatusCanAdvance(before, dto.status as TaskStatus | undefined);

        const updated = await this.prisma.$transaction(async (tx) => {
            const nextStatus = dto.status as TaskStatus | undefined;
            const data: Prisma.TaskUpdateInput = {
                title: dto.title,
                description: dto.description,
                priority: dto.priority as Priority | undefined,
                status: dto.status as TaskStatus | undefined,
                startDate: dto.startDate,
                dueDate: dto.dueDate,
                estimatedHrs: dto.estimatedHrs,
                progress: dto.progress,
                links: dto.links, // ← تحديث الروابط
            };
            if (nextStatus === 'IN_PROGRESS' && before.status !== 'IN_PROGRESS' && !before.startedAt) {
                data.startedAt = new Date();
            }
            if (dto.workstreamId !== undefined) {
                data.workstream = dto.workstreamId ? { connect: { id: dto.workstreamId } } : { disconnect: true };
            }
            if (dto.status === 'DONE') {
                data.completedAt = new Date();
                data.progress = 100;
            } else if (dto.status && before.status === 'DONE') {
                data.completedAt = null;
            }

            const task = await tx.task.update({ where: { id }, data });

            if (dto.assigneeIds) {
                await tx.taskAssignee.deleteMany({ where: { taskId: id } });
                await tx.taskAssignee.createMany({
                    data: dto.assigneeIds.map((userId) => ({ taskId: id, userId })),
                    skipDuplicates: true,
                });
            }
            const nextAssigneeIds = dto.assigneeIds ?? before.assignees.map((assignee) => assignee.userId);
            await this.syncTimeEntries(tx, id, nextStatus === undefined ? (before.status === 'IN_PROGRESS' ? nextAssigneeIds : []) : nextStatus === 'IN_PROGRESS' ? nextAssigneeIds : []);
            if (dto.collaboratorIds) {
                await tx.taskCollaborator.deleteMany({ where: { taskId: id } });
                await tx.taskCollaborator.createMany({
                    data: dto.collaboratorIds.map((userId) => ({ taskId: id, userId })),
                    skipDuplicates: true,
                });
            }
            if (dto.tagNames) {
                await tx.taskTag.deleteMany({ where: { taskId: id } });
                await tx.taskTag.createMany({
                    data: (await this.resolveTags(tx, m.workspaceId, dto.tagNames)).map((tag) => ({
                        taskId: id,
                        ...tag,
                    })),
                    skipDuplicates: true,
                });
            }
            if (dto.dependencyIds) {
                await tx.taskDependency.deleteMany({ where: { taskId: id } });
                await this.addDependenciesTx(tx, id, dto.dependencyIds, m.workspaceId);
            }

            const events = this.diffEvents(before, { ...before, ...dto });
            if (events.length) {
                await tx.taskActivity.createMany({
                    data: events.map((e) => ({
                        workspaceId: m.workspaceId,
                        taskId: id,
                        actorId: m.userId,
                        type: e.type,
                        summary: e.summary,
                        metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
                    })),
                });
            }
            return task;
        });

        const relationsChanged =
            (dto.tagNames !== undefined && JSON.stringify([...dto.tagNames].sort()) !== JSON.stringify(before.tags.map((item) => item.tag.name).sort())) ||
            (dto.dependencyIds !== undefined && JSON.stringify([...dto.dependencyIds].sort()) !== JSON.stringify(before.dependencies.map((dependency) => dependency.dependsOnId).sort()));
        await this.notifications.handleTaskUpdated(before, updated, m.userId, relationsChanged);
        if (dto.assigneeIds) {
            const existingIds = new Set(before.assignees.map((assignee) => assignee.userId));
            const removedIds = [...existingIds].filter((userId) => !dto.assigneeIds!.includes(userId));
            const newlyAssigned = dto.assigneeIds.filter((userId) => !existingIds.has(userId));
            if (newlyAssigned.length) {
                await this.notifications.notifyAssignment(id, m.workspaceId, newlyAssigned, m.userId, true);
            }
            if (removedIds.length) {
                await this.notifications.notifyUsers(m.workspaceId, removedIds, {
                    type: 'TASK_UPDATED',
                    title: 'Task assignment changed',
                    body: `You were removed from “${updated.title}”`,
                    taskId: id,
                    dedupeKey: `unassign:${id}:${Date.now()}`,
                    excludeUserId: m.userId,
                });
            }
        }
        if (dto.collaboratorIds) {
            const oldIds = new Set(before.collaborators.map((collaborator) => collaborator.userId));
            const nextIds = new Set(dto.collaboratorIds);
            const added = [...nextIds].filter((userId) => !oldIds.has(userId));
            const removed = [...oldIds].filter((userId) => !nextIds.has(userId));
            await this.notifications.notifyTaskInvolvement(id, m.workspaceId, added, m.userId, 'Added to a task');
            if (removed.length) {
                await this.notifications.notifyUsers(m.workspaceId, removed, {
                    type: 'TASK_UPDATED',
                    title: 'Task access changed',
                    body: `You were removed from “${updated.title}”`,
                    taskId: id,
                    dedupeKey: `uncollaborate:${id}:${Date.now()}`,
                    excludeUserId: m.userId,
                });
            }
        }
        return this.findOne(m, id);
    }

    async memberUpdate(m: Membership, id: string, raw: unknown) {
        const dto = MemberUpdateSchema.parse(raw);
        const before = await this.access.assertCanWrite(id, m);
        this.assertStatusCanAdvance(before, dto.status as TaskStatus | undefined);

        const data: Prisma.TaskUpdateInput = { ...dto };
        if (dto.status === 'DONE') {
            data.completedAt = new Date();
            data.progress = 100;
        } else if (dto.status && before.status === 'DONE') {
            data.completedAt = null;
        }

        if (dto.status === 'IN_PROGRESS' && before.status !== 'IN_PROGRESS' && !before.startedAt) data.startedAt = new Date();
        const updated = await this.prisma.$transaction(async (tx) => {
            const task = await tx.task.update({ where: { id }, data });
            const assigneeIds = before.assignees.map((assignee) => assignee.userId);
            await this.syncTimeEntries(tx, id, (dto.status ?? before.status) === 'IN_PROGRESS' ? assigneeIds : []);
            return task;
        });

        const events: Prisma.TaskActivityCreateManyInput[] = [];
        if (dto.status && dto.status !== before.status) {
            events.push({
                workspaceId: m.workspaceId,
                taskId: id,
                actorId: m.userId,
                type: dto.status === 'IN_REVIEW' ? 'SUBMITTED_FOR_REVIEW' : 'STATUS_CHANGED',
                summary: `moved task from ${before.status} to ${dto.status}`,
                metadata: { from: before.status, to: dto.status },
            });
        }
        if (events.length) await this.prisma.taskActivity.createMany({ data: events });

        if (dto.progress !== undefined && dto.progress !== before.progress) {
            await this.prisma.taskActivity.create({
                data: {
                    workspaceId: m.workspaceId,
                    taskId: id,
                    actorId: m.userId,
                    type: 'UPDATED',
                    summary: `updated progress to ${dto.progress}%`,
                }
            });
        }

        return updated;
    }

    async setStatus(m: Membership, id: string, status: TaskStatus) {
        if (!STATUS_ORDER.includes(status)) throw new BadRequestException('Invalid status');
        if (m.role === 'LEADER') return this.update(m, id, { status } as UpdateTaskDto);
        return this.memberUpdate(m, id, { status });
    }

    async review(m: Membership, id: string, decision: 'approve' | 'request_changes', note?: string) {
        this.access.assertLeader(m);
        const task = await this.prisma.task.findFirstOrThrow({
            where: { id, workspaceId: m.workspaceId },
            include: { assignees: true },
        });

        const status: TaskStatus = decision === 'approve' ? 'DONE' : 'IN_PROGRESS';
        const updated = await this.prisma.$transaction(async (tx) => {
            const updatedTask = await tx.task.update({
                where: { id },
                data: {
                    status,
                    ...(status === 'IN_PROGRESS' && !task.startedAt ? { startedAt: new Date() } : {}),
                    completedAt: decision === 'approve' ? new Date() : null,
                    progress: decision === 'approve' ? 100 : task.progress,
                },
            });
            await this.syncTimeEntries(tx, id, status === 'IN_PROGRESS' ? task.assignees.map((a) => a.userId) : []);
            return updatedTask;
        });

        await this.prisma.taskActivity.create({
            data: {
                workspaceId: m.workspaceId,
                taskId: id,
                actorId: m.userId,
                type: decision === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED',
                summary: decision === 'approve' ? 'approved the task' : 'requested changes',
                metadata: { note: note ?? null },
            },
        });

        await this.notifications.notifyTaskAssignees(m.workspaceId, id, {
            type: decision === 'approve' ? 'REVIEW_APPROVED' : 'REVIEW_CHANGES_REQUESTED',
            title: decision === 'approve' ? 'Task approved' : 'Changes requested',
            body: note?.trim() || task.title,
            dedupeKey: `review-decision:${id}:${Date.now()}`,
            excludeUserId: m.userId,
        });

        if (decision === 'approve') await this.notifications.notifyDependents(m.workspaceId, id);
        return updated;
    }

    async archive(m: Membership, id: string, archived: boolean) {
        this.access.assertLeader(m);
        const task = await this.prisma.task.update({
            where: { id },
            data: { isArchived: archived },
        });
        await this.prisma.taskActivity.create({
            data: {
                workspaceId: m.workspaceId,
                taskId: id,
                actorId: m.userId,
                type: archived ? 'ARCHIVED' : 'RESTORED',
                summary: archived ? 'archived the task' : 'restored the task',
            },
        });
        await this.notifications.notifyTaskAssignees(m.workspaceId, id, {
            type: 'TASK_UPDATED',
            title: archived ? 'Task archived' : 'Task restored',
            body: task.title,
            taskId: id,
            dedupeKey: `archive:${id}:${archived}:${Date.now()}`,
            excludeUserId: m.userId,
        });
        return task;
    }

    async remove(m: Membership, id: string) {
        this.access.assertLeader(m);
        const task = await this.prisma.task.findFirst({
            where: { id, workspaceId: m.workspaceId },
            include: { assignees: true, collaborators: true },
        });
        if (task) {
            await this.notifications.notifyUsers(
                m.workspaceId,
                [...task.assignees.map((item) => item.userId), ...task.collaborators.map((item) => item.userId)],
                {
                    type: 'TASK_UPDATED', title: 'Task deleted', body: `“${task.title}” was deleted`,
                    excludeUserId: m.userId,
                },
            );
        }
        await this.prisma.task.deleteMany({ where: { id, workspaceId: m.workspaceId } });
        return { ok: true };
    }

    async duplicate(m: Membership, id: string) {
        this.access.assertLeader(m);
        const source = await this.prisma.task.findFirstOrThrow({
            where: { id, workspaceId: m.workspaceId },
            include: { assignees: true, collaborators: true, tags: true, dependencies: true },
        });

        const copy = await this.prisma.$transaction(async (tx) => {
            const reference = await this.nextReference(tx, m.workspaceId);
            return tx.task.create({
                data: {
                    workspaceId: m.workspaceId,
                    reference,
                    title: `${source.title} (copy)`,
                    description: source.description,
                    workstreamId: source.workstreamId,
                    createdById: m.userId,
                    priority: source.priority,
                    status: 'BACKLOG',
                    startDate: source.startDate,
                    dueDate: source.dueDate,
                    estimatedHrs: source.estimatedHrs,
                    links: source.links, // copy links
                    assignees: { create: source.assignees.map((a) => ({ userId: a.userId })) },
                    collaborators: { create: source.collaborators.map((c) => ({ userId: c.userId })) },
                    tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) },
                    dependencies: { create: source.dependencies.map((d) => ({ dependsOnId: d.dependsOnId })) },
                },
            });
        });
        await this.notifications.notifyAssignment(
            copy.id,
            m.workspaceId,
            source.assignees.map((assignee) => assignee.userId),
            m.userId,
            false,
        );
        return this.findOne(m, copy.id);
    }

    async bulkUpdate(m: Membership, raw: unknown) {
        this.access.assertLeader(m);
        const { taskIds, patch } = BulkUpdateSchema.parse(raw);

        const owned = await this.prisma.task.findMany({
            where: { id: { in: taskIds }, workspaceId: m.workspaceId },
            include: { assignees: true },
        });
        if (owned.length !== taskIds.length) {
            throw new ForbiddenException('One or more tasks are outside your workspace');
        }
        for (const task of owned) this.assertStatusCanAdvance(task, patch.status as TaskStatus | undefined);

        await this.prisma.$transaction(async (tx) => {
            const data: Prisma.TaskUpdateInput = {};
            if (patch.status) {
                data.status = patch.status;
                if (patch.status === 'DONE') {
                    data.completedAt = new Date();
                    data.progress = 100;
                }
            }
            if (patch.priority) data.priority = patch.priority;
            if (patch.dueDate !== undefined) data.dueDate = patch.dueDate;
            if (patch.workstreamId !== undefined) {
                data.workstream = patch.workstreamId
                    ? { connect: { id: patch.workstreamId } }
                    : { disconnect: true };
            }
            for (const task of owned) {
                const assigneeIds = new Set(task.assignees.map((a) => a.userId));
                for (const id of patch.addAssigneeIds ?? []) assigneeIds.add(id);
                for (const id of patch.removeAssigneeIds ?? []) assigneeIds.delete(id);
                const taskData = { ...data };
                if (patch.status === 'IN_PROGRESS' && task.status !== 'IN_PROGRESS' && !task.startedAt) taskData.startedAt = new Date();
                if (Object.keys(taskData).length) await tx.task.update({ where: { id: task.id }, data: taskData });
                const active = (patch.status ?? task.status) === 'IN_PROGRESS' ? [...assigneeIds] : [];
                await this.syncTimeEntries(tx, task.id, active);
            }
            if (patch.addAssigneeIds?.length) {
                await tx.taskAssignee.createMany({
                    data: taskIds.flatMap((taskId) =>
                        patch.addAssigneeIds!.map((userId) => ({ taskId, userId })),
                    ),
                    skipDuplicates: true,
                });
            }
            if (patch.removeAssigneeIds?.length) {
                await tx.taskAssignee.deleteMany({
                    where: { taskId: { in: taskIds }, userId: { in: patch.removeAssigneeIds } },
                });
            }
            await tx.taskActivity.createMany({
                data: taskIds.map((taskId) => ({
                    workspaceId: m.workspaceId,
                    taskId,
                    actorId: m.userId,
                    type: 'UPDATED' as ActivityType,
                    summary: 'bulk updated the task',
                    metadata: patch as Prisma.InputJsonValue,
                })),
            });
        });

        for (const task of owned) {
            const oldIds = new Set(task.assignees.map((assignee) => assignee.userId));
            const added = (patch.addAssigneeIds ?? []).filter((userId) => !oldIds.has(userId));
            const removed = (patch.removeAssigneeIds ?? []).filter((userId) => oldIds.has(userId));
            if (added.length) await this.notifications.notifyAssignment(task.id, m.workspaceId, added, m.userId, true);
            if (removed.length) {
                await this.notifications.notifyUsers(m.workspaceId, removed, {
                    type: 'TASK_UPDATED', title: 'Task assignment changed',
                    body: `You were removed from “${task.title}”`, taskId: task.id,
                    dedupeKey: `bulk-unassign:${task.id}:${Date.now()}`, excludeUserId: m.userId,
                });
            }
            const taskChanged = Boolean(patch.status || patch.priority || patch.dueDate !== undefined || patch.workstreamId !== undefined);
            if (taskChanged) await this.notifications.notifyTaskAssignees(m.workspaceId, task.id, {
                type: 'TASK_UPDATED', title: 'Task updated', body: `“${task.title}” was updated`,
                dedupeKey: `bulk:${task.id}:${Date.now()}`, excludeUserId: m.userId,
            });
        }
        return { updated: taskIds.length };
    }

    // ---------------------------------------------------------------- comments

    async addComment(m: Membership, taskId: string, raw: unknown) {
        const { body } = z.object({ body: z.string().min(1).max(5000) }).parse(raw);
        const task = await this.access.loadForRead(taskId, m);
        if (m.role !== 'LEADER' && !this.isInvolved(task, m.userId)) {
            throw new ForbiddenException('You cannot comment on this task');
        }

        const activeMembers = await this.prisma.workspaceMember.findMany({
            where: { workspaceId: m.workspaceId, isActive: true },
            include: { user: { select: { id: true, name: true, email: true } } },
        });

        const mentionIds = this.extractMentions(body, activeMembers);

        const comment = await this.prisma.taskComment.create({
            data: { taskId, authorId: m.userId, body, mentions: mentionIds },
            include: { author: { select: { id: true, name: true, avatarUrl: true } } },
        });

        await this.prisma.taskActivity.create({
            data: {
                workspaceId: m.workspaceId,
                taskId,
                actorId: m.userId,
                type: 'COMMENTED',
                summary: 'added a comment',
            },
        });

        const mentioned = new Set(mentionIds);
        const recipients = [...new Set(activeMembers.map((member) => member.userId))]
            .filter((userId) => userId !== m.userId && !mentioned.has(userId));

        await Promise.all([
            this.notifications.notifyUsers(m.workspaceId, recipients, {
                type: 'COMMENT_ADDED',
                title: 'New comment',
                body: body.slice(0, 140),
                taskId,
                dedupeKey: `comment:${comment.id}`,
                excludeUserId: m.userId,
            }),
            this.notifications.notifyUsers(m.workspaceId, mentionIds, {
                type: 'COMMENT_MENTION',
                title: 'You were mentioned',
                body: body.slice(0, 140),
                taskId,
                dedupeKey: `mention:${comment.id}:${mentionIds.join(',')}`,
                excludeUserId: m.userId,
            }),
        ]);

        return comment;
    }

    async activity(m: Membership, taskId?: string, limit = 50) {
        if (taskId) await this.access.loadForRead(taskId, m);
        if (!taskId) this.access.assertLeader(m);
        return this.prisma.taskActivity.findMany({
            where: { workspaceId: m.workspaceId, ...(taskId ? { taskId } : {}) },
            orderBy: { createdAt: 'desc' },
            take: Math.min(limit, 200),
            include: {
                actor: { select: { id: true, name: true, avatarUrl: true } },
                task: { select: { id: true, reference: true, title: true } },
            },
        });
    }

    // ---------------------------------------------------------------- helpers

    private assertStatusCanAdvance(task: { status: TaskStatus; startedAt: Date | null }, status?: TaskStatus) {
        if (status && (task.startedAt || task.status === 'IN_PROGRESS' || task.status === 'IN_REVIEW' || task.status === 'BLOCKED' || task.status === 'DONE') && (status === 'BACKLOG' || status === 'TODO')) {
            throw new BadRequestException('A started task cannot be moved back to Not started');
        }
    }

    private async syncTimeEntries(tx: Prisma.TransactionClient, taskId: string, desiredUserIds: string[]) {
        const desired = [...new Set(desiredUserIds)];
        const open = await tx.taskTimeEntry.findMany({ where: { taskId, endedAt: null } });
        const openIds = new Set(open.map((entry) => entry.userId));
        const desiredIds = new Set(desired);
        const now = new Date();
        const toClose = open.filter((entry) => !desiredIds.has(entry.userId));
        if (toClose.length) {
            await tx.taskTimeEntry.updateMany({ where: { id: { in: toClose.map((entry) => entry.id) } }, data: { endedAt: now } });
        }
        const toCreate = desired.filter((userId) => !openIds.has(userId));
        if (toCreate.length) {
            await tx.taskTimeEntry.createMany({ data: toCreate.map((userId) => ({ taskId, userId, startedAt: now })) });
        }
    }

    async addAttachment(m: Membership, taskId: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
        const task = await this.access.loadForRead(taskId, m);
        if (!file) throw new BadRequestException('Choose a file to upload');
        const stored = await this.files.saveUpload(file.originalname, file.mimetype, file.buffer);
        const attachment = await this.prisma.taskAttachment.create({
            data: { taskId, uploadedById: m.userId, fileName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, storageKey: stored.key },
        });
        await this.prisma.taskActivity.create({
            data: { workspaceId: m.workspaceId, taskId, actorId: m.userId, type: 'ATTACHMENT_ADDED', summary: `uploaded ${file.originalname}` },
        });
        await this.notifications.notifyTaskAssignees(m.workspaceId, taskId, {
            type: 'TASK_UPDATED', title: 'File added to task', body: `${m.userId === task.createdById ? 'A file' : 'A team member'} was added to “${task.title}”`,
            taskId, dedupeKey: `attachment:${attachment.id}`, excludeUserId: m.userId,
        });
        return attachment;
    }

    async attachmentDownload(m: Membership, taskId: string, attachmentId: string) {
        const task = await this.access.loadForRead(taskId, m);
        const attachment = task.attachments.find((item) => item.id === attachmentId);
        if (!attachment) throw new NotFoundException('Attachment not found');
        if (process.env.S3_BUCKET) return this.files.createDownloadUrl(attachment.storageKey);
        const content = await this.files.readUpload(attachment.storageKey);
        return { attachment, content: content.toString('base64') };
    }

    private isInvolved(task: { assignees: { userId: string }[]; collaborators: { userId: string }[] }, userId: string) {
        return (
            task.assignees.some((a) => a.userId === userId) ||
            task.collaborators.some((c) => c.userId === userId)
        );
    }

    private async nextReference(tx: Prisma.TransactionClient, workspaceId: string) {
        const last = await tx.task.findFirst({
            where: { workspaceId },
            orderBy: { reference: 'desc' },
            select: { reference: true },
        });
        return (last?.reference ?? 0) + 1;
    }

    private async resolveTags(
        tx: Prisma.TransactionClient,
        workspaceId: string,
        names: string[],
    ) {
        const cleaned = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
        const tags = await Promise.all(
            cleaned.map((name) =>
                tx.tag.upsert({
                    where: { workspaceId_name: { workspaceId, name } },
                    update: {},
                    create: { workspaceId, name },
                }),
            ),
        );
        return tags.map((t) => ({ tagId: t.id }));
    }

    private async validateRelations(workspaceId: string, dto: Partial<CreateTaskDto>) {
        const userIds = [...(dto.assigneeIds ?? []), ...(dto.collaboratorIds ?? [])];
        if (userIds.length) {
            const count = await this.prisma.workspaceMember.count({
                where: { workspaceId, userId: { in: userIds }, isActive: true },
            });
            if (count !== new Set(userIds).size) {
                throw new BadRequestException('One or more selected people are not active workspace members');
            }
        }
        if (dto.workstreamId) {
            const ws = await this.prisma.workstream.count({ where: { id: dto.workstreamId, workspaceId } });
            if (!ws) throw new BadRequestException('Workstream not found in this workspace');
        }
        if (dto.dependencyIds?.length) {
            const deps = await this.prisma.task.count({
                where: { id: { in: dto.dependencyIds }, workspaceId },
            });
            if (deps !== dto.dependencyIds.length) {
                throw new BadRequestException('One or more dependencies are invalid');
            }
        }
    }

    private async addDependenciesTx(
        tx: Prisma.TransactionClient,
        taskId: string,
        dependsOnIds: string[],
        workspaceId: string,
    ) {
        const unique = [...new Set(dependsOnIds)].filter((id) => id !== taskId);
        if (!unique.length) return;

        const edges = await tx.taskDependency.findMany({
            where: { task: { workspaceId } },
            select: { taskId: true, dependsOnId: true },
        });

        for (const dependsOnId of unique) {
            const graph = new Map<string, string[]>();
            for (const e of edges) {
                graph.set(e.taskId, [...(graph.get(e.taskId) ?? []), e.dependsOnId]);
            }
            graph.set(taskId, [...(graph.get(taskId) ?? []), dependsOnId]);

            if (this.createsCycle(graph, taskId)) {
                throw new BadRequestException(
                    'This dependency would create a circular relationship between tasks',
                );
            }
        }

        await tx.taskDependency.createMany({
            data: unique.map((dependsOnId) => ({ taskId, dependsOnId })),
            skipDuplicates: true,
        });

        await tx.taskActivity.createMany({
            data: unique.map((dependsOnId) => ({
                workspaceId,
                taskId,
                actorId: (undefined as unknown) as string,
                type: 'DEPENDENCY_ADDED' as ActivityType,
                summary: 'added a task dependency',
                metadata: { dependsOnId },
            })),
            skipDuplicates: true,
        }).catch(() => undefined);
    }

    private createsCycle(graph: Map<string, string[]>, start: string): boolean {
        const seen = new Set<string>();
        const stack = [start];
        while (stack.length) {
            const node = stack.pop()!;
            if (seen.has(node)) return true;
            seen.add(node);
            stack.push(...(graph.get(node) ?? []));
        }
        return false;
    }

    private diffEvents(
        before: Record<string, any>,
        after: Record<string, any>,
    ): { type: ActivityType; summary: string; metadata?: Record<string, unknown> }[] {
        const events: { type: ActivityType; summary: string; metadata?: Record<string, unknown> }[] = [];
        if (after.status && after.status !== before.status) {
            events.push({
                type: 'STATUS_CHANGED',
                summary: `moved task from ${before.status} to ${after.status}`,
                metadata: { from: before.status, to: after.status },
            });
        }
        if (after.priority && after.priority !== before.priority) {
            events.push({
                type: 'PRIORITY_CHANGED',
                summary: `changed priority from ${before.priority} to ${after.priority}`,
                metadata: { from: before.priority, to: after.priority },
            });
        }
        const datesChanged =
            (after.dueDate && +new Date(after.dueDate) !== +(before.dueDate ? new Date(before.dueDate) : 0)) ||
            (after.startDate && +new Date(after.startDate) !== +(before.startDate ? new Date(before.startDate) : 0));
        if (datesChanged) {
            events.push({ type: 'DATES_CHANGED', summary: 'changed the task schedule' });
        }
        return events;
    }

    private extractMentions(
        body: string,
        members: { userId: string; user: { id: string; name: string; email: string } }[],
    ): string[] {
        const handles = [...body.matchAll(/@([\w.\-]+)/g)].map((m) => m[1].toLowerCase());
        if (!handles.length) return [];
        const ids = new Set<string>();
        for (const member of members) {
            const nameSlug = member.user.name.toLowerCase().replace(/\s+/g, '.');
            const emailLocal = member.user.email.split('@')[0].toLowerCase();
            if (handles.includes(nameSlug) || handles.includes(emailLocal)) ids.add(member.userId);
        }
        return [...ids];
    }
}

const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);