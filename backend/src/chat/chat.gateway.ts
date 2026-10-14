import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
    cors: {
        origin: [
            'http://localhost:5173',
            'https://tadreeby-team-workspace.vercel.app',
            'https://shahd-abu-sharif.github.io',
        ],
        credentials: true,
    },
    namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;

    private readonly logger = new Logger(ChatGateway.name);
    private userSockets = new Map<string, Set<string>>();

    constructor(
        private readonly jwt: JwtService,
        private readonly prisma: PrismaService,
    ) { }

    // ============================================================
    // CONNECT
    // ============================================================
    async handleConnection(client: Socket) {
        try {
            const token =
                client.handshake.auth?.token ||
                client.handshake.headers.authorization?.replace('Bearer ', '');

            if (!token) {
                client.disconnect();
                return;
            }

            const payload = await this.jwt.verifyAsync(token, {
                secret: process.env.JWT_ACCESS_SECRET,
                issuer: 'tadreeby-team-hub',
            });

            const userId = payload.sub;
            client.data.userId = userId;

            // 1. Track socket
            if (!this.userSockets.has(userId)) {
                this.userSockets.set(userId, new Set());
            }
            this.userSockets.get(userId)!.add(client.id);

            // 2. Join personal room
            client.join(`user:${userId}`);

            // 3. تحديث lastSeenAt في قاعدة البيانات
            const now = new Date();
            try {
                await this.prisma.user.update({
                    where: { id: userId },
                    data: { lastSeenAt: now },
                });
            } catch (err) {
                this.logger.warn(`Failed to update lastSeenAt for ${userId}`);
            }

            // 4. بث event "متصل الآن" للجميع
            this.server.emit('presence:online', { userId });

            this.logger.log(`[CONNECT] User ${userId} connected (socket ${client.id})`);
        } catch (err: any) {
            this.logger.warn(`Rejected connection: ${err.message}`);
            client.disconnect();
        }
    }

    // ============================================================
    // DISCONNECT
    // ============================================================
    // async handleDisconnect(client: Socket) {
    //     const userId = client.data.userId;
    //     if (!userId) return;

    //     this.userSockets.get(userId)?.delete(client.id);

    //     // فقط لما يكون آخر socket لهذا المستخدم
    //     if (this.userSockets.get(userId)?.size === 0) {
    //         this.userSockets.delete(userId);

    //         const now = new Date();

    //         // 1. تحديث lastSeenAt في قاعدة البيانات
    //         try {
    //             await this.prisma.user.update({
    //                 where: { id: userId },
    //                 data: { lastSeenAt: now },
    //             });
    //         } catch (err) {
    //             this.logger.warn(`Failed to update lastSeenAt for ${userId}`);
    //         }

    //         // 2. بث event "غير متصل" للجميع
    //         this.server.emit('presence:offline', {
    //             userId,
    //             lastSeenAt: now.toISOString(),
    //         });

    //         // 3. بث إيقاف الكتابة (لو كان يكتب)
    //         this.server.emit('user:stopTyping', { userId });

    //         this.logger.log(`[DISCONNECT] User ${userId} is now offline`);
    //     }
    // }

    async handleDisconnect(client: Socket) {
        const userId = client.data.userId;
        if (!userId) return;

        this.userSockets.get(userId)?.delete(client.id);

        if (this.userSockets.get(userId)?.size === 0) {
            await this.markUserOffline(userId);
        }
    }

    // ============================================================
    // FAST DISCONNECT — يتلقاها قبل إغلاق التاب
    // ============================================================
    @SubscribeMessage('presence:leaving')
    async onLeaving(@ConnectedSocket() client: Socket) {
        const userId = client.data.userId;
        if (!userId) return;

        // استدعاء نفس منطق disconnect مباشرة — بدون انتظار
        await this.markUserOffline(userId);
    }


    // ============================================================
    // TYPING
    // ============================================================
    @SubscribeMessage('typing:start')
    onTypingStart(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { recipientId?: string },
    ) {
        const userId = client.data.userId;
        if (!userId) return;
        const target = data.recipientId ? `user:${data.recipientId}` : 'team-room';
        client.to(target).emit('user:typing', {
            userId,
            recipientId: data.recipientId ?? null,
        });
    }

    @SubscribeMessage('typing:stop')
    onTypingStop(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { recipientId?: string },
    ) {
        const userId = client.data.userId;
        if (!userId) return;
        const target = data.recipientId ? `user:${data.recipientId}` : 'team-room';
        client.to(target).emit('user:stopTyping', {
            userId,
            recipientId: data.recipientId ?? null,
        });
    }

    // ============================================================
    // ROOMS
    // ============================================================
    @SubscribeMessage('room:join')
    onJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { room: string }) {
        client.join(data.room);
    }

    @SubscribeMessage('room:leave')
    onLeave(@ConnectedSocket() client: Socket, @MessageBody() data: { room: string }) {
        client.leave(data.room);
    }

    // ============================================================
    // BROADCAST MESSAGE — تُستدعى من ChatService
    // ============================================================
    broadcastMessage(message: any) {
        this.logger.log(
            `[BROADCAST] message ${message.id} from ${message.senderId} ` +
            `to ${message.recipientId ?? 'team-room'}`,
        );
        if (message.recipientId) {
            this.server.to(`user:${message.recipientId}`).emit('message:new', message);
            this.server.to(`user:${message.senderId}`).emit('message:new', message);
        } else {
            this.server.to('team-room').emit('message:new', message);
        }
    }

    
    private async markUserOffline(userId: string) {
        // تأكد ما زال هناك sockets أخرى
        const sockets = this.userSockets.get(userId);
        if (sockets && sockets.size > 0) return;

        this.userSockets.delete(userId);
        const now = new Date();

        try {
            await this.prisma.user.update({
                where: { id: userId },
                data: { lastSeenAt: now },
            });
        } catch (err) {
            this.logger.warn(`Failed to update lastSeenAt for ${userId}`);
        }

        this.server.emit('presence:offline', {
            userId,
            lastSeenAt: now.toISOString(),
        });
        this.server.emit('user:stopTyping', { userId });

        this.logger.log(`[LEAVING] User ${userId} marked offline`);
    }
}