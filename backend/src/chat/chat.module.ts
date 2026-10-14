import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { JwtModule } from '@nestjs/jwt/dist/jwt.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [NotificationsModule, JwtModule.register({})],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
