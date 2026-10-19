import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Membership } from '../common/decorators';

const taskReadInclude = {
    assignees: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
    collaborators: { include: { user: { select: { id: true, name: true } } } },
    tags: { include: { tag: true } },
    workstream: true,
    dependencies: {
        include: {
            dependsOn: { select: { id: true, reference: true, title: true, status: true } },
        },
    },
    dependents: { include: { task: { select: { id: true, reference: true, title: true } } } },
    attachments: true,
    subtasks: {
        orderBy: { position: 'asc' as const },
        include: { doneBy: { select: { id: true, name: true } } },
    },
} satisfies Prisma.TaskInclude;

type ReadableTask = Prisma.TaskGetPayload<{ include: typeof taskReadInclude }>;

@Injectable()
export class TaskAccessService {
    constructor(private prisma: PrismaService) { }

    /**
     * Central gate. Non-leader must be an ASSIGNEE. Everyone else gets 404
     * (not 403) so existence of private tasks isn't leaked.
     */
    async loadForRead(taskId: string, m: Membership): Promise<ReadableTask> {
        const task = await this.prisma.task.findFirst({
            where: { id: taskId, workspaceId: m.workspaceId },
            include: taskReadInclude,
        });
        if (!task) throw new NotFoundException('Task not found');

        if (m.role === 'LEADER') return task;

        const isAssignee = task.assignees.some((a) => a.userId === m.userId);
        if (!isAssignee) throw new NotFoundException('Task not found');

        return task;
    }

    /**
     * Same visibility gate as `loadForRead`, plus the legacy rule that
     * non-leaders cannot write to an archived task. Used by `memberUpdate`
     * and `toggleSubtask`.
     */
    async assertCanWrite(taskId: string, m: Membership): Promise<ReadableTask> {
        const task = await this.loadForRead(taskId, m);
        if (m.role !== 'LEADER' && task.isArchived) {
            throw new ForbiddenException('Archived tasks can only be edited by the team leader');
        }
        return task;
    }

    /**
     * Convenience alias kept for code paths that only need the visibility
     * gate (e.g. timer endpoints).
     */
    async loadForAssignee(taskId: string, m: Membership): Promise<ReadableTask> {
        return this.loadForRead(taskId, m);
    }

    assertLeader(m: Membership) {
        if (m.role !== 'LEADER') throw new ForbiddenException('Team leader permission required');
    }
}





// // apps/api/src/tasks/task-access.service.ts
// import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
// import type { Prisma } from '@prisma/client';
// import { PrismaService } from '../prisma/prisma.service';
// import { Membership } from '../common/decorators';

// const taskReadInclude = {
//     assignees: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
//     collaborators: { include: { user: { select: { id: true, name: true } } } },
//     tags: { include: { tag: true } },
//     workstream: true,
//     dependencies: { include: { dependsOn: { select: { id: true, reference: true, title: true, status: true } } } },
//     dependents: { include: { task: { select: { id: true, reference: true, title: true } } } },
//     attachments: true,
// } satisfies Prisma.TaskInclude;

// type ReadableTask = Prisma.TaskGetPayload<{ include: typeof taskReadInclude }>;

// @Injectable()
// export class TaskAccessService {
//     constructor(private prisma: PrismaService) { }

//     /**
//      * Central authorisation gate. Every task read/write goes through here so a
//      * member can never reach another member's private task by guessing an ID.
//      */
//     async loadForRead(taskId: string, m: Membership): Promise<ReadableTask> {
//         const task = await this.prisma.task.findFirst({
//             where: { id: taskId, workspaceId: m.workspaceId },
//             include: taskReadInclude,
//         });
//         if (!task) throw new NotFoundException('Task not found');

//         if (m.role === 'LEADER') return task;

//         const isInvolved =
//             task.assignees.some((a) => a.userId === m.userId) ||
//             task.collaborators.some((c) => c.userId === m.userId);
//         if (!isInvolved) throw new ForbiddenException('You do not have access to this task');

//         return task;
//     }

//     /** Members may edit a limited field set on tasks they are involved in. */
//     async assertCanWrite(taskId: string, m: Membership): Promise<ReadableTask> {
//         const task = await this.loadForRead(taskId, m);
//         if (m.role !== 'LEADER' && task.isArchived) {
//             throw new ForbiddenException('Archived tasks can only be edited by the team leader');
//         }
//         return task;
//     }

//     assertLeader(m: Membership) {
//         if (m.role !== 'LEADER') throw new ForbiddenException('Team leader permission required');
//     }
// }
