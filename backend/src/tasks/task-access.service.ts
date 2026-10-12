// apps/api/src/tasks/task-access.service.ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Membership } from '../common/decorators';

const taskReadInclude = {
    assignees: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
    collaborators: { include: { user: { select: { id: true, name: true } } } },
    tags: { include: { tag: true } },
    workstream: true,
    dependencies: { include: { dependsOn: { select: { id: true, reference: true, title: true, status: true } } } },
    dependents: { include: { task: { select: { id: true, reference: true, title: true } } } },
    attachments: true,
} satisfies Prisma.TaskInclude;

type ReadableTask = Prisma.TaskGetPayload<{ include: typeof taskReadInclude }>;

@Injectable()
export class TaskAccessService {
    constructor(private prisma: PrismaService) { }

    /**
     * Central authorisation gate. Every task read/write goes through here so a
     * member can never reach another member's private task by guessing an ID.
     */
    async loadForRead(taskId: string, m: Membership): Promise<ReadableTask> {
        const task = await this.prisma.task.findFirst({
            where: { id: taskId, workspaceId: m.workspaceId },
            include: taskReadInclude,
        });
        if (!task) throw new NotFoundException('Task not found');

        if (m.role === 'LEADER') return task;

        const isInvolved =
            task.assignees.some((a) => a.userId === m.userId) ||
            task.collaborators.some((c) => c.userId === m.userId);
        if (!isInvolved) throw new ForbiddenException('You do not have access to this task');

        return task;
    }

    /** Members may edit a limited field set on tasks they are involved in. */
    async assertCanWrite(taskId: string, m: Membership): Promise<ReadableTask> {
        const task = await this.loadForRead(taskId, m);
        if (m.role !== 'LEADER' && task.isArchived) {
            throw new ForbiddenException('Archived tasks can only be edited by the team leader');
        }
        return task;
    }

    assertLeader(m: Membership) {
        if (m.role !== 'LEADER') throw new ForbiddenException('Team leader permission required');
    }
}
