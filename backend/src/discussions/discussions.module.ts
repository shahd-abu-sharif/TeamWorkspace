import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DiscussionsController, TeamDiscussionsController } from './discussions.controller';
import { DiscussionsService } from './discussions.service';

@Module({
    imports: [NotificationsModule],
    controllers: [TeamDiscussionsController, DiscussionsController],
    providers: [DiscussionsService],
    exports: [DiscussionsService],
})
export class DiscussionsModule {}
