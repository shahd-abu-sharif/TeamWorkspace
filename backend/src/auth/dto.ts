// apps/api/src/auth/dto.ts
import { z } from 'zod';

export const RegisterSchema = z.object({
    token: z.string().min(10),
    name: z.string().min(2).max(80),
    password: z
        .string()
        .min(10, 'Password must be at least 10 characters')
        .regex(/[A-Za-z]/, 'Must include a letter')
        .regex(/[0-9]/, 'Must include a number'),
});

export const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});

export const ProfileSchema = z.object({
    name: z.string().trim().min(2).max(80),
});

export const InviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(['LEADER', 'MEMBER']).default('MEMBER'),
    specialty: z.string().max(80).optional(),
    specialties: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

export const ForgotSchema = z.object({ email: z.string().email() });

export const ResetSchema = z.object({
    token: z.string().min(10),
    password: z.string().min(10),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
export type LoginDto = z.infer<typeof LoginSchema>;
export type InviteDto = z.infer<typeof InviteSchema>;
export type ForgotDto = z.infer<typeof ForgotSchema>;
export type ResetDto = z.infer<typeof ResetSchema>;
