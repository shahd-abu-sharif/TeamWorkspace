// apps/api/src/files/files.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
};

const MISSING_FILE_MESSAGE =
  'This file is no longer available on the server. It was stored on the container\'s ' +
  'temporary disk, which is wiped on every deploy — configure S3-compatible storage ' +
  '(S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) and ask ' +
  'the uploader to attach it again.';

/**
 * Storage abstraction.
 *
 * S3-compatible object storage is used whenever `S3_BUCKET` is set — AWS S3,
 * Cloudflare R2 and Supabase Storage all work; set `S3_ENDPOINT` for the latter
 * two. Without it the local-disk driver writes to the container filesystem,
 * which is fine for development but ephemeral in production.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor() {
    const config = this.s3Config();
    if (config) {
      this.logger.log(
        `File storage: bucket "${config.bucket}"${config.endpoint ? ` at ${config.endpoint}` : ''}`,
      );
    } else if (process.env.NODE_ENV === 'production') {
      this.logger.warn(
        'File storage: container disk only. Uploaded files will disappear on the next deploy. ' +
          'Set S3_BUCKET (and S3_ENDPOINT/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY) for durable storage.',
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
      note: 'Local development mode — configure S3_BUCKET for production object storage.',
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
    } else {
      const root = process.env.FILE_UPLOAD_DIR ?? process.cwd();
      const target = join(root, key);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, buffer);
    }
    return { key };
  }

  async readUpload(key: string) {
    if (this.isUsingObjectStorage()) {
      throw new Error('S3 objects should be returned as signed download links');
    }
    const root = process.env.FILE_UPLOAD_DIR ?? process.cwd();
    const normalized = key.replaceAll('\\', '/');
    if (!normalized.startsWith('uploads/') || normalized.includes('..')) {
      throw new Error('Invalid storage key');
    }
    try {
      return await readFile(join(root, normalized));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // The usual cause is a deploy: the container disk was replaced, so the
        // row exists but the bytes are gone. Return a clear 404, not a 500.
        this.logger.warn(`Missing upload on disk: ${normalized}`);
        throw new NotFoundException(MISSING_FILE_MESSAGE);
      }
      throw error;
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
