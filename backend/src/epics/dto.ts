import { z } from 'zod';
import { PRIORITIES, STATUSES } from '../tasks/dto';

const dateish = z
    .union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .optional()
    .transform((v) => {
        if (v === undefined) return undefined;
        if (v === null) return null;
        return new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
    });

export const CreateEpicSchema = z.object({
    title: z.string().trim().min(2).max(200),
    description: z.string().max(10_000).nullable().optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    startDate: dateish,
    dueDate: dateish,
    // Only workspace admins may set or change these (enforced in the controller).
    // `teamId` is kept for older clients; `teamIds` is the current shape.
    teamId: z.string().cuid().nullable().optional(),
    teamIds: z.array(z.string().cuid()).max(10).optional(),
});

export const UpdateEpicSchema = CreateEpicSchema.partial();

export const EpicQuerySchema = z.object({
    teamId: z.string().optional(),
    // z.coerce.boolean() would turn "false" into true; parse the string properly.
    unassigned: z
        .preprocess((value) => {
            if (value === undefined || value === null) return undefined;
            if (typeof value === 'boolean') return value;
            const text = String(value).toLowerCase();
            if (['true', '1', 'yes'].includes(text)) return true;
            if (['false', '0', 'no', ''].includes(text)) return false;
            return value;
        }, z.boolean().optional()),
});

export type CreateEpicDto = z.infer<typeof CreateEpicSchema>;
export type UpdateEpicDto = z.infer<typeof UpdateEpicSchema>;
export type EpicQueryDto = z.infer<typeof EpicQuerySchema>;
