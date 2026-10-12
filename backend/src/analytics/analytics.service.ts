// apps/api/src/analytics/analytics.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Membership } from '../common/decorators';

const DAY = 86_400_000;

@Injectable()
export class AnalyticsService {
    constructor(private prisma: PrismaService) { }

    /** Leader dashboard: everything computed live from the database. */
    async leaderDashboard(m: Membership) {
        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const in7 = new Date(now.getTime() + 7 * DAY);
        const base = { workspaceId: m.workspaceId, isArchived: false };

        const [
            total,
            byStatus,
            byPriority,
            overdue,
            dueSoon,
            unassigned,
            awaitingReview,
            members,
            upcoming,
            recentActivity,
        ] = await Promise.all([
            this.prisma.task.count({ where: base }),
            this.prisma.task.groupBy({ by: ['status'], where: base, _count: true }),
            this.prisma.task.groupBy({ by: ['priority'], where: base, _count: true }),
            this.prisma.task.count({ where: { ...base, dueDate: { lt: now }, status: { not: 'DONE' } } }),
            this.prisma.task.count({
                where: { ...base, dueDate: { gte: now, lte: in7 }, status: { not: 'DONE' } },
            }),
            this.prisma.task.count({ where: { ...base, assignees: { none: {} } } }),
            this.prisma.task.count({ where: { ...base, status: 'IN_REVIEW' } }),
            this.prisma.workspaceMember.findMany({
                where: { workspaceId: m.workspaceId, isActive: true },
                include: { user: { select: { id: true, name: true, avatarUrl: true, lastLoginAt: true, lastSeenAt: true, isOnline: true } } },
            }),
            this.prisma.task.findMany({
                where: { ...base, status: { not: 'DONE' }, dueDate: { gte: now } },
                orderBy: { dueDate: 'asc' },
                take: 8,
                select: {
                    id: true, reference: true, title: true, dueDate: true, priority: true, status: true,
                    assignees: { select: { user: { select: { id: true, name: true } } } },
                },
            }),
            this.prisma.taskActivity.findMany({
                where: { workspaceId: m.workspaceId },
                orderBy: { createdAt: 'desc' },
                take: 15,
                include: {
                    actor: { select: { id: true, name: true, avatarUrl: true } },
                    task: { select: { id: true, reference: true, title: true } },
                },
            }),
        ]);

        const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
        const done = statusMap.DONE ?? 0;

        // Per-member workload, derived from actual assignments.
        const workload = await Promise.all(
            members.map(async (member) => {
                const [assigned, completed, hours, logged] = await Promise.all([
                    this.prisma.task.count({
                        where: { ...base, assignees: { some: { userId: member.userId } }, status: { not: 'DONE' } },
                    }),
                    this.prisma.task.count({
                        where: { ...base, assignees: { some: { userId: member.userId } }, status: 'DONE' },
                    }),
                    this.prisma.task.aggregate({
                        where: { ...base, assignees: { some: { userId: member.userId } }, status: { not: 'DONE' } },
                        _sum: { estimatedHrs: true },
                    }),
                    this.prisma.task.aggregate({
                        where: { ...base, assignees: { some: { userId: member.userId } } },
                        _sum: { actualHrs: true },
                    }),
                ]);
                return {
                    userId: member.userId,
                    name: member.user.name,
                    avatarUrl: member.user.avatarUrl,
                    specialty: member.specialty,
                    activeTasks: assigned,
                    completedTasks: completed,
                    estimatedHours: hours._sum.estimatedHrs ?? 0,
                    loggedHours: logged._sum.actualHrs ?? 0,
                };
            }),
        );

        const timeEntries = await this.prisma.taskTimeEntry.findMany({
            where: {
                task: { workspaceId: m.workspaceId },
                startedAt: { lt: now },
                OR: [{ endedAt: null }, { endedAt: { gte: todayStart } }],
            },
            include: { task: { select: { id: true, title: true, reference: true } } },
        });
        const teamTimeToday = members.map((member) => {
            const entries = timeEntries.filter((entry) => entry.userId === member.userId);
            const presenceFresh = Boolean(
                member.user.isOnline && member.user.lastSeenAt && now.getTime() - member.user.lastSeenAt.getTime() < 90_000,
            );
            const workedMs = entries.reduce((sum, entry) => {
                const from = Math.max(entry.startedAt.getTime(), todayStart.getTime());
                const fallbackEnd = presenceFresh ? now : (member.user.lastSeenAt ?? entry.startedAt);
                const to = Math.min((entry.endedAt ?? fallbackEnd).getTime(), now.getTime());
                return sum + Math.max(0, to - from);
            }, 0);
            const activeTasks = presenceFresh ? entries.filter((entry) => entry.endedAt === null).map((entry) => ({
                id: entry.task.id,
                reference: entry.task.reference,
                title: entry.task.title,
                startedAt: entry.startedAt,
            })) : [];
            return {
                userId: member.userId,
                name: member.user.name,
                avatarUrl: member.user.avatarUrl,
                openedToday: Boolean(member.user.lastLoginAt && member.user.lastLoginAt >= todayStart),
                workedSecondsToday: Math.floor(workedMs / 1000),
                activeToday: workedMs > 0,
                activeTasks,
            };
        });

        return {
            totals: {
                total,
                done,
                inProgress: statusMap.IN_PROGRESS ?? 0,
                notStarted: (statusMap.BACKLOG ?? 0) + (statusMap.TODO ?? 0),
                blocked: statusMap.BLOCKED ?? 0,
                overdue,
                dueSoon,
                unassigned,
                awaitingReview,
                completionPercent: total ? Math.round((done / total) * 100) : 0,
            },
            byStatus: statusMap,
            byPriority: Object.fromEntries(byPriority.map((p) => [p.priority, p._count])),
            workload,
            teamTimeToday,
            upcoming,
            recentActivity,
        };
    }

