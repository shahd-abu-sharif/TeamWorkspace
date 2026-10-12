// apps/api/src/common/decorators.ts
import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const SKIP_WORKSPACE_KEY = 'skipWorkspace';
export const SkipWorkspace = () => SetMetadata(SKIP_WORKSPACE_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface Membership {
    userId: string;
    workspaceId: string;
    role: Role;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().user;
});

export const CurrentMembership = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().membership as Membership;
});