import 'dotenv/config';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for Prisma PostgreSQL adapter');
    }

    const adapter = new PrismaPg({ connectionString });

    super({
      adapter,
      log: ['error', 'warn'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    if (process.env.NODE_ENV === 'development') {
      console.log('[Prisma] Connected to database');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async runBatch<T>(
    items: T[],
    handler: (item: T) => Promise<unknown>,
    chunk = 50,
  ) {
    for (let i = 0; i < items.length; i += chunk) {
      const slice = items.slice(i, i + chunk);
      await this.$transaction(async (tx) => {
        for (const item of slice) {
          await handler(item);
        }
      });
    }
  }
}
