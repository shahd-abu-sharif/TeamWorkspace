import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentMembership, Roles } from '../common/decorators';
import type { Membership } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { EpicsService } from './epics.service';
import {
    CreateEpicSchema,
    EpicQuerySchema,
    UpdateEpicSchema,
    type CreateEpicDto,
    type EpicQueryDto,
    type UpdateEpicDto,
} from './dto';

@Controller('epics')
export class EpicsController {
    constructor(private readonly epics: EpicsService) { }

    @Get()
    list(
        @CurrentMembership() m: Membership,
        @Query(new ZodQuery(EpicQuerySchema)) query: EpicQueryDto,
    ) {
        return this.epics.list(m, query);
    }

    @Get(':id')
    findOne(@CurrentMembership() m: Membership, @Param('id') id: string) {
        return this.epics.findOne(m, id);
    }

    @Post()
    @Roles('LEADER')
    create(@CurrentMembership() m: Membership, @Body(new ZodBody(CreateEpicSchema)) dto: CreateEpicDto) {
        return this.epics.create(m, dto);
    }

    /** `teamId` changes are admin-only; the response carries an assignee warning. */
    @Patch(':id')
    @Roles('LEADER')
    update(
        @CurrentMembership() m: Membership,
        @Param('id') id: string,
        @Body(new ZodBody(UpdateEpicSchema)) dto: UpdateEpicDto,
    ) {
        return this.epics.update(m, id, dto);
    }

    @Delete(':id')
    @Roles('LEADER')
    remove(@CurrentMembership() m: Membership, @Param('id') id: string) {
        return this.epics.remove(m, id);
    }
}
