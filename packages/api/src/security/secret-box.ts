import type { Env } from '../env';

/**
 * AES-256-GCM for third-party credentials at rest (integration tokens, Slack
 * webhook URLs). The key is ENCRYPTION_KEY (base64, 32 bytes) or, when unset,
 * derived from AUTH_SECRET with HKDF so a default deployment is still covered.
 * Format: `v1.<base64 iv>.<base64 ciphertext+tag>`.
 */

const keyCache = new WeakMap<Env, Promise<CryptoKey>>();

function b64encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64decode(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(env: Env): Promise<CryptoKey> {
  if (env.ENCRYPTION_KEY) {
    const raw = b64decode(env.ENCRYPTION_KEY);
    if (raw.byteLength !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
  }
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.AUTH_SECRET),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('croquis/integration-secrets'),
      info: new TextEncoder().encode('v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function key(env: Env): Promise<CryptoKey> {
  let cached = keyCache.get(env);
  if (!cached) {
    cached = deriveKey(env);
    keyCache.set(env, cached);
  }
  return cached;
}

export async function seal(env: Env, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(env),
    new TextEncoder().encode(plaintext),
  );
  return `v1.${b64encode(iv)}.${b64encode(new Uint8Array(ciphertext))}`;
}

export async function open(env: Env, sealed: string): Promise<string> {
  const [version, iv, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !data) throw new Error('unsupported secret format');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(iv) as BufferSource },
    await key(env),
    b64decode(data) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}
