// apps/api/src/common/guards/roles.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }
    canActivate(ctx: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);
        if (!required?.length) return true;
        const req = ctx.switchToHttp().getRequest();
        const role: Role | undefined = req.membership?.role;
        if (!role || !required.includes(role)) {
            throw new ForbiddenException('Insufficient workspace role');
        }
        return true;
    }
}