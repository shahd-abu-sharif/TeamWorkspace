import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { FilesModule } from './files/files.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ImportModule } from './import/import.module';
import { TasksModule } from './tasks/tasks.module';
import { PrismaModule } from './prisma/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { WorkspaceGuard } from './common/guards/workspace.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [PrismaModule, AuthModule, TasksModule, ImportModule, NotificationsModule, WorkspaceModule, AnalyticsModule, FilesModule, ChatModule],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard order matters: authentication populates req.user, workspace
    // membership populates req.membership, then role checks can run.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: WorkspaceGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
