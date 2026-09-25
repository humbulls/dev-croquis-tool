import type { Env } from '../env';
import { timingSafeEqual } from './crypto';
import { base64url } from './tokens';

/**
 * Share sessions are stateless signed tokens: `base64url(payload).base64url(HMAC)`
 * with a key derived from AUTH_SECRET. The link itself (revoked, expired,
 * settings) is re-read on every request, so revoking a link ends its sessions
 * immediately even though the token is still validly signed.
 */

export const SHARE_SESSION_TTL_MS = 30 * 24 * 3_600_000;

export interface ShareClaims {
  /** share_links.id */
  link: string;
  /** guest_reviewers.id */
  reviewer: string;
  /** Expiry, epoch ms. */
  exp: number;
}

const keys = new WeakMap<Env, Promise<CryptoKey>>();

function hmacKey(env: Env): Promise<CryptoKey> {
  let key = keys.get(env);
  if (!key) {
    key = (async () => {
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
          salt: new TextEncoder().encode('croquis/share-session'),
          info: new TextEncoder().encode('v1'),
        },
        material,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign'],
      );
    })();
    keys.set(env, key);
  }
  return key;
}

async function sign(env: Env, payload: string): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env),
    new TextEncoder().encode(payload),
  );
  return base64url(new Uint8Array(mac));
}

export async function issueShareToken(env: Env, claims: ShareClaims): Promise<string> {
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ l: claims.link, r: claims.reviewer, e: claims.exp })),
  );
  return `${payload}.${await sign(env, payload)}`;
}

export async function verifyShareToken(
  env: Env,
  token: string | null | undefined,
): Promise<ShareClaims | null> {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!timingSafeEqual(await sign(env, payload), signature)) return null;
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))),
    ) as {
      l?: unknown;
      r?: unknown;
      e?: unknown;
    };
    if (
      typeof decoded.l !== 'string' ||
      typeof decoded.r !== 'string' ||
      typeof decoded.e !== 'number'
    )
      return null;
    if (decoded.e <= Date.now()) return null;
    return { link: decoded.l, reviewer: decoded.r, exp: decoded.e };
  } catch {
    return null;
  }
}
