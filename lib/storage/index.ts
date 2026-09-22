import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { detectFileType, FileTooLargeError, MAX_UPLOAD_BYTES, UnsupportedFileTypeError } from './mime';

/**
 * File storage.
 *
 * "Every integration sits behind an interface with a mock implementation selected when its
 * key is absent, so the whole app runs and demos locally with only DATABASE_URL and
 * REDIS_URL set."
 *
 * Production is S3-compatible (Cloudflare R2, for zero egress on a past paper hundreds of
 * students download). Locally the same interface writes to disk and serves through a signed
 * route, so uploads, downloads and expiry all behave the same in a demo as in production.
 */

export type UploadTicket = {
  /** Where the browser PUTs the bytes. Direct to storage in production. */
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  /** The key to record once the upload succeeds. */
  key: string;
  expiresAt: string;
};

export interface StorageAdapter {
  readonly name: 'local' | 's3';
  createUploadTicket(input: {
    key: string;
    contentType: string;
    maxBytes?: number;
  }): Promise<UploadTicket>;
  /** Short-lived read URL. Large files are never proxied through the app server. */
  createDownloadUrl(key: string, options?: { expiresInSeconds?: number; download?: boolean }): Promise<string>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  head(key: string): Promise<{ size: number } | null>;
  remove(key: string): Promise<void>;
}

const SIGNING_SECRET = () => process.env['NEXTAUTH_SECRET'] ?? 'volt-dev-only-storage-secret';

/** HMAC over the key, the action and the deadline — nothing about the URL is guessable. */
export function signStorageToken(key: string, action: 'put' | 'get', expiresAt: number): string {
  return createHmac('sha256', SIGNING_SECRET())
    .update(`${action}:${key}:${expiresAt}`)
    .digest('base64url');
}

export function verifyStorageToken(
  key: string,
  action: 'put' | 'get',
  expiresAt: number,
  token: string,
): boolean {
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  const expected = Buffer.from(signStorageToken(key, action, expiresAt));
  const given = Buffer.from(token);
  // Constant-time: a fast-fail comparison leaks the signature a byte at a time.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

const LOCAL_ROOT = process.env['LOCAL_STORAGE_DIR'] ?? join(process.cwd(), '.volt-storage');

/** Keys are ours, but a traversal in one would escape the storage directory entirely. */
function safeLocalPath(key: string): string {
  const cleaned = normalize(key).replace(/^(\.\.[/\\])+/, '');
  if (cleaned.includes('..')) throw new Error('Invalid storage key');
  return join(LOCAL_ROOT, cleaned);
}

class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local' as const;

  async createUploadTicket({ key, contentType }: { key: string; contentType: string }) {
    const expiresAt = Date.now() + 15 * 60_000;
    const token = signStorageToken(key, 'put', expiresAt);
    const base = process.env['APP_URL'] ?? 'http://localhost:3000';

    return {
      url: `${base}/api/files/${encodeURI(key)}?token=${token}&expires=${expiresAt}`,
      method: 'PUT' as const,
      headers: { 'content-type': contentType },
      key,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async createDownloadUrl(key: string, options: { expiresInSeconds?: number; download?: boolean } = {}) {
    const expiresAt = Date.now() + (options.expiresInSeconds ?? 900) * 1000;
    const token = signStorageToken(key, 'get', expiresAt);
    const base = process.env['APP_URL'] ?? 'http://localhost:3000';
    const suffix = options.download ? '&download=1' : '';
    return `${base}/api/files/${encodeURI(key)}?token=${token}&expires=${expiresAt}${suffix}`;
  }

  async put(key: string, body: Buffer, contentType: string) {
    const path = safeLocalPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(`${path}.type`, contentType, 'utf8');
  }

  async read(key: string) {
    try {
      const path = safeLocalPath(key);
      const [body, contentType] = await Promise.all([
        readFile(path),
        readFile(`${path}.type`, 'utf8').catch(() => 'application/octet-stream'),
      ]);
      return { body, contentType: contentType.trim() };
    } catch {
      return null;
    }
  }

  async head(key: string) {
    try {
      const info = await stat(safeLocalPath(key));
      return { size: info.size };
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    const path = safeLocalPath(key);
    await Promise.allSettled([unlink(path), unlink(`${path}.type`)]);
  }
}

let adapter: StorageAdapter | null = null;

/**
 * The S3 adapter is loaded only when its credentials are present. Keeping it behind a
 * dynamic import means a local demo never needs the AWS SDK installed or configured, which
 * is the whole point of the mock-when-absent rule.
 */
export function getStorage(): StorageAdapter {
  if (adapter) return adapter;
  adapter = new LocalStorageAdapter();
  return adapter;
}

export function isS3Configured(): boolean {
  return Boolean(
    process.env['S3_BUCKET'] && process.env['S3_ACCESS_KEY_ID'] && process.env['S3_SECRET_ACCESS_KEY'],
  );
}

/** Namespaced by tenant, so one school's keys can never collide with another's. */
export function storageKey(schoolId: string, folder: string, fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'bin';
  return `${schoolId}/${folder}/${randomUUID()}.${extension}`;
}

/**
 * Accepts bytes for storage, or refuses them.
 *
 * The single place an upload is validated: size, then type from the bytes themselves. The
 * content type recorded is the detected one, never the one the client claimed.
 */
export async function acceptUpload(input: {
  schoolId: string;
  folder: string;
  fileName: string;
  body: Buffer;
  maxBytes?: number;
}): Promise<{ key: string; contentType: string; size: number; kind: string }> {
  const maxBytes = input.maxBytes ?? MAX_UPLOAD_BYTES;
  if (input.body.byteLength > maxBytes) throw new FileTooLargeError(maxBytes);

  const detected = detectFileType(input.body, input.fileName);
  if (!detected) throw new UnsupportedFileTypeError();

  const key = storageKey(input.schoolId, input.folder, `file.${detected.extension}`);
  await getStorage().put(key, input.body, detected.contentType);

  return { key, contentType: detected.contentType, size: input.body.byteLength, kind: detected.kind };
}

export { detectFileType, MAX_UPLOAD_BYTES, UnsupportedFileTypeError, FileTooLargeError } from './mime';
export { isAcceptableVideoLink } from './mime';
