// apps/api/src/import/import.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ActivityType, ImportStatus, Priority, TaskStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { Membership } from '../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';

const APP_FIELDS = [
    'title',
    'description',
    'assignee',
    'priority',
    'status',
    'startDate',
    'dueDate',
    'estimatedHrs',
    'workstream',
    'dependencies',
    'tags',
] as const;
type AppField = (typeof APP_FIELDS)[number];

const HEADER_HINTS: Record<AppField, string[]> = {
    title: ['task name', 'task', 'title', 'name', 'المهمة', 'اسم المهمة', 'العنوان'],
    description: ['description', 'details', 'notes', 'الوصف', 'التفاصيل'],
    assignee: ['assigned to', 'assignee', 'owner', 'responsible', 'المسؤول', 'المكلف'],
    priority: ['priority', 'importance', 'الأولوية'],
    status: ['status', 'state', 'الحالة'],
    startDate: ['start date', 'start', 'begin', 'تاريخ البداية'],
    dueDate: ['deadline', 'due date', 'due', 'end date', 'تاريخ الانتهاء', 'الموعد النهائي'],
    estimatedHrs: ['estimated hours', 'estimate', 'hours', 'effort', 'الساعات المقدرة'],
    workstream: ['category', 'workstream', 'project', 'module', 'التصنيف', 'المسار'],
    dependencies: ['dependencies', 'depends on', 'blocked by', 'الاعتماديات'],
    tags: ['tags', 'labels', 'الوسوم'],
};

const PRIORITY_ALIASES: Record<string, Priority> = {
    urgent: 'URGENT', critical: 'URGENT', blocker: 'URGENT', عاجل: 'URGENT',
    high: 'HIGH', مهم: 'HIGH', عالية: 'HIGH',
    medium: 'MEDIUM', normal: 'MEDIUM', متوسطة: 'MEDIUM',
    low: 'LOW', منخفضة: 'LOW',
};

const STATUS_ALIASES: Record<string, TaskStatus> = {
    backlog: 'BACKLOG', 'قائمة الانتظار': 'BACKLOG',
    'to do': 'TODO', todo: 'TODO', 'لم تبدأ': 'TODO', new: 'TODO',
    'in progress': 'IN_PROGRESS', 'in-progress': 'IN_PROGRESS', doing: 'IN_PROGRESS', 'قيد التنفيذ': 'IN_PROGRESS',
    'in review': 'IN_REVIEW', review: 'IN_REVIEW', 'قيد المراجعة': 'IN_REVIEW',
    blocked: 'BLOCKED', 'معطلة': 'BLOCKED',
    done: 'DONE', complete: 'DONE', completed: 'DONE', 'مكتملة': 'DONE',
};

export interface ParsedSheet {
    sheetNames: string[];
    sheetName: string;
    headers: string[];
    rows: Record<string, unknown>[];
    totalRows: number;
}

@Injectable()
export class ImportService {
    private readonly logger = new Logger(ImportService.name);

    constructor(private prisma: PrismaService, private notifications: NotificationsService) { }

    // ---------------------------------------------------------------- step 1-2: parse

