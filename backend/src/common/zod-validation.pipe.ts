// apps/api/src/common/zod-validation.pipe.ts
import { BadRequestException, PipeTransform } from '@nestjs/common';
import { type ZodTypeAny, type z } from 'zod';

// Generic over the schema (not its output type) so schemas with
// `.transform()` — whose input type differs from their output — are accepted.
export class ZodBody<S extends ZodTypeAny> implements PipeTransform {
    constructor(private schema: S) { }

    transform(value: unknown): z.output<S> {
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

/** Same validation as ZodBody, for `@Query()` objects: bad input -> 400, not 500. */
export class ZodQuery<S extends ZodTypeAny> implements PipeTransform {
    constructor(private schema: S) { }

    transform(value: unknown): z.output<S> {
        const result = this.schema.safeParse(value);
        if (!result.success) {
            throw new BadRequestException({
                message: 'Invalid query parameters',
                issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            });
        }
        return result.data;
    }
}
