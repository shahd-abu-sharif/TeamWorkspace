// apps/api/src/files/files.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * Storage abstraction. The default implementation is a local-disk driver for
 * development. Swap in S3/R2 by implementing the same interface — task records
 * only ever store the returned key, never the bytes.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  async createUploadUrl(fileName: string, mimeType: string) {
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;

    if (process.env.S3_BUCKET) {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const client = new S3Client({ region: process.env.S3_REGION });
      const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        ContentType: mimeType,
      });
      const url = await getSignedUrl(client, command, { expiresIn: 600 });
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
    if (process.env.S3_BUCKET) {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({ region: process.env.S3_REGION });
      await client.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: mimeType, Body: buffer }));
    } else {
      const root = process.env.FILE_UPLOAD_DIR ?? process.cwd();
      const target = join(root, key);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, buffer);
    }
    return { key };
  }

  async readUpload(key: string) {
    if (process.env.S3_BUCKET) throw new Error('S3 objects should be returned as signed download links');
    const root = process.env.FILE_UPLOAD_DIR ?? process.cwd();
    const normalized = key.replaceAll('\\', '/');
    if (!normalized.startsWith('uploads/') || normalized.includes('..')) throw new Error('Invalid storage key');
    return readFile(join(root, normalized));
  }

  async createDownloadUrl(key: string) {
    if (process.env.S3_BUCKET) {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const client = new S3Client({ region: process.env.S3_REGION });
      return {
        url: await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
          { expiresIn: 3600 },
        ),
        expiresIn: 3600,
      };
    }
    return { url: `${process.env.API_PUBLIC_URL ?? ''}/api/files/local/${key}`, expiresIn: 3600 };
  }
}