    async parse(buffer: Buffer, fileName: string, sheetName?: string): Promise<ParsedSheet> {
        const isCsv = /\.csv$/i.test(fileName);
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
        if (!workbook.SheetNames.length) throw new BadRequestException('The file contains no worksheets');

        const chosen = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
        const sheet = workbook.Sheets[chosen];

        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null });
        if (!matrix.length) throw new BadRequestException('The selected worksheet is empty');

        const headerRow = (matrix[0] as unknown[]).map((h, i) =>
            String(h ?? `Column ${i + 1}`).trim() || `Column ${i + 1}`,
        );

        const rows = matrix.slice(1).map((row) => {
            const record: Record<string, unknown> = {};
            headerRow.forEach((header, i) => {
                record[header] = (row as unknown[])[i] ?? null;
            });
            return record;
        });

        // Drop completely blank trailing rows but keep row numbers accurate.
        const kept = rows.filter((r) => Object.values(r).some((v) => v !== null && String(v).trim() !== ''));
        if (!kept.length) throw new BadRequestException('No data rows were found below the header row');

        return {
            sheetNames: workbook.SheetNames,
            sheetName: chosen,
            headers: headerRow,
            rows: kept,
            totalRows: rows.length,
        };
    }

    /** Suggests a column mapping using header similarity, but never forces it. */
    suggestMapping(headers: string[]): Partial<Record<AppField, string>> {
        const mapping: Partial<Record<AppField, string>> = {};
        const used = new Set<string>();

        for (const field of APP_FIELDS) {
            const hints = HEADER_HINTS[field];
            const match = headers.find((h) => {
                if (used.has(h)) return false;
                const norm = h.toLowerCase().trim();
                return hints.some((hint) => norm === hint || norm.includes(hint) || hint.includes(norm));
            });
            if (match) {
                mapping[field] = match;
                used.add(match);
            }
        }
        return mapping;
    }

    // ---------------------------------------------------------------- step 3-5: build draft

    async buildDraft(
        m: Membership,
        payload: {
            fileName: string;
            sheetName: string;
            rows: Record<string, unknown>[];
            mapping: Record<string, string | null>;
            resolvedAssignees?: Record<string, string | null>;
        },
    ) {
        const members = await this.prisma.workspaceMember.findMany({
            where: { workspaceId: m.workspaceId, isActive: true },
            include: { user: { select: { id: true, name: true, email: true } } },
        });

        const byEmail = new Map(members.map((mm) => [mm.user.email.toLowerCase(), mm.user]));
        const byName = new Map(
            members.map((mm) => [mm.user.name.toLowerCase().replace(/\s+/g, ' ').trim(), mm.user]),
        );

        const seenTitles = new Map<string, number>();
        const draft = payload.rows.map((row, index) => {
            const rowNumber = index + 2; // 1-based, +1 for the header row
            const get = (field: AppField) => {
                const column = payload.mapping[field];
                return column ? row[column] : null;
            };

            const issues: { field?: string; message: string; severity: 'error' | 'warning' }[] = [];

            const rawTitle = get('title');
            const title = rawTitle === null || rawTitle === undefined ? '' : String(rawTitle).trim();
            if (!title) issues.push({ field: 'title', message: 'Missing task title', severity: 'error' });
            else if (title.length > 200)
                issues.push({ field: 'title', message: 'Title exceeds 200 characters', severity: 'error' });

            const dupKey = title.toLowerCase();
            if (title && seenTitles.has(dupKey)) {
                issues.push({
                    field: 'title',
                    message: `Possible duplicate of row ${seenTitles.get(dupKey)}`,
                    severity: 'warning',
                });
            } else if (title) {
                seenTitles.set(dupKey, rowNumber);
            }

            const priority = this.parsePriority(get('priority'));
            if (get('priority') && !priority) {
                issues.push({ field: 'priority', message: 'Unrecognised priority — defaulted to Medium', severity: 'warning' });
            }

            const status = this.parseStatus(get('status'));
            if (get('status') && !status) {
                issues.push({ field: 'status', message: 'Unrecognised status — defaulted to Backlog', severity: 'warning' });
            }

            const startDate = this.parseDate(get('startDate'));
            const dueDate = this.parseDate(get('dueDate'));
            if (get('startDate') && !startDate)
                issues.push({ field: 'startDate', message: 'Invalid start date', severity: 'warning' });
            if (get('dueDate') && !dueDate)
                issues.push({ field: 'dueDate', message: 'Invalid deadline', severity: 'warning' });
            if (startDate && dueDate && startDate > dueDate) {
                issues.push({ field: 'dueDate', message: 'Deadline is before the start date', severity: 'error' });
            }

            const estimatedHrs = this.parseNumber(get('estimatedHrs'));
            if (get('estimatedHrs') !== null && get('estimatedHrs') !== '' && estimatedHrs === null) {
                issues.push({ field: 'estimatedHrs', message: 'Invalid estimated hours', severity: 'warning' });
            }
            if (estimatedHrs !== null && estimatedHrs < 0) {
                issues.push({ field: 'estimatedHrs', message: 'Estimated hours cannot be negative', severity: 'error' });
            }

            // ---- assignee resolution
            let assigneeUserId: string | null = null;
            let suggestedUserId: string | null = null;
            const rawAssignee = get('assignee');
            const assigneeText = rawAssignee === null || rawAssignee === undefined ? '' : String(rawAssignee).trim();

            if (assigneeText) {
                const override = payload.resolvedAssignees?.[String(rowNumber)];
                if (override !== undefined) {
                    assigneeUserId = override;
                } else if (assigneeText.includes('@')) {
                    // Exact email match is safe to auto-apply.
                    assigneeUserId = byEmail.get(assigneeText.toLowerCase())?.id ?? null;
                    if (!assigneeUserId) {
                        issues.push({
                            field: 'assignee',
                            message: `No member with email “${assigneeText}”`,
                            severity: 'warning',
                        });
                    }
                } else {
                    // Name matching is only ever a suggestion — never auto-applied.
                    const found = byName.get(assigneeText.toLowerCase().replace(/\s+/g, ' '));
                    if (found) suggestedUserId = found.id;
                    else
                        issues.push({
                            field: 'assignee',
                            message: `Could not match “${assigneeText}” to a team member`,
                            severity: 'warning',
                        });
                }
            }

            const dependencies = this.parseList(get('dependencies'));
            const tags = this.parseList(get('tags'));

            return {
                rowNumber,
                title,
                description: get('description') ? String(get('description')).trim() : null,
                priority: priority ?? 'MEDIUM',
                status: status ?? 'BACKLOG',
                startDate: startDate?.toISOString() ?? null,
                dueDate: dueDate?.toISOString() ?? null,
                estimatedHrs,
                workstreamName: get('workstream') ? String(get('workstream')).trim() : null,
                assigneeUserId,
                suggestedUserId,
                assigneeRaw: assigneeText || null,
                dependencyRefs: dependencies,
                tagNames: tags,
                issues,
                valid: !issues.some((i) => i.severity === 'error'),
            };
        });

        return {
            fileName: payload.fileName,
            sheetName: payload.sheetName,
            mapping: payload.mapping,
            rows: draft,
            summary: {
                total: draft.length,
                valid: draft.filter((r) => r.valid).length,
                warnings: draft.filter((r) => r.valid && r.issues.length).length,
                invalid: draft.filter((r) => !r.valid).length,
                unresolvedAssignees: draft.filter((r) => r.assigneeRaw && !r.assigneeUserId).length,
                duplicates: draft.filter((r) => r.issues.some((i) => i.message.startsWith('Possible duplicate'))).length,
            },
            members: members.map((mm) => ({
                id: mm.user.id,
                name: mm.user.name,
                email: mm.user.email,
                specialty: mm.specialty,
            })),
        };
    }

    // ---------------------------------------------------------------- step 6-7: commit

    async commit(
        m: Membership,
        payload: {
            fileName: string;
            rows: ReturnType<ImportService['normaliseDraftRow']>[];
            sheetName?: string;
            mapping?: Record<string, string | null>;
        },
    ) {
        if (!payload.rows?.length) throw new BadRequestException('No rows were submitted for import');

        const job = await this.prisma.importJob.create({
            data: {
                workspaceId: m.workspaceId,
                userId: m.userId,
                fileName: payload.fileName,
                status: 'PROCESSING',
                totalRows: payload.rows.length,
                mapping: (payload.mapping ?? {}) as object,
            },
        });

        const errors: { rowNumber: number; field?: string; message: string; rawRow: object }[] = [];
        let created = 0;
        let skipped = 0;
        let unassigned = 0;

        // Server-side revalidation — never trust the client's draft.
        const rowSchema = z.object({
            rowNumber: z.number().int().positive(),
            title: z.string().min(1).max(200),
            description: z.string().max(10_000).nullable().optional(),
            priority: z.enum(['URGENT', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
            status: z
                .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'])
                .default('BACKLOG'),
            startDate: z.string().nullable().optional(),
            dueDate: z.string().nullable().optional(),
            estimatedHrs: z.number().min(0).max(9999).nullable().optional(),
            workstreamName: z.string().max(80).nullable().optional(),
            assigneeUserId: z.string().nullable().optional(),
            tagNames: z.array(z.string().max(40)).max(20).default([]),
            dependencyRefs: z.array(z.string()).default([]),
            excluded: z.boolean().optional(),
        });

        const BATCH = 25;
        const reference = await this.currentReference(m.workspaceId);

        for (let i = 0; i < payload.rows.length; i += BATCH) {
            const batch = payload.rows.slice(i, i + BATCH);

            for (const raw of batch) {
                if (raw.excluded) {
                    skipped += 1;
                    continue;
                }
                const parsed = rowSchema.safeParse(raw);
                if (!parsed.success) {
                    errors.push({
                        rowNumber: raw.rowNumber ?? 0,
                        message: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '),
                        rawRow: raw as unknown as object,
                    });
                    continue;
                }
                const row = parsed.data;

                try {
                    await this.prisma.$transaction(async (tx) => {
                        const workstream = row.workstreamName
                            ? await tx.workstream.upsert({
                                where: { workspaceId_name: { workspaceId: m.workspaceId, name: row.workstreamName } },
                                update: {},
                                create: { workspaceId: m.workspaceId, name: row.workstreamName },
                            })
                            : null;

                        const task = await tx.task.create({
                            data: {
                                workspaceId: m.workspaceId,
                                reference: reference + created + 1,
                                title: row.title,
                                description: row.description ?? null,
                                workstreamId: workstream?.id ?? null,
                                createdById: m.userId,
                                priority: row.priority as Priority,
                                status: row.status as TaskStatus,
                                startDate: row.startDate ? new Date(row.startDate) : null,
                                dueDate: row.dueDate ? new Date(row.dueDate) : null,
                                estimatedHrs: row.estimatedHrs ?? null,
                                completedAt: row.status === 'DONE' ? new Date() : null,
                                progress: row.status === 'DONE' ? 100 : 0,
                                assignees: row.assigneeUserId ? { create: [{ userId: row.assigneeUserId }] } : undefined,
                            },
                        });

                        if (row.tagNames.length) {
                            const tags = await Promise.all(
                                row.tagNames.map((name) =>
                                    tx.tag.upsert({
                                        where: { workspaceId_name: { workspaceId: m.workspaceId, name } },
                                        update: {},
                                        create: { workspaceId: m.workspaceId, name },
                                    }),
                                ),
                            );
                            await tx.taskTag.createMany({
                                data: tags.map((t) => ({ taskId: task.id, tagId: t.id })),
                                skipDuplicates: true,
                            });
                        }

                        await tx.taskActivity.create({
                            data: {
                                workspaceId: m.workspaceId,
                                taskId: task.id,
                                actorId: m.userId,
                                type: 'IMPORTED' as ActivityType,
                                summary: `imported from ${payload.fileName} (row ${row.rowNumber})`,
                                metadata: { importJobId: job.id, rowNumber: row.rowNumber },
                            },
                        });

                        if (!row.assigneeUserId) unassigned += 1;
                        created += 1;
                    });
                } catch (err) {
                    this.logger.error(`Import row ${row.rowNumber} failed`, err as Error);
                    errors.push({
                        rowNumber: row.rowNumber,
                        message: err instanceof Error ? err.message : 'Unknown database error',
                        rawRow: raw as unknown as object,
                    });
                }
            }
        }

        if (errors.length) {
            await this.prisma.importRowError.createMany({
                data: errors.map((e) => ({
                    importJobId: job.id,
                    rowNumber: e.rowNumber,
                    field: e.field ?? null,
                    message: e.message,
                    rawRow: e.rawRow as object,
                })),
            });
        }

        const finished = await this.prisma.importJob.update({
            where: { id: job.id },
            data: {
                status: errors.length && !created ? 'FAILED' : 'COMPLETED',
                createdCount: created,
                skippedCount: skipped,
                errorCount: errors.length,
                unassigned,
                completedAt: new Date(),
            },
        });

        if (created > 0) {
            await this.notifications.notifyLeaders(m.workspaceId, {
                type: 'ANNOUNCEMENT',
                title: 'Import complete',
                body: `${created} task${created === 1 ? '' : 's'} imported from ${payload.fileName}`,
                dedupeKey: `import:${job.id}`,
            });
        }

        return {
            jobId: finished.id,
            created,
            skipped,
            errors: errors.length,
            unassigned,
            errorReport: errors.map(({ rowNumber, field, message }) => ({ rowNumber, field, message })),
        };
    }

    // ---------------------------------------------------------------- distribution assistant

    /**
     * Deterministic workload balancer. It only ever *suggests* changes; the
     * leader must approve each one before anything is written.
     */
    async suggestDistribution(m: Membership) {
        const [members, tasks] = await Promise.all([
            this.prisma.workspaceMember.findMany({
                where: { workspaceId: m.workspaceId, isActive: true },
                include: {
                    user: { select: { id: true, name: true, email: true } },
                },
            }),
            this.prisma.task.findMany({
                where: { workspaceId: m.workspaceId, isArchived: false, status: { not: 'DONE' } },
                include: { assignees: { select: { userId: true } } },
            }),
        ]);

        const load = new Map<string, { hours: number; count: number }>();
        for (const member of members) load.set(member.userId, { hours: 0, count: 0 });

        const unassigned: typeof tasks = [];
        for (const task of tasks) {
            if (!task.assignees.length) {
                unassigned.push(task);
                continue;
            }
            const share = (task.estimatedHrs ?? 4) / task.assignees.length;
            for (const a of task.assignees) {
                const entry = load.get(a.userId);
                if (entry) {
                    entry.hours += share;
                    entry.count += 1;
                }
            }
        }

        const suggestions: {
            taskId: string;
            taskTitle: string;
            fromUserId: string | null;
            toUserId: string;
            toUserName: string;
            reason: string;
        }[] = [];

        const ranked = [...load.entries()].sort((a, b) => a[1].hours - b[1].hours);

        for (const task of unassigned) {
            const [targetId, targetLoad] = ranked[0];
            const target = members.find((mm) => mm.userId === targetId)!;
            suggestions.push({
                taskId: task.id,
                taskTitle: task.title,
                fromUserId: null,
                toUserId: targetId,
                toUserName: target.user.name,
                reason: `Unassigned task; ${target.user.name} currently has the lowest estimated load (${targetLoad.hours.toFixed(1)}h)`,
            });
            targetLoad.hours += task.estimatedHrs ?? 4;
            targetLoad.count += 1;
            ranked.sort((a, b) => a[1].hours - b[1].hours);
        }

        const average = [...load.values()].reduce((s, v) => s + v.hours, 0) / Math.max(load.size, 1);
        const overloaded = [...load.entries()].filter(([, v]) => v.hours > average * 1.4);

        for (const [userId, entry] of overloaded) {
            const movable = tasks
                .filter((t) => t.assignees.length === 1 && t.assignees[0].userId === userId)
                .sort((a, b) => (a.priority === 'URGENT' ? 1 : 0) - (b.priority === 'URGENT' ? 1 : 0));

            for (const task of movable.slice(0, 2)) {
                const [targetId] = ranked[0];
                if (targetId === userId) continue;
                const target = members.find((mm) => mm.userId === targetId)!;
                suggestions.push({
                    taskId: task.id,
                    taskTitle: task.title,
                    fromUserId: userId,
                    toUserId: targetId,
                    toUserName: target.user.name,
                    reason: `Rebalance: current owner holds ${entry.hours.toFixed(1)}h vs team average ${average.toFixed(1)}h`,
                });
                entry.hours -= task.estimatedHrs ?? 4;
                load.get(targetId)!.hours += task.estimatedHrs ?? 4;
                ranked.sort((a, b) => a[1].hours - b[1].hours);
            }
        }

        return {
            workload: members.map((mm) => ({
                userId: mm.userId,
                name: mm.user.name,
                specialty: mm.specialty,
                estimatedHours: Number((load.get(mm.userId)?.hours ?? 0).toFixed(1)),
                activeTasks: load.get(mm.userId)?.count ?? 0,
            })),
            averageHours: Number(average.toFixed(1)),
            suggestions,
        };
    }

    async applyDistribution(m: Membership, changes: { taskId: string; toUserId: string }[]) {
        this.assertLeaderRole(m);

        await this.prisma.$transaction(async (tx) => {
            for (const change of changes) {
                const task = await tx.task.findFirst({
                    where: { id: change.taskId, workspaceId: m.workspaceId },
                });
                if (!task) continue;
                await tx.taskAssignee.deleteMany({ where: { taskId: change.taskId } });
                await tx.taskAssignee.create({ data: { taskId: change.taskId, userId: change.toUserId } });
                await tx.taskActivity.create({
                    data: {
                        workspaceId: m.workspaceId,
                        taskId: change.taskId,
                        actorId: m.userId,
                        type: 'ASSIGNED' as ActivityType,
                        summary: 'reassigned via the distribution assistant',
                        metadata: { toUserId: change.toUserId },
                    },
                });
            }
        });

        for (const change of changes) {
            await this.notifications.notifyUsers(m.workspaceId, [change.toUserId], {
                type: 'TASK_ASSIGNED',
                title: 'New task assigned',
                body: 'A task was assigned to you',
                taskId: change.taskId,
                dedupeKey: `dist:${change.taskId}:${change.toUserId}:${Date.now()}`,
            });
        }
        return { applied: changes.length };
    }

    // ---------------------------------------------------------------- history

    async listJobs(m: Membership) {
        return this.prisma.importJob.findMany({
            where: { workspaceId: m.workspaceId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { user: { select: { name: true } }, _count: { select: { errors: true } } },
        });
    }

    async jobErrors(m: Membership, jobId: string) {
        const job = await this.prisma.importJob.findFirst({
            where: { id: jobId, workspaceId: m.workspaceId },
        });
        if (!job) throw new BadRequestException('Import job not found');
        return this.prisma.importRowError.findMany({ where: { importJobId: jobId }, orderBy: { rowNumber: 'asc' } });
    }

    // ---------------------------------------------------------------- parsing helpers

    normaliseDraftRow(row: any) {
        return row;
    }

    private async currentReference(workspaceId: string) {
        const last = await this.prisma.task.findFirst({
            where: { workspaceId },
            orderBy: { reference: 'desc' },
            select: { reference: true },
        });
        return last?.reference ?? 0;
    }

    private parsePriority(value: unknown): Priority | null {
        if (value === null || value === undefined || value === '') return null;
        return PRIORITY_ALIASES[String(value).trim().toLowerCase()] ?? null;
    }

    private parseStatus(value: unknown): TaskStatus | null {
        if (value === null || value === undefined || value === '') return null;
        return STATUS_ALIASES[String(value).trim().toLowerCase()] ?? null;
    }

    private parseDate(value: unknown): Date | null {
        if (value === null || value === undefined || value === '') return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
        if (typeof value === 'number') {
            // Excel serial date
            const ms = Math.round((value - 25569) * 86_400_000);
            const d = new Date(ms);
            return Number.isNaN(d.getTime()) ? null : d;
        }
        const str = String(value).trim();
        const parsed = new Date(str);
        if (!Number.isNaN(parsed.getTime())) return parsed;
        // dd/mm/yyyy fallback
        const m = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
        if (m) {
            const [, d, mo, y] = m;
            const year = Number(y.length === 2 ? `20${y}` : y);
            const date = new Date(Date.UTC(year, Number(mo) - 1, Number(d)));
            return Number.isNaN(date.getTime()) ? null : date;
        }
        return null;
    }

    private parseNumber(value: unknown): number | null {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(String(value).replace(/[^\d.\-]/g, ''));
        return Number.isFinite(n) ? n : null;
    }

    private parseList(value: unknown): string[] {
        if (!value) return [];
        return String(value)
            .split(/[,;|]/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    private assertLeaderRole(m: Membership) {
        if (m.role !== 'LEADER') throw new BadRequestException('Team leader permission required');
    }
}