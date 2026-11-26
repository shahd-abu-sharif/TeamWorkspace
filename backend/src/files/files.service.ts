// apps/api/src/files/files.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';

type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
};

const MISSING_FILE_MESSAGE =
  'This file is no longer available. It was uploaded to the server\'s temporary disk before ' +
  'durable storage was switched on, and that disk is wiped on every deploy — ask the uploader ' +
  'to attach it again. New uploads are now stored durably.';

/**
 * Storage abstraction, in order of preference:
 *
 * 1. S3-compatible object storage when `S3_BUCKET` is set (AWS S3, Cloudflare R2,
 *    Supabase Storage — the last two need `S3_ENDPOINT`).
 * 2. Postgres (`FileBlob`) so uploads survive container restarts and deploys.
 * 3. The container's local disk — only for legacy rows written before 2 existed.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(private readonly prisma: PrismaService) {
    const config = this.s3Config();
    if (config) {
      this.logger.log(
        `File storage: bucket "${config.bucket}"${config.endpoint ? ` at ${config.endpoint}` : ''}`,
      );
    } else {
      this.logger.log(
        'File storage: Postgres (FileBlob). Files survive deploys; configure S3_BUCKET for object storage.',
      );
    }
  }

  private s3Config(): S3Config | null {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) return null;

    const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;

    return {
      bucket,
      region: process.env.S3_REGION ?? 'auto',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials:
        accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    };
  }

  private async s3() {
    const config = this.s3Config();
    if (!config) return null;
    const { S3Client } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
      ...(config.credentials ? { credentials: config.credentials } : {}),
    });
    return { client, config };
  }

  isUsingObjectStorage() {
    return Boolean(process.env.S3_BUCKET);
  }

  async createUploadUrl(fileName: string, mimeType: string) {
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;

    const s3 = await this.s3();
    if (s3) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const command = new PutObjectCommand({
        Bucket: s3.config.bucket,
        Key: key,
        ContentType: mimeType,
      });
      const url = await getSignedUrl(s3.client, command, { expiresIn: 600 });
      return { uploadUrl: url, key, expiresIn: 600 };
    }

    return {
      uploadUrl: `${process.env.API_PUBLIC_URL ?? ''}/api/files/local/${key}`,
      key,
      expiresIn: 600,
      note: 'Uploads go through the API and are stored in Postgres.',
    };
  }

  async saveUpload(fileName: string, mimeType: string, buffer: Buffer) {
    const safeName = basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extname(safeName)}`;

    const s3 = await this.s3();
    if (s3) {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.config.bucket,
          Key: key,
          ContentType: mimeType,
          Body: buffer,
        }),
      );
      return { key };
    }

    await this.prisma.fileBlob.create({
      data: {
        key,
        mimeType: mimeType || 'application/octet-stream',
        sizeBytes: buffer.length,
        data: new Uint8Array(buffer),
      },
    });
    return { key };
  }

  async readUpload(key: string) {
    if (this.isUsingObjectStorage()) {
      throw new Error('S3 objects should be returned as signed download links');
    }

    const blob = await this.prisma.fileBlob.findUnique({
      where: { key },
      select: { data: true },
    });
    if (blob) return Buffer.from(blob.data);

    // Legacy rows: written to the container disk before Postgres storage existed.
    const root = process.env.FILE_UPLOAD_DIR ?? process.cwd();
    const normalized = key.replaceAll('\\', '/');
    if (!normalized.startsWith('uploads/') || normalized.includes('..')) {
      throw new Error('Invalid storage key');
    }
    try {
      return await readFile(join(root, normalized));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.warn(`Missing upload (no blob, no disk file): ${normalized}`);
        throw new NotFoundException(MISSING_FILE_MESSAGE);
      }
      throw error;
    }
  }

  /** Remove the stored bytes (blob or legacy disk file) for a deleted attachment. */
  async deleteUpload(key: string) {
    await this.prisma.fileBlob.deleteMany({ where: { key } });
    if (this.isUsingObjectStorage()) return;

    const root = process.env.FILE_UPLOAD_DIR ?? process.cwd();
    const normalized = key.replaceAll('\\', '/');
    if (!normalized.startsWith('uploads/') || normalized.includes('..')) return;
    try {
      const { rm } = await import('node:fs/promises');
      await rm(join(root, normalized), { force: true });
    } catch {
      // Best effort: a missing legacy file is already gone.
    }
  }

  async createDownloadUrl(key: string) {
    const s3 = await this.s3();
    if (s3) {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      return {
        url: await getSignedUrl(
          s3.client,
          new GetObjectCommand({ Bucket: s3.config.bucket, Key: key }),
          { expiresIn: 3600 },
        ),
        expiresIn: 3600,
      };
    }
    return { url: `${process.env.API_PUBLIC_URL ?? ''}/api/files/local/${key}`, expiresIn: 3600 };
  }
}
