// apps/api/src/notifications/notifications.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Role } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

interface NotifyPayload {
    type: NotificationType;
    title: string;
    body: string;
    taskId?: string;
    url?: string;
    dedupeKey?: string;
    excludeUserId?: string;
}

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);
    private pushReady = false;

    constructor(private prisma: PrismaService) {
        const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
        if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
            webpush.setVapidDetails(
                VAPID_SUBJECT ?? 'mailto:admin@example.com',
                VAPID_PUBLIC_KEY,
                VAPID_PRIVATE_KEY,
            );
            this.pushReady = true;
        } else {
            this.logger.warn('VAPID keys are not configured — push delivery is disabled');
        }
    }

    get publicKey() {
        return process.env.VAPID_PUBLIC_KEY ?? null;
    }

    // ---------------------------------------------------------------- creation

    /** Creates an in-app notification and pushes it. Never throws on push failure. */
    async notifyUsers(workspaceId: string, userIds: string[], payload: NotifyPayload) {
        const recipients = [...new Set(userIds)].filter(
            (id) => id && id !== payload.excludeUserId,
        );
        if (!recipients.length) return;

        const records = await this.prisma.$transaction(
            recipients.map((userId) =>
                this.prisma.notification.upsert({
                    where: { dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}:${userId}` : `__none__:${userId}:${Math.random()}` },
                    update: {},
                    create: {
                        userId,
                        workspaceId,
                        type: payload.type,
                        title: payload.title,
                        body: payload.body,
                        taskId: payload.taskId ?? null,
                        url: payload.url ?? (payload.taskId ? `/tasks/${payload.taskId}` : '/notifications'),
                        dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}:${userId}` : null,
                    },
                }),
            ),
        );

        await Promise.all(
            records.map((record) =>
                this.deliver(record.id, record.userId).catch((err) => {
                    this.logger.warn(`Push delivery failed for ${record.userId}: ${err.message}`);
                }),
            ),
        );
    }

    async notifyTaskAssignees(workspaceId: string, taskId: string, payload: NotifyPayload) {
        const task = await this.prisma.task.findUnique({
            where: { id: taskId },
            include: { assignees: true, collaborators: true },
        });
        if (!task) return;
        const ids = [
            ...task.assignees.map((a) => a.userId),
            ...task.collaborators.map((c) => c.userId),
        ];
        await this.notifyUsers(workspaceId, ids, payload);
    }

    async notifyLeaders(workspaceId: string, payload: NotifyPayload) {
        const leaders = await this.prisma.workspaceMember.findMany({
            where: { workspaceId, role: Role.LEADER, isActive: true },
            select: { userId: true },
        });
        await this.notifyUsers(workspaceId, leaders.map((l) => l.userId), payload);
    }

    async notifyAssignment(
        taskId: string,
        workspaceId: string,
        assigneeIds: string[],
        actorId: string,
        isReassignment: boolean,
    ) {
        const task = await this.prisma.task.findUnique({
            where: { id: taskId },
            select: { title: true, dueDate: true },
        });
        if (!task || !assigneeIds.length) return;
        await this.notifyUsers(workspaceId, assigneeIds, {
            type: isReassignment ? 'TASK_REASSIGNED' : 'TASK_ASSIGNED',
            title: isReassignment ? 'Task reassigned to you' : 'New task assigned',
            body: task.dueDate
                ? `${task.title} · due ${task.dueDate.toDateString()}`
                : task.title,
            taskId,
            dedupeKey: `assign:${taskId}:${Date.now()}`,
            excludeUserId: actorId,
        });
    }

    async notifyTaskInvolvement(
        taskId: string,
        workspaceId: string,
        userIds: string[],
        actorId: string,
        title: string,
    ) {
        const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { title: true } });
        if (!task || !userIds.length) return;
        await this.notifyUsers(workspaceId, userIds, {
            type: 'TASK_ASSIGNED',
            title,
            body: task.title,
            taskId,
            dedupeKey: `involvement:${taskId}:${Date.now()}`,
            excludeUserId: actorId,
        });
    }

    /** Fires when a task moves to DONE and unblocks its dependents. */
    async notifyDependents(workspaceId: string, completedTaskId: string) {
        const dependents = await this.prisma.taskDependency.findMany({
            where: { dependsOnId: completedTaskId },
            include: {
                task: {
                    select: {
                        id: true,
                        title: true,
                        assignees: { select: { userId: true } },
                    },
                },
            },
        });
        for (const dep of dependents) {
            await this.notifyUsers(
                workspaceId,
                dep.task.assignees.map((a) => a.userId),
                {
                    type: 'DEPENDENCY_COMPLETED',
                    title: 'You are unblocked',
                    body: `A dependency for “${dep.task.title}” is complete`,
                    taskId: dep.task.id,
                    dedupeKey: `dep:${dep.task.id}:${completedTaskId}`,
                },
            );
        }
    }

    async handleTaskUpdated(
        before: { id: string; title: string; description: string | null; status: string; priority: string; dueDate: Date | null; startDate: Date | null; estimatedHrs: number | null; progress: number; workstreamId: string | null },
        after: { id: string; title: string; description: string | null; status: string; priority: string; dueDate: Date | null; startDate: Date | null; estimatedHrs: number | null; progress: number; workstreamId: string | null },
        actorId: string,
        relationsChanged = false,
    ) {
        const workspaceId = (await this.prisma.task.findUnique({ where: { id: before.id }, select: { workspaceId: true } }))!.workspaceId;
        const statusChanged = before.status !== after.status;

        const dateChanged =
            +new Date(before.dueDate ?? 0) !== +new Date(after.dueDate ?? 0) ||
            +new Date(before.startDate ?? 0) !== +new Date(after.startDate ?? 0);

        const otherMaterial = before.priority !== after.priority || before.title !== after.title ||
            before.description !== after.description || before.estimatedHrs !== after.estimatedHrs ||
            before.progress !== after.progress || before.workstreamId !== after.workstreamId ||
            dateChanged || relationsChanged;

        if (statusChanged) {
            await this.notifyTaskAssignees(workspaceId, after.id, {
                type: 'TASK_UPDATED',
                title: 'Task status changed',
                body: `“${after.title}” moved from ${before.status.replaceAll('_', ' ')} to ${after.status.replaceAll('_', ' ')}`,
                taskId: after.id,
                dedupeKey: `status:${after.id}:${after.status}:${Date.now()}`,
                excludeUserId: actorId,
            });
        }

        if (!otherMaterial) return;

        if (dateChanged) {
            await this.notifyTaskAssignees(workspaceId, after.id, {
                type: 'TASK_DATES_CHANGED',
                title: 'Task schedule changed',
                body: after.dueDate
                    ? `“${after.title}” is now due ${after.dueDate.toDateString()}`
                    : `The schedule for “${after.title}” changed`,
                taskId: after.id,
                dedupeKey: `dates:${after.id}:${Date.now()}`,
                excludeUserId: actorId,
            });
        }

        await this.notifyTaskAssignees(workspaceId, after.id, {
            type: 'TASK_UPDATED',
            title: 'Task updated',
            body: after.title,
            taskId: after.id,
            dedupeKey: `updated:${after.id}:${Date.now()}`,
            excludeUserId: actorId,
        });
    }

    // ---------------------------------------------------------------- delivery

    private async deliver(notificationId: string, userId: string) {
        if (!this.pushReady) return;

        const preference = await this.prisma.notificationPreference.findUnique({
            where: { userId },
        });
        if (preference && !preference.pushEnabled) return;

        const notification = await this.prisma.notification.findUnique({
            where: { id: notificationId },
        });
        if (!notification) return;

        if (!this.typeAllowed(preference, notification.type)) return;

        const subscriptions = await this.prisma.pushSubscription.findMany({
            where: { userId, failedAt: null },
        });
        if (!subscriptions.length) return;

        const payload = JSON.stringify({
            id: notification.id,
            title: notification.title,
            body: notification.body,
            url: notification.url ?? '/notifications',
            type: notification.type,
            tag: notification.dedupeKey ?? notification.id,
        });

        await Promise.all(
            subscriptions.map(async (sub) => {
                try {
                    await webpush.sendNotification(
                        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                        payload,
                        { TTL: 60 * 60 * 24 },
                    );
                    await this.prisma.pushSubscription.update({
                        where: { id: sub.id },
                        data: { lastUsedAt: new Date() },
                    });
                } catch (err: any) {
                    // 404/410 means the subscription is permanently gone.
                    if (err?.statusCode === 404 || err?.statusCode === 410) {
                        await this.prisma.pushSubscription.update({
                            where: { id: sub.id },
                            data: { failedAt: new Date() },
                        });
                    }
                    throw err;
                }
            }),
        );
    }

    private typeAllowed(
        pref: Record<string, any> | null,
        type: NotificationType,
    ): boolean {
        if (!pref) return true;
        const map: Partial<Record<NotificationType, string>> = {
            TASK_ASSIGNED: 'taskAssigned',
            TASK_REASSIGNED: 'taskReassigned',
            TASK_DATES_CHANGED: 'taskDatesChanged',
            TASK_UPDATED: 'taskUpdated',
            COMMENT_MENTION: 'commentMention',
            COMMENT_ADDED: 'commentAdded',
            REVIEW_REQUESTED: 'reviewEvents',
            REVIEW_APPROVED: 'reviewEvents',
            REVIEW_CHANGES_REQUESTED: 'reviewEvents',
            DEADLINE_APPROACHING: 'deadlineApproaching',
            TASK_OVERDUE: 'taskOverdue',
            DEPENDENCY_COMPLETED: 'dependencyCompleted',
        };
        const key = map[type];
        return key ? pref[key] !== false : true;
    }

    // ---------------------------------------------------------------- subscriptions

    async registerSubscription(
        userId: string,
        sub: { endpoint: string; keys: { p256dh: string; auth: string } },
        userAgent?: string,
    ) {
        return this.prisma.pushSubscription.upsert({
            where: { endpoint: sub.endpoint },
            update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, failedAt: null, lastUsedAt: new Date() },
            create: {
                userId,
                endpoint: sub.endpoint,
                p256dh: sub.keys.p256dh,
                auth: sub.keys.auth,
                userAgent,
            },
        });
    }

    async removeSubscription(userId: string, endpoint: string) {
        await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
        return { ok: true };
    }

    // ---------------------------------------------------------------- inbox

    async list(userId: string, opts: { unreadOnly?: boolean; page: number; pageSize: number }) {
        const where = { userId, ...(opts.unreadOnly ? { readAt: null } : {}) };
        const [items, total, unread] = await this.prisma.$transaction([
            this.prisma.notification.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (opts.page - 1) * opts.pageSize,
                take: opts.pageSize,
            }),
            this.prisma.notification.count({ where }),
            this.prisma.notification.count({ where: { userId, readAt: null } }),
        ]);
        return { items, total, unread, page: opts.page, pageSize: opts.pageSize };
    }

    async markRead(userId: string, id: string) {
        const result = await this.prisma.notification.updateMany({
            where: { id, userId },
            data: { readAt: new Date() },
        });
        if (!result.count) throw new NotFoundException('Notification not found');
        return { ok: true };
    }

    async markAllRead(userId: string) {
        await this.prisma.notification.updateMany({
            where: { userId, readAt: null },
            data: { readAt: new Date() },
        });
        return { ok: true };
    }

    async unreadCount(userId: string) {
        return { count: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
    }

    // ---------------------------------------------------------------- preferences

    async getPreferences(userId: string) {
        return this.prisma.notificationPreference.upsert({
            where: { userId },
            update: {},
            create: { userId },
        });
    }

    async updatePreferences(userId: string, patch: Record<string, boolean>) {
        const allowed = [
            'pushEnabled',
            'emailEnabled',
            'taskAssigned',
            'taskReassigned',
            'taskDatesChanged',
            'taskUpdated',
            'commentMention',
            'commentAdded',
            'reviewEvents',
            'deadlineApproaching',
            'taskOverdue',
            'dependencyCompleted',
            'reminder24h',
            'reminder1h',
        ];
        const data = Object.fromEntries(
            Object.entries(patch).filter(([k, v]) => allowed.includes(k) && typeof v === 'boolean'),
        );
        return this.prisma.notificationPreference.upsert({
            where: { userId },
            update: data,
            create: { userId, ...data },
        });
    }
}