    /** Member dashboard: strictly scoped to the signed-in user. */
    async memberDashboard(m: Membership) {
        const now = new Date();
        const endOfToday = new Date(now);
        endOfToday.setHours(23, 59, 59, 999);
        const in7 = new Date(now.getTime() + 7 * DAY);

        const scope = {
            workspaceId: m.workspaceId,
            isArchived: false,
            OR: [
                { assignees: { some: { userId: m.userId } } },
                { collaborators: { some: { userId: m.userId } } },
            ],
        };

        const [mine, dueToday, overdue, upcoming, awaitingReview, agg, recent] = await Promise.all([
            this.prisma.task.findMany({
                where: scope,
                orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
                take: 50,
                include: { workstream: true, tags: { include: { tag: true } } },
            }),
            this.prisma.task.count({
                where: { ...scope, dueDate: { gte: now, lte: endOfToday }, status: { not: 'DONE' } },
            }),
            this.prisma.task.count({ where: { ...scope, dueDate: { lt: now }, status: { not: 'DONE' } } }),
            this.prisma.task.findMany({
                where: { ...scope, dueDate: { gt: now, lte: in7 }, status: { not: 'DONE' } },
                orderBy: { dueDate: 'asc' },
                take: 10,
                select: { id: true, reference: true, title: true, dueDate: true, priority: true, status: true },
            }),
            this.prisma.task.count({ where: { ...scope, status: 'IN_REVIEW' } }),
            this.prisma.task.aggregate({
                where: scope,
                _sum: { estimatedHrs: true, actualHrs: true },
                _count: true,
            }),
            this.prisma.task.findMany({
                where: scope,
                orderBy: { updatedAt: 'desc' },
                take: 6,
                select: { id: true, reference: true, title: true, status: true, updatedAt: true },
            }),
        ]);

        const done = mine.filter((t) => t.status === 'DONE').length;

        return {
            totals: {
                assigned: agg._count,
                dueToday,
                overdue,
                awaitingReview,
                completed: done,
                completionPercent: agg._count ? Math.round((done / agg._count) * 100) : 0,
                estimatedHours: agg._sum.estimatedHrs ?? 0,
                loggedHours: agg._sum.actualHrs ?? 0,
            },
            tasks: mine,
            upcoming,
            recentlyUpdated: recent,
        };
    }

    async reports(
        m: Membership,
        filters: { from?: string; to?: string; assigneeId?: string; workstreamId?: string },
    ) {
        const where = {
            workspaceId: m.workspaceId,
            isArchived: false,
            ...(filters.from || filters.to
                ? {
                    createdAt: {
                        ...(filters.from ? { gte: new Date(filters.from) } : {}),
                        ...(filters.to ? { lte: new Date(filters.to) } : {}),
                    },
                }
                : {}),
            ...(filters.assigneeId ? { assignees: { some: { userId: filters.assigneeId } } } : {}),
            ...(filters.workstreamId ? { workstreamId: filters.workstreamId } : {}),
        };

        const [byStatus, byPriority, byWorkstream, hours, onTime] = await Promise.all([
            this.prisma.task.groupBy({ by: ['status'], where, _count: true }),
            this.prisma.task.groupBy({ by: ['priority'], where, _count: true }),
            this.prisma.task.groupBy({ by: ['workstreamId'], where, _count: true }),
            this.prisma.task.aggregate({ where, _sum: { estimatedHrs: true, actualHrs: true } }),
            this.prisma.task.count({
                where: { ...where, status: 'DONE', completedAt: { not: null } },
            }),
        ]);

        const completedTasks = await this.prisma.task.findMany({
            where: { ...where, status: 'DONE', completedAt: { not: null } },
            select: { completedAt: true, dueDate: true, workstreamId: true },
        });

        const onTimeCount = completedTasks.filter(
            (t) => !t.dueDate || (t.completedAt && t.completedAt <= t.dueDate),
        ).length;

        const workstreams = await this.prisma.workstream.findMany({
            where: { workspaceId: m.workspaceId },
            select: { id: true, name: true },
        });
        const nameById = new Map(workstreams.map((w) => [w.id, w.name]));

        const trend = this.buildCompletionTrend(completedTasks);

        return {
            byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
            byPriority: Object.fromEntries(byPriority.map((p) => [p.priority, p._count])),
            byWorkstream: Object.fromEntries(
                byWorkstream.map((w) => [w.workstreamId ? nameById.get(w.workstreamId) ?? 'Other' : 'Unassigned', w._count]),
            ),
            hours: {
                estimated: hours._sum.estimatedHrs ?? 0,
                actual: hours._sum.actualHrs ?? 0,
            },
            onTime: {
                completed: completedTasks.length,
                onTime: onTimeCount,
                late: completedTasks.length - onTimeCount,
                percent: completedTasks.length
                    ? Math.round((onTimeCount / completedTasks.length) * 100)
                    : 0,
            },
            trend,
            totalCompleted: onTime,
        };
    }

    private buildCompletionTrend(tasks: { completedAt: Date | null }[]) {
        const buckets = new Map<string, number>();
        for (const task of tasks) {
            if (!task.completedAt) continue;
            const key = task.completedAt.toISOString().slice(0, 10);
            buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
        return [...buckets.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, count]) => ({ date, count }));
    }
}
