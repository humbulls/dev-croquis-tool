import { SCREENSHOT_R2_PREFIX } from '@croquis/shared';
import { newId } from './ids';

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Max decoded screenshot size accepted from the widget (~4 MB). */
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;

export interface StoredScreenshot {
  key: string;
  contentType: string;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decode a `data:image/...;base64,...` URL and store it in R2.
 * Returns null if the payload is not a supported data URL. Throws on oversize —
 * checked BEFORE decoding so oversized payloads never get materialized.
 */
export async function storeScreenshot(
  bucket: R2Bucket,
  projectId: string,
  dataUrl: string,
): Promise<StoredScreenshot | null> {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) return null;
  const contentType = match[1] as string;
  const base64 = match[2] as string;
  // base64 inflates by 4/3 — reject before decode to avoid a memory blowup.
  if (base64.length > Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 4) {
    throw new Error('screenshot too large');
  }
  const bytes = base64ToBytes(base64);
  if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new Error('screenshot too large');
  }
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const key = `${SCREENSHOT_R2_PREFIX}${projectId}/${newId()}.${ext}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
  return { key, contentType };
}

/** Fetch a screenshot object from R2. */
export function getScreenshot(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

/** Delete a single screenshot object (no-op for null keys). */
export async function deleteScreenshot(bucket: R2Bucket, key: string | null): Promise<void> {
  if (key) await bucket.delete(key);
}

/** Delete every screenshot stored for a project (used on project deletion). */
export async function deleteProjectScreenshots(bucket: R2Bucket, projectId: string): Promise<void> {
  const prefix = `${SCREENSHOT_R2_PREFIX}${projectId}/`;
  let cursor: string | undefined;
  do {
    const listing = await bucket.list({ prefix, cursor });
    if (listing.objects.length > 0) {
      await bucket.delete(listing.objects.map((object) => object.key));
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}
