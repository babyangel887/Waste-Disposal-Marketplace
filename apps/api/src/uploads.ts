import crypto from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Photo/doc upload URLs: real presigned PUT when all S3_* vars are set
// (Cloudflare R2 / S3-compatible, region "auto"), otherwise a clearly-marked
// mock/dev mode where the app skips the upload and uses the key directly.
// Secrets are read from the environment only and never logged.
const KINDS = ['waste_photo', 'vendor_doc'] as const;

export function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY &&
      process.env.S3_SECRET_KEY &&
      process.env.S3_PUBLIC_BASE_URL
  );
}

export interface PresignResult {
  key: string;
  uploadUrl: string | null;
  publicUrl: string | null;
  mock: boolean;
  expiresIn: number;
  contentType?: string;
}

export async function presignUpload(kind: string, contentType?: string): Promise<PresignResult> {
  if (!KINDS.includes(kind as any)) throw new Error('invalid kind');
  const key = `${kind}/${Date.now()}-${crypto.randomUUID()}`;
  const expiresIn = 600;

  if (!isS3Configured()) {
    // Mock/dev storage for testing only — no bytes are stored anywhere.
    // The booking endpoint accepts the key as-is; not for production.
    console.log(`[uploads] mock presign kind=${kind} key=${key}`);
    return { key, uploadUrl: null, publicUrl: null, mock: true, expiresIn, contentType };
  }

  const bucket = process.env.S3_BUCKET as string;
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.S3_ENDPOINT as string,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY as string,
      secretAccessKey: process.env.S3_SECRET_KEY as string,
    },
  });
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType || 'image/jpeg' }),
    { expiresIn }
  );
  const base = (process.env.S3_PUBLIC_BASE_URL as string).replace(/\/$/, '');
  // Log only kind/key/bucket — never credentials.
  console.log(`[uploads] presign kind=${kind} key=${key} bucket=${bucket}`);
  return { key, uploadUrl, publicUrl: `${base}/${key}`, mock: false, expiresIn, contentType };
}
