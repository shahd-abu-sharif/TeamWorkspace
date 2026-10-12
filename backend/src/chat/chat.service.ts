import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Membership } from '../common/decorators';

const MessageSchema = z.object({
  body: z.string().trim().min(1).max(3000),
  recipientId: z.string().min(1).optional(),
  mentionUserIds: z.array(z.string().min(1)).max(50).default([]),
});

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(membership: Membership, recipientId?: string, markRead = false) {
    if (recipientId) {
      const recipient = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: membership.workspaceId, userId: recipientId, isActive: true },
        select: { userId: true },
      });
      if (!recipient || recipientId === membership.userId) throw new ForbiddenException('This chat is not available');
    }
    const messages = await this.prisma.chatMessage.findMany({
      where: recipientId
        ? {
            workspaceId: membership.workspaceId,
            OR: [
              { senderId: membership.userId, recipientId },
              { senderId: recipientId, recipientId: membership.userId },
            ],
          }
        : { workspaceId: membership.workspaceId, recipientId: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: membership.workspaceId, isActive: true },
      select: { userId: true, role: true, specialties: true, specialty: true },
    });
    const incomingIds = messages.filter((message) => message.senderId !== membership.userId).map((message) => message.id);
    if (incomingIds.length) {
      const now = new Date();
      await this.prisma.chatMessageReceipt.updateMany({
        where: { messageId: { in: incomingIds }, userId: membership.userId, deliveredAt: null },
        data: { deliveredAt: now },
      });
      if (markRead) {
        await this.prisma.chatMessageReceipt.updateMany({
          where: { messageId: { in: incomingIds }, userId: membership.userId, readAt: null },
          data: { readAt: now },
        });
      }
    }
    const receipts = messages.length ? await this.prisma.chatMessageReceipt.findMany({
      where: { messageId: { in: messages.map((message) => message.id) } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { readAt: 'asc' },
    }) : [];
    const receiptsByMessage = new Map<string, typeof receipts>();
    for (const receipt of receipts) receiptsByMessage.set(receipt.messageId, [...(receiptsByMessage.get(receipt.messageId) ?? []), receipt]);
    const profiles = new Map(members.map((member) => [member.userId, member]));
    return messages.reverse().map((message) => {
      const profile = profiles.get(message.senderId);
      return {
        ...message,
        receipts: receiptsByMessage.get(message.id) ?? [],
        sender: {
          ...message.sender,
          role: profile?.role ?? 'MEMBER',
          specialties: profile?.specialties.length ? profile.specialties : profile?.specialty ? [profile.specialty] : [],
        },
      };
    });
  }

  async send(membership: Membership, body: unknown) {
    const parsed = MessageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const activeMembers = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: membership.workspaceId, isActive: true },
      select: { userId: true, role: true, specialties: true, specialty: true },
    });
    const activeIds = new Set(activeMembers.map((member) => member.userId));
    if (parsed.data.recipientId && (!activeIds.has(parsed.data.recipientId) || parsed.data.recipientId === membership.userId)) {
      throw new ForbiddenException('This chat recipient is not available');
    }
    const mentionUserIds = [...new Set(parsed.data.mentionUserIds)].filter((id) => id !== membership.userId);
    if (mentionUserIds.some((id) => !activeIds.has(id))) throw new BadRequestException('A mentioned member is not in this workspace');

    const recipients = parsed.data.recipientId
      ? [parsed.data.recipientId]
      : activeMembers.map((member) => member.userId).filter((id) => id !== membership.userId);
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          workspaceId: membership.workspaceId,
          senderId: membership.userId,
          recipientId: parsed.data.recipientId ?? null,
          mentionUserIds,
          body: parsed.data.body,
        },
        include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
      });
      if (recipients.length) {
        await tx.chatMessageReceipt.createMany({ data: recipients.map((userId) => ({ messageId: created.id, userId })) });
      }
      return created;
    });

    const mentionSet = new Set(mentionUserIds);
    const generalRecipients = recipients.filter((id) => !mentionSet.has(id));
    const chatUrl = parsed.data.recipientId ? `/chat?with=${encodeURIComponent(membership.userId)}` : '/chat';
    await Promise.all([
      this.notifications.notifyUsers(membership.workspaceId, generalRecipients, {
        type: 'CHAT_MESSAGE',
        title: parsed.data.recipientId ? `Private message from ${message.sender.name}` : `New team message from ${message.sender.name}`,
        body: parsed.data.body.slice(0, 180),
        url: chatUrl,
        dedupeKey: `chat:${message.id}`,
      }),
      ...mentionUserIds.filter((id) => recipients.includes(id)).map((userId) =>
        this.notifications.notifyUsers(membership.workspaceId, [userId], {
          type: 'CHAT_MESSAGE',
          title: `${message.sender.name} mentioned you`,
          body: parsed.data.body.slice(0, 180),
          url: chatUrl,
          dedupeKey: `chat-mention:${message.id}`,
        }),
      ),
    ]);

    const authorProfile = activeMembers.find((member) => member.userId === membership.userId);
    return {
      ...message,
      sender: {
        ...message.sender,
        role: membership.role,
        specialties: authorProfile?.specialties.length ? authorProfile.specialties : authorProfile?.specialty ? [authorProfile.specialty] : [],
      },
    };
  }
}
