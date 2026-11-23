import { z } from 'zod';

export const TEAM_TYPES = ['UIUX', 'FRONTEND', 'BACKEND', 'MOBILE', 'OTHER'] as const;
export const TEAM_MEMBER_ROLES = ['LEAD', 'MEMBER'] as const;

export const CreateTeamSchema = z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    type: z.enum(TEAM_TYPES).default('OTHER'),
});

export const UpdateTeamSchema = z
    .object({
        name: z.string().trim().min(2).max(80).optional(),
        description: z.string().trim().max(500).nullable().optional(),
        type: z.enum(TEAM_TYPES).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const AddTeamMemberSchema = z.object({
    userId: z.string().cuid(),
    roleInTeam: z.enum(TEAM_MEMBER_ROLES).default('MEMBER'),
});

export type CreateTeamDto = z.infer<typeof CreateTeamSchema>;
export type UpdateTeamDto = z.infer<typeof UpdateTeamSchema>;
export type AddTeamMemberDto = z.infer<typeof AddTeamMemberSchema>;
