import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

    // ------------------------------------------------------------- attachments

    @Post(':id/attachments')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
    uploadAttachment(
        @CurrentMembership() m: Membership,
        @Param('id') id: string,
        @UploadedFile() file: any,
    ) {
        return this.discussions.addAttachment(m, id, file);
    }

    @Post('replies/:replyId/attachments')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
    uploadReplyAttachment(
        @CurrentMembership() m: Membership,
        @Param('replyId') replyId: string,
        @UploadedFile() file: any,
    ) {
        return this.discussions.addReplyAttachment(m, replyId, file);
    }

    @Get('attachments/:attachmentId/download')
    downloadAttachment(
        @CurrentMembership() m: Membership,
        @Param('attachmentId') attachmentId: string,
    ) {
        return this.discussions.attachmentDownload(m, attachmentId);
    }

    /** Same payload without the /download suffix. */
    @Get('attachments/:attachmentId')
    downloadAttachmentAlias(
        @CurrentMembership() m: Membership,
        @Param('attachmentId') attachmentId: string,
    ) {
        return this.discussions.attachmentDownload(m, attachmentId);
    }

    @Delete('attachments/:attachmentId')
    removeAttachment(
        @CurrentMembership() m: Membership,
        @Param('attachmentId') attachmentId: string,
    ) {
        return this.discussions.removeAttachment(m, attachmentId);
    }
}
