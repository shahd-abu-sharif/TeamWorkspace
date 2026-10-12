// apps/api/src/notifications/notifications.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CurrentUser, SkipWorkspace } from '../common/decorators';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@SkipWorkspace()
export class NotificationsController {
  constructor(private notifications: NotificationsService) { }

  @Get('vapid-public-key')
  vapidKey() {
    return { publicKey: this.notifications.publicKey };
  }

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query('unread') unread: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '30',
  ) {
    return this.notifications.list(user.id, {
      unreadOnly: unread === 'true',
      page: Math.max(1, Number(page)),
      pageSize: Math.min(100, Number(pageSize)),
    });
  }

  @Get('unread-count')
  count(@CurrentUser() user: { id: string }) {
    return this.notifications.unreadCount(user.id);
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  markAll(@CurrentUser() user: { id: string }) {
    return this.notifications.markAllRead(user.id);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: { id: string }) {
    return this.notifications.getPreferences(user.id);
  }

  @Patch('preferences')
  updatePreferences(@CurrentUser() user: { id: string }, @Body() body: Record<string, boolean>) {
    return this.notifications.updatePreferences(user.id, body);
  }

  @Post('subscriptions')
  subscribe(
    @CurrentUser() user: { id: string },
    @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } },
    @Req() req: any,
  ) {
    return this.notifications.registerSubscription(user.id, body, req.headers['user-agent']);
  }

  @Delete('subscriptions')
  unsubscribe(@CurrentUser() user: { id: string }, @Body('endpoint') endpoint: string) {
    return this.notifications.removeSubscription(user.id, endpoint);
  }
}