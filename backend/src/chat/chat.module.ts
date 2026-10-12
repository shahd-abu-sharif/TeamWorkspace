import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
