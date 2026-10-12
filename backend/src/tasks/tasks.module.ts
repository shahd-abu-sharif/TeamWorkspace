import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TaskAccessService } from './task-access.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [NotificationsModule, FilesModule],
  controllers: [TasksController],
  providers: [TasksService, TaskAccessService],
  exports: [TasksService, TaskAccessService],
})
export class TasksModule {}
