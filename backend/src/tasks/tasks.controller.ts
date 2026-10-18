import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentMembership, Roles } from '../common/decorators';
import type { Membership } from '../common/decorators';
import {
  CreateTaskSchema,
  TaskQuerySchema,
  UpdateTaskSchema,
} from './dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(@CurrentMembership() membership: Membership, @Query() query: Record<string, unknown>) {
    return this.tasksService.list(membership, TaskQuerySchema.parse(query));
  }

  @Get('board')
  board(@CurrentMembership() membership: Membership) {
    return this.tasksService.board(membership);
  }

  @Get('activity')
  activity(@CurrentMembership() membership: Membership, @Query('limit') limit = '50') {
    return this.tasksService.activity(membership, undefined, Number(limit));
  }

  @Get(':id')
  findOne(@CurrentMembership() membership: Membership, @Param('id') id: string) {
    return this.tasksService.findOne(membership, id);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  uploadAttachment(@CurrentMembership() membership: Membership, @Param('id') id: string, @UploadedFile() file: any) {
    return this.tasksService.addAttachment(membership, id, file);
  }

  @Get(':id/attachments/:attachmentId/download')
  downloadAttachment(@CurrentMembership() membership: Membership, @Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    return this.tasksService.attachmentDownload(membership, id, attachmentId);
  }

  @Post()
  @Roles('LEADER')
  create(@CurrentMembership() membership: Membership, @Body() body: unknown) {
    return this.tasksService.create(membership, CreateTaskSchema.parse(body));
  }

  @Patch('bulk')
  @Roles('LEADER')
  bulk(@CurrentMembership() membership: Membership, @Body() body: unknown) {
    return this.tasksService.bulkUpdate(membership, body);
  }

  @Patch(':id/status')
  setStatus(@CurrentMembership() membership: Membership, @Param('id') id: string, @Body('status') status: string) {
    return this.tasksService.setStatus(membership, id, status as never);
  }

  @Patch(':id/archive')
  @Roles('LEADER')
  archive(@CurrentMembership() membership: Membership, @Param('id') id: string, @Body('isArchived') archived: boolean) {
    return this.tasksService.archive(membership, id, archived);
  }

  @Patch(':id')
  @Roles('LEADER')
  update(@CurrentMembership() membership: Membership, @Param('id') id: string, @Body() body: unknown) {
    const update = UpdateTaskSchema.parse(body);
    return this.tasksService.update(membership, id, update);
  }

  @Delete(':id')
  @Roles('LEADER')
  remove(@CurrentMembership() membership: Membership, @Param('id') id: string) {
    return this.tasksService.remove(membership, id);
  }

  @Post(':id/duplicate')
  @Roles('LEADER')
  duplicate(@CurrentMembership() membership: Membership, @Param('id') id: string) {
    return this.tasksService.duplicate(membership, id);
  }

  @Post(':id/comments')
  comment(@CurrentMembership() membership: Membership, @Param('id') id: string, @Body() body: unknown) {
    return this.tasksService.addComment(membership, id, body);
  }

  @Post(':id/review')
  @Roles('LEADER')
  review(@CurrentMembership() membership: Membership, @Param('id') id: string, @Body() body: { decision: 'approve' | 'request_changes'; note?: string }) {
    return this.tasksService.review(membership, id, body.decision, body.note);
  }

  @Post(':id/timer/start')
  startTimer(@CurrentMembership() membership: Membership, @Param('id') id: string) {
    return this.tasksService.startTimer(membership, id);
  }

  @Post(':id/timer/pause')
  pauseTimer(@CurrentMembership() membership: Membership, @Param('id') id: string) {
    return this.tasksService.pauseTimer(membership, id);
  }
}
