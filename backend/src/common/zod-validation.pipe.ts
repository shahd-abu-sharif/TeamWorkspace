// apps/api/src/common/zod-validation.pipe.ts
import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodBody<T> implements PipeTransform {
    constructor(private schema: ZodSchema<T>) { }
    transform(value: unknown): T {
        const result = this.schema.safeParse(value);
        if (!result.success) {
            throw new BadRequestException({
                message: 'Validation failed',
                issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            });
        }
        return result.data;
    }
}