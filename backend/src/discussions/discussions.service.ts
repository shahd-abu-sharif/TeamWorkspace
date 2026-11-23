import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    PayloadTooLargeException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FilesService } from '../files/files.service';
import type { Membership } from '../common/decorators';
import type {
    CreateDiscussionDto,
    CreateReplyDto,
    DiscussionQueryDto,
    UpdateDiscussionDto,
} from './dto';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const authorSelect = { select: { id: true, name: true, avatarUrl: true } };

const attachmentSelect = {
    id: true,
    fileName: true,
    mimeType: true,
    sizeBytes: true,
    createdAt: true,
    uploadedById: true,
} satisfies Prisma.DiscussionAttachmentSelect;

const discussionListSelect = {
    id: true,
    title: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    lastReplyAt: true,
    author: authorSelect,
    _count: { select: { replies: true } },
} satisfies Prisma.TeamDiscussionSelect;

/**
 * A discussion board per team: posts with replies, meant for decisions and
 * write-ups. Everything is workspace-scoped; posting requires membership of the
 * team (workspace leaders may also post). Reading is open to the whole
 * workspace so other teams can follow a decision.
 */
@Injectable()
export class DiscussionsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationsService,
        private readonly files: FilesService,
    ) {}

    private async loadTeam(workspaceId: string, teamId: string) {
        const team = await this.prisma.team.findFirst({
            where: { id: teamId, workspaceId },
            select: { id: true, name: true },
        });
        if (!team) throw new NotFoundException('Team not found');
        return team;
    }

    private async assertCanWrite(m: Membership, teamId: string) {
        if (m.role === 'LEADER') return;
        const member = await this.prisma.teamMember.findUnique({
            where: { teamId_userId: { teamId, userId: m.userId } },
            select: { id: true },
        });
        if (!member) throw new ForbiddenException('Only members of this team can post here');
    }

    private async teamMemberIds(teamId: string) {
        const members = await this.prisma.teamMember.findMany({
            where: { teamId },
            select: { userId: true },
        });
        return members.map((member) => member.userId);
    }

    private async loadDiscussion(m: Membership, id: string) {
        const discussion = await this.prisma.teamDiscussion.findFirst({
            where: { id, workspaceId: m.workspaceId },
            select: { id: true, teamId: true, authorId: true, title: true },
        });
        if (!discussion) throw new NotFoundException('Discussion not found');
        return discussion;
    }

    private async notifyParticipants(
        workspaceId: string,
        userIds: string[],
        payload: { title: string; body: string; url: string; dedupeKey: string },
        actorId: string,
    ) {
        await this.notifications
            .notifyUsers(workspaceId, userIds, {
                type: 'ANNOUNCEMENT',
                title: payload.title,
                body: payload.body,
                url: payload.url,
                dedupeKey: payload.dedupeKey,
                excludeUserId: actorId,
            })
            .catch(() => undefined);
    }

    // ---------------------------------------------------------------- reading

    async listForTeam(m: Membership, teamId: string, query: DiscussionQueryDto) {
        const team = await this.loadTeam(m.workspaceId, teamId);
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 20;
        const where: Prisma.TeamDiscussionWhereInput = {
            workspaceId: m.workspaceId,
            teamId,
            ...(query.status ? { status: query.status } : {}),
        };

        const [items, total, open] = await Promise.all([
            this.prisma.teamDiscussion.findMany({
                where,
                orderBy: [{ lastReplyAt: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: discussionListSelect,
            }),
            this.prisma.teamDiscussion.count({ where }),
            this.prisma.teamDiscussion.count({
                where: { workspaceId: m.workspaceId, teamId, status: 'OPEN' },
            }),
        ]);

        return {
            team,
            items: items.map(({ _count, ...item }) => ({ ...item, replyCount: _count.replies })),
            total,
            open,
            page,
            pageSize,
        };
    }

    async findOne(m: Membership, id: string) {
        const discussion = await this.prisma.teamDiscussion.findFirst({
            where: { id, workspaceId: m.workspaceId },
            select: {
                id: true,
                teamId: true,
                title: true,
                body: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                lastReplyAt: true,
                author: authorSelect,
                team: { select: { id: true, name: true } },
                attachments: {
                    where: { replyId: null },
                    orderBy: { createdAt: 'asc' },
                    select: attachmentSelect,
                },
                replies: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                        id: true,
                        body: true,
                        createdAt: true,
                        author: authorSelect,
                        attachments: { orderBy: { createdAt: 'asc' }, select: attachmentSelect },
                    },
                },
            },
        });
        if (!discussion) throw new NotFoundException('Discussion not found');
        return discussion;
    }

    // ---------------------------------------------------------------- writing

    async create(m: Membership, teamId: string, dto: CreateDiscussionDto) {
        const team = await this.loadTeam(m.workspaceId, teamId);
        await this.assertCanWrite(m, teamId);

        const discussion = await this.prisma.teamDiscussion.create({
            data: {
                workspaceId: m.workspaceId,
                teamId,
                authorId: m.userId,
                title: dto.title,
                body: dto.body,
            },
            select: discussionListSelect,
        });

        await this.notifyParticipants(
            m.workspaceId,
            await this.teamMemberIds(teamId),
            {
                title: `New discussion in ${team.name}`,
                body: dto.title,
                url: `/teams/${teamId}/discussions/${discussion.id}`,
                dedupeKey: `discussion:${discussion.id}`,
            },
            m.userId,
        );

        const { _count, ...rest } = discussion;
        return { ...rest, replyCount: _count.replies };
    }

    async addReply(m: Membership, id: string, dto: CreateReplyDto) {
        const discussion = await this.loadDiscussion(m, id);
        await this.assertCanWrite(m, discussion.teamId);

        const [reply, participants, team, repliers] = await Promise.all([
            this.prisma.teamDiscussionReply.create({
                data: { discussionId: id, authorId: m.userId, body: dto.body },
                select: {
                    id: true,
                    body: true,
                    createdAt: true,
                    author: authorSelect,
                },
            }),
            this.teamMemberIds(discussion.teamId),
            this.prisma.team.findUnique({
                where: { id: discussion.teamId },
                select: { name: true },
            }),
            this.prisma.teamDiscussionReply.findMany({
                where: { discussionId: id },
                select: { authorId: true },
            }),
        ]);

        await this.prisma.teamDiscussion.update({
            where: { id },
            data: { lastReplyAt: new Date() },
        });

        const recipients = new Set<string>(participants);
        recipients.add(discussion.authorId);
        for (const replier of repliers) recipients.add(replier.authorId);

        await this.notifyParticipants(
            m.workspaceId,
            [...recipients],
            {
                title: `New reply in ${team?.name ?? 'a team discussion'}`,
                body: `${discussion.title} — ${dto.body.slice(0, 120)}`,
                url: `/teams/${discussion.teamId}/discussions/${id}`,
                dedupeKey: `discussion-reply:${reply.id}`,
            },
            m.userId,
        );

        return reply;
    }

    async update(m: Membership, id: string, dto: UpdateDiscussionDto) {
        const discussion = await this.loadDiscussion(m, id);
        const isAuthor = discussion.authorId === m.userId;
        if (!isAuthor && m.role !== 'LEADER') {
            await this.assertCanWrite(m, discussion.teamId);
            throw new ForbiddenException('Only the author or a leader can edit this discussion');
        }

        return this.prisma.teamDiscussion.update({
            where: { id },
            data: {
                title: dto.title,
                body: dto.body,
                status: dto.status,
            },
            select: discussionListSelect,
        });
    }

    async remove(m: Membership, id: string) {
        const discussion = await this.loadDiscussion(m, id);
        if (discussion.authorId !== m.userId && m.role !== 'LEADER') {
            throw new ForbiddenException('Only the author or a leader can delete this discussion');
        }
        await this.prisma.teamDiscussion.delete({ where: { id } });
        return { ok: true };
    }

    async removeReply(m: Membership, id: string, replyId: string) {
        const discussion = await this.loadDiscussion(m, id);
        const reply = await this.prisma.teamDiscussionReply.findFirst({
            where: { id: replyId, discussionId: id },
            select: { id: true, authorId: true },
        });
        if (!reply) throw new NotFoundException('Reply not found');
        if (reply.authorId !== m.userId && m.role !== 'LEADER') {
            throw new ForbiddenException('Only the author or a leader can delete this reply');
        }
        await this.prisma.teamDiscussionReply.delete({ where: { id: replyId } });
        await this.prisma.teamDiscussion.update({
            where: { id: discussion.id },
            data: { lastReplyAt: new Date() },
        });
        return { ok: true };
    }

    // -------------------------------------------------------------- attachments

    private assertFile(file: { originalname: string; size: number } | undefined) {
        if (!file) throw new BadRequestException('Choose a file to upload');
        if (file.size > MAX_ATTACHMENT_BYTES) {
            throw new PayloadTooLargeException('Files can be up to 25 MB');
        }
    }

    private async attachmentForRead(m: Membership, attachmentId: string) {
        const attachment = await this.prisma.discussionAttachment.findFirst({
            where: { id: attachmentId, discussion: { workspaceId: m.workspaceId } },
            select: {
                ...attachmentSelect,
                storageKey: true,
                discussionId: true,
                replyId: true,
                discussion: { select: { id: true, teamId: true, title: true, authorId: true } },
            },
        });
        if (!attachment) throw new NotFoundException('Attachment not found');
        return attachment;
    }

    async addAttachment(
        m: Membership,
        id: string,
        file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    ) {
        const discussion = await this.loadDiscussion(m, id);
        await this.assertCanWrite(m, discussion.teamId);
        this.assertFile(file);

        const stored = await this.files.saveUpload(file.originalname, file.mimetype, file.buffer);
        const attachment = await this.prisma.discussionAttachment.create({
            data: {
                discussionId: id,
                uploadedById: m.userId,
                fileName: file.originalname,
                mimeType: file.mimetype || 'application/octet-stream',
                sizeBytes: file.size,
                storageKey: stored.key,
            },
            select: attachmentSelect,
        });

        const team = await this.prisma.team.findUnique({
            where: { id: discussion.teamId },
            select: { name: true },
        });
        await this.notifyParticipants(
            m.workspaceId,
            await this.teamMemberIds(discussion.teamId),
            {
                title: `File added in ${team?.name ?? 'a team discussion'}`,
                body: `${file.originalname} — ${discussion.title}`,
                url: `/teams/${discussion.teamId}/discussions/${id}`,
                dedupeKey: `discussion-file:${attachment.id}`,
            },
            m.userId,
        );

        return attachment;
    }

    async addReplyAttachment(
        m: Membership,
        replyId: string,
        file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    ) {
        const reply = await this.prisma.teamDiscussionReply.findFirst({
            where: { id: replyId, discussion: { workspaceId: m.workspaceId } },
            select: { id: true, discussionId: true, discussion: { select: { teamId: true } } },
        });
        if (!reply) throw new NotFoundException('Reply not found');
        await this.assertCanWrite(m, reply.discussion.teamId);
        this.assertFile(file);

        const stored = await this.files.saveUpload(file.originalname, file.mimetype, file.buffer);
        return this.prisma.discussionAttachment.create({
            data: {
                discussionId: reply.discussionId,
                replyId: reply.id,
                uploadedById: m.userId,
                fileName: file.originalname,
                mimeType: file.mimetype || 'application/octet-stream',
                sizeBytes: file.size,
                storageKey: stored.key,
            },
            select: attachmentSelect,
        });
    }

    /** Mirrors task attachments: signed URL on S3, base64 bytes on local disk. */
    async attachmentDownload(m: Membership, attachmentId: string) {
        const attachment = await this.attachmentForRead(m, attachmentId);
        if (process.env.S3_BUCKET) return this.files.createDownloadUrl(attachment.storageKey);
        const content = await this.files.readUpload(attachment.storageKey);
        const { discussion: _discussion, ...rest } = attachment;
        return { ...rest, content: content.toString('base64') };
    }

    async removeAttachment(m: Membership, attachmentId: string) {
        const attachment = await this.attachmentForRead(m, attachmentId);
        const mayRemove =
            attachment.uploadedById === m.userId ||
            attachment.discussion.authorId === m.userId ||
            m.role === 'LEADER';
        if (!mayRemove) {
            throw new ForbiddenException(
                'Only the uploader, the post author or a leader can remove this file',
            );
        }
        await this.prisma.discussionAttachment.delete({ where: { id: attachmentId } });
        return { ok: true };
    }
}
