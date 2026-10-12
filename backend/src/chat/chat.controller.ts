import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentMembership } from '../common/decorators';
import type { Membership } from '../common/decorators';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('messages')
  list(@CurrentMembership() membership: Membership, @Query('with') recipientId?: string, @Query('read') read?: string) {
    return this.chat.list(membership, recipientId, read === 'true');
  }

  @Post('messages')
  send(@CurrentMembership() membership: Membership, @Body() body: unknown) {
    return this.chat.send(membership, body);
  }
}
