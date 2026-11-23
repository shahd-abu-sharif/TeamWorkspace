import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentMembership } from '../common/decorators';
import type { Membership } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { DiscussionsService } from './discussions.service';
import {
    CreateDiscussionSchema,
    CreateReplySchema,
    DiscussionQuerySchema,
    UpdateDiscussionSchema,
    type CreateDiscussionDto,
    type CreateReplyDto,
    type DiscussionQueryDto,
    type UpdateDiscussionDto,
} from './dto';

@Controller('teams/:teamId/discussions')
export class TeamDiscussionsController {
    constructor(private readonly discussions: DiscussionsService) {}

    @Get()
    list(
        @CurrentMembership() m: Membership,
        @Param('teamId') teamId: string,
        @Query(new ZodQuery(DiscussionQuerySchema)) query: DiscussionQueryDto,
    ) {
        return this.discussions.listForTeam(m, teamId, query);
    }

    @Post()
    create(
        @CurrentMembership() m: Membership,
        @Param('teamId') teamId: string,
        @Body(new ZodBody(CreateDiscussionSchema)) dto: CreateDiscussionDto,
    ) {
        return this.discussions.create(m, teamId, dto);
    }
}

@Controller('discussions')
export class DiscussionsController {
    constructor(private readonly discussions: DiscussionsService) {}

    @Get(':id')
    findOne(@CurrentMembership() m: Membership, @Param('id') id: string) {
        return this.discussions.findOne(m, id);
    }

    @Post(':id/replies')
    reply(
        @CurrentMembership() m: Membership,
        @Param('id') id: string,
        @Body(new ZodBody(CreateReplySchema)) dto: CreateReplyDto,
    ) {
        return this.discussions.addReply(m, id, dto);
    }

    @Patch(':id')
    update(
        @CurrentMembership() m: Membership,
        @Param('id') id: string,
        @Body(new ZodBody(UpdateDiscussionSchema)) dto: UpdateDiscussionDto,
    ) {
        return this.discussions.update(m, id, dto);
    }

    @Delete(':id')
    remove(@CurrentMembership() m: Membership, @Param('id') id: string) {
        return this.discussions.remove(m, id);
    }

    @Delete(':id/replies/:replyId')
    removeReply(
        @CurrentMembership() m: Membership,
        @Param('id') id: string,
        @Param('replyId') replyId: string,
    ) {
        return this.discussions.removeReply(m, id, replyId);
    }
}
