import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LastSeenInterceptor implements NestInterceptor {
    constructor(private readonly prisma: PrismaService) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const req = context.switchToHttp().getRequest();
        const userId = req.user?.id;

        if (userId) {
            // fire-and-forget
            this.prisma.user
                .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
                .catch(() => undefined);
        }

        return next.handle();
    }
}