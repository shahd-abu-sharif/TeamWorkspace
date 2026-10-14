import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Membership } from '../common/decorators';
import { ChatGateway } from './chat.gateway';

const MessageSchema = z.object({
  body: z.string().trim().min(1).max(3000),
  recipientId: z.string().min(1).optional(),
  mentionUserIds: z.array(z.string().min(1)).max(50).default([]),
  taskMentionIds: z.array(z.string().min(1)).max(10).default([]),
  replyToId: z.string().min(1).optional(),
});

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly gateway: ChatGateway,
  ) { }

  // ================================================================
  // LIST
  // ================================================================
  async list(membership: Membership, recipientId?: string, markRead = false) {
    if (recipientId) {
      const recipient = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: membership.workspaceId, userId: recipientId, isActive: true },
        select: { userId: true },
      });
      if (!recipient || recipientId === membership.userId) {
        throw new ForbiddenException('This chat is not available');
      }
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
      include: {
        sender: { select: { id: true, name: true, avatarUrl: true } },
        replyTo: {
          include: {
            sender: { select: { id: true, name: true } },
          },
        },
      },
    });

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: membership.workspaceId, isActive: true },
      select: { userId: true, role: true, specialties: true, specialty: true },
    });

    // Mark as delivered / read
    const incomingIds = messages
      .filter((message) => message.senderId !== membership.userId)
      .map((message) => message.id);

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

    // Fetch receipts
    const receipts = messages.length
      ? await this.prisma.chatMessageReceipt.findMany({
        where: { messageId: { in: messages.map((message) => message.id) } },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { readAt: 'asc' },
      })
      : [];

    const receiptsByMessage = new Map<string, typeof receipts>();
    for (const receipt of receipts) {
      receiptsByMessage.set(receipt.messageId, [
        ...(receiptsByMessage.get(receipt.messageId) ?? []),
        receipt,
      ]);
    }

    const profiles = new Map(members.map((member) => [member.userId, member]));

    return messages.reverse().map((message) => {
      const profile = profiles.get(message.senderId);
      return {
        ...message,
        receipts: receiptsByMessage.get(message.id) ?? [],
        sender: {
          ...message.sender,
          role: profile?.role ?? 'MEMBER',
          specialties: profile?.specialties.length
            ? profile.specialties
            : profile?.specialty
              ? [profile.specialty]
              : [],
        },
      };
    });
  }

  // ================================================================
  // SEND
  // ================================================================
  async send(membership: Membership, body: unknown) {
    const parsed = MessageSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const activeMembers = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: membership.workspaceId, isActive: true },
      select: { userId: true, role: true, specialties: true, specialty: true },
    });
    const activeIds = new Set(activeMembers.map((member) => member.userId));

    if (
      parsed.data.recipientId &&
      (!activeIds.has(parsed.data.recipientId) || parsed.data.recipientId === membership.userId)
    ) {
      throw new ForbiddenException('This chat recipient is not available');
    }

    const mentionUserIds = [...new Set(parsed.data.mentionUserIds)].filter(
      (id) => id !== membership.userId,
    );
    if (mentionUserIds.some((id) => !activeIds.has(id))) {
      throw new BadRequestException('A mentioned member is not in this workspace');
    }

    // ⬇️ جديد: التحقق من صحة taskMentionIds
    const taskMentionIds = [...new Set(parsed.data.taskMentionIds ?? [])];
    if (taskMentionIds.length) {
      const count = await this.prisma.task.count({
        where: { id: { in: taskMentionIds }, workspaceId: membership.workspaceId },
      });
      if (count !== taskMentionIds.length) {
        throw new BadRequestException('One or more mentioned tasks are invalid');
      }
    }

    // ⬇️ جديد: التحقق من صحة replyToId
    if (parsed.data.replyToId) {
      const replyTo = await this.prisma.chatMessage.findFirst({
        where: { id: parsed.data.replyToId, workspaceId: membership.workspaceId },
        select: { id: true },
      });
      if (!replyTo) {
        throw new BadRequestException('Cannot reply to this message');
      }
    }

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
          taskMentionIds,                             // ⬅️ جديد
          replyToId: parsed.data.replyToId ?? null,   // ⬅️ جديد
          body: parsed.data.body,
        },
        include: {
          sender: { select: { id: true, name: true, avatarUrl: true } },
          replyTo: {                                   // ⬅️ جديد
            include: {
              sender: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (recipients.length) {
        await tx.chatMessageReceipt.createMany({
          data: recipients.map((userId) => ({ messageId: created.id, userId })),
        });
      }
      return created;
    });

    // ⬇️ جديد: بث فوري عبر Socket.IO
    try {
      this.gateway.broadcastMessage(message);
    } catch (err) {
      // فشل البث لا يجب أن يفشل الطلب
    }

    // Notifications
    const mentionSet = new Set(mentionUserIds);
    const generalRecipients = recipients.filter((id) => !mentionSet.has(id));
    const chatUrl = parsed.data.recipientId
      ? `/chat?with=${encodeURIComponent(membership.userId)}`
      : '/chat';

    await Promise.all([
      this.notifications.notifyUsers(membership.workspaceId, generalRecipients, {
        type: 'CHAT_MESSAGE',
        title: parsed.data.recipientId
          ? `Private message from ${message.sender.name}`
          : `New team message from ${message.sender.name}`,
        body: parsed.data.body.slice(0, 180),
        url: chatUrl,
        dedupeKey: `chat:${message.id}`,
      }),
      ...mentionUserIds
        .filter((id) => recipients.includes(id))
        .map((userId) =>
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
        specialties: authorProfile?.specialties.length
          ? authorProfile.specialties
          : authorProfile?.specialty
            ? [authorProfile.specialty]
            : [],
      },
    };
  }

  // ================================================================
  // LIST CONVERSATIONS — المستخدمين اللي عندي محادثات معهم
  // ================================================================
  async listConversations(membership: Membership) {
    // 1. كل الرسائل الخاصة اللي أنا طرف فيها
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        workspaceId: membership.workspaceId,
        recipientId: { not: null },
        OR: [
          { senderId: membership.userId },
          { recipientId: membership.userId },
        ],
      },
      select: {
        id: true,
        senderId: true,
        recipientId: true,
        body: true,
        createdAt: true,
        sender: { select: { id: true, name: true, avatarUrl: true } },
        recipient: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 2. عدد غير المقروء لكل مرسل
    const unreadMessages = await this.prisma.chatMessageReceipt.findMany({
      where: {
        userId: membership.userId,
        readAt: null,
        message: {
          workspaceId: membership.workspaceId,
          recipientId: membership.userId,
        },
      },
      include: { message: { select: { senderId: true } } },
    });

    const unreadByUser = new Map<string, number>();
    for (const receipt of unreadMessages) {
      const senderId = receipt.message.senderId;
      unreadByUser.set(senderId, (unreadByUser.get(senderId) ?? 0) + 1);
    }

    // 3. جيبي lastSeenAt و isOnline لكل مستخدم
    const otherUserIds = new Set<string>();
    for (const msg of messages) {
      const otherId = msg.senderId === membership.userId ? msg.recipientId : msg.senderId;
      if (otherId) otherUserIds.add(otherId);
    }

    const otherUsers = otherUserIds.size
      ? await this.prisma.user.findMany({
        where: { id: { in: [...otherUserIds] } },
        select: {
          id: true,
          lastSeenAt: true,
          // isOnline مش حقل — يُحسب من آخر نشاط
        },
      })
      : [];

    const userStatus = new Map(
      otherUsers.map((u) => [
        u.id,
        {
          lastSeenAt: u.lastSeenAt,
          // online = آخر نشاط أقل من 90 ثانية
          isOnline: u.lastSeenAt
            ? Date.now() - new Date(u.lastSeenAt).getTime() < 90_000
            : false,
        },
      ]),
    );

    // 4. جمّع حسب الطرف التاني
    const conversationsMap = new Map<
      string,
      {
        userId: string;
        name: string;
        avatarUrl: string | null;
        lastMessage: string;
        lastMessageAt: Date;
        unread: number;
        lastSeenAt: Date | null;
        isOnline: boolean;
      }
    >();

    for (const msg of messages) {
      const otherUser = msg.senderId === membership.userId ? msg.recipient : msg.sender;
      if (!otherUser) continue;

      if (!conversationsMap.has(otherUser.id)) {
        const status = userStatus.get(otherUser.id);
        conversationsMap.set(otherUser.id, {
          userId: otherUser.id,
          name: otherUser.name,
          avatarUrl: otherUser.avatarUrl,
          lastMessage: msg.body,
          lastMessageAt: msg.createdAt,
          unread: unreadByUser.get(otherUser.id) ?? 0,
          lastSeenAt: status?.lastSeenAt ?? null,
          isOnline: status?.isOnline ?? false,
        });
      }
    }

    return [...conversationsMap.values()].sort(
      (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
    );
  }
  // ================================================================
  // SEARCH TASKS (for # mentions)
  // ================================================================
  async searchTasks(membership: Membership, query: string) {
    const trimmed = (query ?? '').trim();
    if (!trimmed) return [];

    const numericRef = /^\d+$/.test(trimmed) ? Number(trimmed) : null;

    return this.prisma.task.findMany({
      where: {
        workspaceId: membership.workspaceId,
        isArchived: false,
        OR: [
          { title: { contains: trimmed, mode: 'insensitive' } },
          ...(numericRef !== null ? [{ reference: numericRef }] : []),
        ],
      },
      take: 8,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        priority: true,
      },
    });
  }
}