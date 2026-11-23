// apps/api/src/notifications/notifications.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CurrentMembership, CurrentUser, SkipWorkspace } from '../common/decorators';
import type { Membership } from '../common/decorators';
import { NotificationsService } from './notifications.service';

/**
 * The inbox is per tenant: list/count/read endpoints always resolve the
 * workspace from the `x-workspace-id` membership guard, so one user's
 * notifications from workspace A never appear while they are in workspace B.
 * Push subscriptions and preferences are per user, not per tenant.
 */
@Controller('notifications')
export class NotificationsController {
    constructor(private notifications: NotificationsService) {}

    @Get('vapid-public-key')
    @SkipWorkspace()
    vapidKey() {
        return { publicKey: this.notifications.publicKey };
    }

    @Get()
    list(
        @CurrentMembership() m: Membership,
        @Query('unread') unread: string,
        @Query('page') page = '1',
        @Query('pageSize') pageSize = '30',
    ) {
        return this.notifications.list(m.workspaceId, m.userId, {
            unreadOnly: unread === 'true',
            page: Math.max(1, Number(page)),
            pageSize: Math.min(100, Number(pageSize)),
        });
    }

    @Get('unread-count')
    count(@CurrentMembership() m: Membership) {
        return this.notifications.unreadCount(m.workspaceId, m.userId);
    }

    @Post('read-all')
    markAll(@CurrentMembership() m: Membership) {
        return this.notifications.markAllRead(m.workspaceId, m.userId);
    }

    @Post(':id/read')
    markRead(@CurrentMembership() m: Membership, @Param('id') id: string) {
        return this.notifications.markRead(m.workspaceId, m.userId, id);
    }

    @Get('preferences')
    @SkipWorkspace()
    preferences(@CurrentUser() user: { id: string }) {
        return this.notifications.getPreferences(user.id);
    }

    @Patch('preferences')
    @SkipWorkspace()
    updatePreferences(@CurrentUser() user: { id: string }, @Body() body: Record<string, boolean>) {
        return this.notifications.updatePreferences(user.id, body);
    }

    @Post('subscriptions')
    @SkipWorkspace()
    subscribe(
        @CurrentUser() user: { id: string },
        @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } },
        @Req() req: any,
    ) {
        return this.notifications.registerSubscription(user.id, body, req.headers['user-agent']);
    }

    @Delete('subscriptions')
    @SkipWorkspace()
    unsubscribe(@CurrentUser() user: { id: string }, @Body('endpoint') endpoint: string) {
        return this.notifications.removeSubscription(user.id, endpoint);
    }
}
