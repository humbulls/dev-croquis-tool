/** Hashing and constant-time comparison using Web Crypto (Workers-safe). */

/** Cloudflare Workers caps PBKDF2 at 100k iterations. */
const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

/** Constant-time string comparison (use on same-length digests only). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Compare two variable-length secrets without leaking length information:
 * both sides are hashed to fixed-length digests first.
 */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  return timingSafeEqual(await sha256Hex(a), await sha256Hex(b));
}

/** Compare a high-entropy token against a stored SHA-256 hex hash. */
export async function verifyTokenHash(token: string, hash: string): Promise<boolean> {
  return timingSafeEqual(await sha256Hex(token), hash);
}

async function pbkdf2Bits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Hash a human-chosen password (share link passwords): salted PBKDF2-SHA256.
 * Format: `pbkdf2$<iterations>$<salt-hex>$<hash-hex>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2Bits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

/** Verify a password against a `pbkdf2$…` record. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000) return false;
  const salt = fromHex(parts[2] as string);
  const derived = await pbkdf2Bits(password, salt, iterations);
  return timingSafeEqual(toHex(derived), parts[3] as string);
}
