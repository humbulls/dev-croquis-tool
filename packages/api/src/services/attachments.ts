import { type Attachment, FIELD_LIMITS, R2_PREFIX } from '@croquis/shared';
import { unprocessable } from '../http/problem';
import { newId } from '../security/tokens';

/**
 * Attachments live in R2 under `attachments/<project_id>/<attachment_id>.<ext>`
 * so a project's objects can be removed with one prefix listing. D1 only holds
 * the metadata row; foreign keys cannot reach R2, so deletes are explicit here.
 */

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_BYTES = Math.floor((FIELD_LIMITS.screenshotDataUrl * 3) / 4);
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface AttachmentRow {
  id: string;
  project_id: string;
  comment_id: string | null;
  kind: Attachment['kind'];
  r2_key: string;
  content_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  created_at: number;
}

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    comment_id: row.comment_id,
    kind: row.kind,
    content_type: row.content_type,
    byte_size: row.byte_size,
    width: row.width,
    height: row.height,
    url: `/api/v1/attachments/${row.id}`,
    created_at: row.created_at,
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Width/height from the PNG IHDR, JPEG SOF or WebP VP8/VP8L/VP8X header. */
export function imageSize(
  bytes: Uint8Array,
  contentType: string,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (contentType === 'image/png' && bytes.length > 24) {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (contentType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1] as number;
        const length = view.getUint16(offset + 2);
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + length;
      }
      return null;
    }
    if (contentType === 'image/webp' && bytes.length > 30) {
      const chunk = String.fromCharCode(...bytes.subarray(12, 16));
      if (chunk === 'VP8X') {
        const width = 1 + (view.getUint16(24, true) | ((bytes[26] as number) << 16));
        const height = 1 + (view.getUint16(27, true) | ((bytes[29] as number) << 16));
        return { width, height };
      }
      if (chunk === 'VP8 ') {
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff,
        };
      }
      if (chunk === 'VP8L') {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface StagedObject {
  row: AttachmentRow;
  put: () => Promise<unknown>;
}

/**
 * Validate a `data:image/…;base64,…` screenshot and prepare its R2 upload and
 * metadata row. The size check happens before decoding so an oversized
 * payload is never materialised in memory.
 */
export function stageScreenshot(
  projectId: string,
  commentId: string,
  dataUrl: string,
  bucket: R2Bucket,
): StagedObject {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match)
    throw unprocessable(
      'invalid_screenshot',
      'screenshot must be a base64 PNG, JPEG or WebP data URL',
    );
  const contentType = match[1] as string;
  const base64 = match[2] as string;
  if (base64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) {
    throw unprocessable('screenshot_too_large', 'screenshot exceeds the size limit');
  }
  const bytes = base64ToBytes(base64);
  const size = imageSize(bytes, contentType);
  const id = newId();
  const key = `${R2_PREFIX.attachments}${projectId}/${id}.${EXTENSIONS[contentType]}`;
  return {
    row: {
      id,
      project_id: projectId,
      comment_id: commentId,
      kind: 'screenshot',
      r2_key: key,
      content_type: contentType,
      byte_size: bytes.byteLength,
      width: size?.width ?? null,
      height: size?.height ?? null,
      created_at: Date.now(),
    },
    put: () => bucket.put(key, bytes, { httpMetadata: { contentType } }),
  };
}

export function insertAttachment(db: D1Database, row: AttachmentRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO attachments (id, project_id, comment_id, kind, r2_key, content_type, byte_size, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.project_id,
      row.comment_id,
      row.kind,
      row.r2_key,
      row.content_type,
      row.byte_size,
      row.width,
      row.height,
      row.created_at,
    );
}

/** Store a JSON diagnostics blob (console / network log) as an attachment. */
export function stageJson(
  projectId: string,
  commentId: string,
  kind: 'console_log' | 'network_log',
  value: unknown,
  bucket: R2Bucket,
): StagedObject {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const id = newId();
  const key = `${R2_PREFIX.attachments}${projectId}/${id}.json`;
  return {
    row: {
      id,
      project_id: projectId,
      comment_id: commentId,
      kind,
      r2_key: key,
      content_type: 'application/json',
      byte_size: body.byteLength,
      width: null,
      height: null,
      created_at: Date.now(),
    },
    put: () => bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } }),
  };
}

export async function deleteObjects(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }
}

/** Remove every object of a project (after its rows are gone). */
export async function deleteProjectObjects(bucket: R2Bucket, projectId: string): Promise<void> {
  const prefix = `${R2_PREFIX.attachments}${projectId}/`;
  let cursor: string | undefined;
  do {
    const listing = await bucket.list({ prefix, cursor });
    if (listing.objects.length > 0)
      await deleteObjects(
        bucket,
        listing.objects.map((o) => o.key),
      );
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}
