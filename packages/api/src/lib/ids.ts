/** ID, token and slug generation (Web Crypto based; runs on Workers). */

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

/** UUID v4 primary key. */
export function newId(): string {
  return crypto.randomUUID();
}

function randomToken(prefix: string, byteLength: number): string {
  return `${prefix}_${base64url(randomBytes(byteLength))}`;
}

/** Secret project API token (shown once). */
export function newApiToken(): string {
  return randomToken('crq', 24);
}

/** Public write-only ingest key embedded in the widget. */
export function newIngestKey(): string {
  return randomToken('ing', 18);
}

/** Short, URL-safe slug for public share links (rejection-sampled, unbiased). */
export function newShareSlug(length = 12): string {
  const alphabetLength = TOKEN_ALPHABET.length;
  const limit = Math.floor(256 / alphabetLength) * alphabetLength;
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit) {
        out += TOKEN_ALPHABET[byte % alphabetLength];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

/** Human-readable slug derived from a name (fallback to a random slug). */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || newShareSlug(8);
}
