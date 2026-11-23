import { z } from 'zod';

export const DiscussionStatusSchema = z.enum(['OPEN', 'RESOLVED']);

export const CreateDiscussionSchema = z.object({
    title: z.string().trim().min(3).max(140),
    body: z.string().trim().min(1).max(10_000),
});

export const UpdateDiscussionSchema = z.object({
    title: z.string().trim().min(3).max(140).optional(),
    body: z.string().trim().min(1).max(10_000).optional(),
    status: DiscussionStatusSchema.optional(),
});

export const CreateReplySchema = z.object({
    body: z.string().trim().min(1).max(10_000),
});

export const DiscussionQuerySchema = z.object({
    status: DiscussionStatusSchema.optional(),
    page: z.coerce.number().int().min(1).max(1000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export type CreateDiscussionDto = z.infer<typeof CreateDiscussionSchema>;
export type UpdateDiscussionDto = z.infer<typeof UpdateDiscussionSchema>;
export type CreateReplyDto = z.infer<typeof CreateReplySchema>;
export type DiscussionQueryDto = z.infer<typeof DiscussionQuerySchema>;
