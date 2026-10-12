// apps/api/src/notifications/reminders.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const HOUR = 60 * 60 * 1000;

@Injectable()
export class RemindersService {
    private readonly logger = new Logger(RemindersService.name);
    private running = false;

    constructor(private prisma: PrismaService, private notifications: NotificationsService) { }

    /**
     * Scans for approaching and overdue deadlines. Every notification carries a
     * deterministic dedupeKey so a reminder is never sent twice for the same
     * task/user/bucket, even across restarts or overlapping runs.
     */
    @Cron(CronExpression.EVERY_10_MINUTES)
    async scan() {
        if (this.running) return;
        this.running = true;
        try {
            const now = new Date();

            const tasks = await this.prisma.task.findMany({
                where: {
                    isArchived: false,
                    status: { not: 'DONE' },
                    dueDate: { not: null, lt: new Date(now.getTime() + 25 * HOUR) },
                },
                select: {
                    id: true,
                    workspaceId: true,
                    title: true,
                    dueDate: true,
                    assignees: { select: { userId: true } },
                },
            });

            for (const task of tasks) {
                if (!task.dueDate || !task.assignees.length) continue;
                const msRemaining = task.dueDate.getTime() - now.getTime();
                const userIds = task.assignees.map((a) => a.userId);

                if (msRemaining <= 0) {
                    // Overdue — re-notify at most once per day per task.
                    const bucket = `overdue-${task.dueDate.toISOString().slice(0, 10)}-${Math.floor(
                        (now.getTime() - task.dueDate.getTime()) / (24 * HOUR),
                    )}`;
                    await this.notifications.notifyUsers(task.workspaceId, userIds, {
                        type: 'TASK_OVERDUE',
                        title: 'Task overdue',
                        body: `“${task.title}” was due ${task.dueDate.toDateString()}`,
                        taskId: task.id,
                        dedupeKey: `overdue:${task.id}:${bucket}`,
                    });
                    continue;
                }

                if (msRemaining <= 1.25 * HOUR) {
                    await this.notifications.notifyUsers(task.workspaceId, userIds, {
                        type: 'DEADLINE_APPROACHING',
                        title: 'Deadline in 1 hour',
                        body: `“${task.title}” is due very soon`,
                        taskId: task.id,
                        dedupeKey: `remind1h:${task.id}:${task.dueDate.toISOString()}`,
                    });
                } else if (msRemaining <= 24.5 * HOUR) {
                    await this.notifications.notifyUsers(task.workspaceId, userIds, {
                        type: 'DEADLINE_APPROACHING',
                        title: 'Deadline tomorrow',
                        body: `“${task.title}” is due ${task.dueDate.toDateString()}`,
                        taskId: task.id,
                        dedupeKey: `remind24h:${task.id}:${task.dueDate.toISOString()}`,
                    });
                }
            }

            // Housekeeping: expire stale invitations and purge dead subscriptions.
            await this.prisma.invitation.updateMany({
                where: { status: 'PENDING', expiresAt: { lt: now } },
                data: { status: 'EXPIRED' },
            });
        } catch (err) {
            this.logger.error('Reminder scan failed', err as Error);
        } finally {
            this.running = false;
        }
    }
}