/**
 * Identifiers, secrets and slugs (Web Crypto; runs on Workers).
 *
 * Every secret carries a type prefix so it is recognisable in logs and by
 * secret scanners, and so the API can route a bearer token without a lookup:
 *   crq_  API key            ing_  widget ingest key (public, write-only)
 *   inv_  invitation link    rvw_  guest reviewer identity
 *   whsec_ webhook signing secret (Standard Webhooks format)
 */

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** UUID v4 primary key. */
export function newId(): string {
  return crypto.randomUUID();
}

function randomToken(prefix: string, byteLength: number): string {
  return `${prefix}_${base64url(randomBytes(byteLength))}`;
}

export const API_KEY_PREFIX = 'crq_';

/** Secret API key (shown once; only its SHA-256 is stored). */
export function newApiKey(): string {
  return randomToken('crq', 32);
}

/** Leading characters that identify a key in lists without revealing it. */
export function displayPrefix(secret: string): string {
  return `${secret.slice(0, 12)}…`;
}

/** Public write-only ingest key embedded in the widget snippet. */
export function newIngestKey(): string {
  return randomToken('ing', 18);
}

export function newInvitationToken(): string {
  return randomToken('inv', 24);
}

export function newReviewerToken(): string {
  return randomToken('rvw', 24);
}

/** Standard Webhooks secret: `whsec_` + base64 of 32 random bytes. */
export function newWebhookSecret(): string {
  let binary = '';
  for (const byte of randomBytes(32)) binary += String.fromCharCode(byte);
  return `whsec_${btoa(binary)}`;
}

/** Short, URL-safe slug for share links (rejection-sampled, unbiased). */
export function newShareSlug(length = 12): string {
  const alphabetLength = SLUG_ALPHABET.length;
  const limit = Math.floor(256 / alphabetLength) * alphabetLength;
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit) {
        out += SLUG_ALPHABET[byte % alphabetLength];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

/** Human-readable slug derived from a name (random when nothing ASCII is left, e.g. Japanese names). */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || newShareSlug(8);
}
