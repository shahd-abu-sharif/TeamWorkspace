import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';
import { DiscussionsController, TeamDiscussionsController } from './discussions.controller';
import { DiscussionsService } from './discussions.service';

@Module({
    imports: [NotificationsModule, FilesModule],
    controllers: [TeamDiscussionsController, DiscussionsController],
    providers: [DiscussionsService],
    exports: [DiscussionsService],
})
export class DiscussionsModule {}
