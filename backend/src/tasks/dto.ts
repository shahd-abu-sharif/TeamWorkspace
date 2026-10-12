// apps/api/src/tasks/dto.ts
import { z } from 'zod';

export const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const STATUSES = [
    'BACKLOG',
    'TODO',
    'IN_PROGRESS',
    'IN_REVIEW',
    'BLOCKED',
    'DONE',
] as const;

const dateish = z
    .union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .optional()
    .transform((v) => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        return new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
    });

const taskFieldsSchema = z.object({
        title: z.string().min(2).max(200),
        description: z.string().max(10_000).optional(),
        workstreamId: z.string().cuid().nullable().optional(),
        assigneeIds: z.array(z.string().cuid()).max(10).default([]),
        collaboratorIds: z.array(z.string().cuid()).max(20).default([]),
        priority: z.enum(PRIORITIES).default('MEDIUM'),
        status: z.enum(STATUSES).default('BACKLOG'),
        startDate: dateish,
        dueDate: dateish,
        estimatedHrs: z.number().min(0).max(9999).nullable().optional(),
        dependencyIds: z.array(z.string().cuid()).default([]),
        tagNames: z.array(z.string().min(1).max(40)).default([]),
        progress: z.number().int().min(0).max(100).default(0),
    });

export const CreateTaskSchema = taskFieldsSchema.refine(
        (v) => !(v.startDate && v.dueDate) || v.startDate <= v.dueDate,
        { message: 'Start date must be before the deadline', path: ['dueDate'] },
    );

export const UpdateTaskSchema = taskFieldsSchema.partial();

export const LeaderUpdateSchema = UpdateTaskSchema.extend({
    isArchived: z.boolean().optional(),
});

/** Fields a MEMBER is permitted to change on their own task. */
export const MemberUpdateSchema = z.object({
    status: z.enum(STATUSES).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    actualHrs: z.number().min(0).max(9999).optional(),
    description: z.string().max(10_000).optional(),
});

export const TaskQuerySchema = z.object({
    q: z.string().trim().max(120).optional(),
    status: z.union([z.enum(STATUSES), z.array(z.enum(STATUSES))]).optional(),
    priority: z.union([z.enum(PRIORITIES), z.array(z.enum(PRIORITIES))]).optional(),
    assigneeId: z.string().optional(),
    workstreamId: z.string().optional(),
    tag: z.string().optional(),
    dueFrom: z.string().optional(),
    dueTo: z.string().optional(),
    overdue: z.coerce.boolean().optional(),
    unassigned: z.coerce.boolean().optional(),
    awaitingReview: z.coerce.boolean().optional(),
    mine: z.coerce.boolean().optional(),
    includeArchived: z.coerce.boolean().default(false),
    sort: z.enum(['dueDate', 'priority', 'createdAt', 'updatedAt', 'title']).default('dueDate'),
    order: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const BulkUpdateSchema = z.object({
    taskIds: z.array(z.string().cuid()).min(1).max(500),
    patch: z.object({
        status: z.enum(STATUSES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        dueDate: dateish,
        addAssigneeIds: z.array(z.string().cuid()).optional(),
        removeAssigneeIds: z.array(z.string().cuid()).optional(),
        workstreamId: z.string().cuid().nullable().optional(),
    }),
});

export const CommentSchema = z.object({
    body: z.string().min(1).max(5000),
});

export type CreateTaskDto = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>;
export type TaskQueryDto = z.infer<typeof TaskQuerySchema>;
