import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

/** Throw helpers producing consistent JSON errors (handled in app.onError). */

export function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

export function unauthorized(message = 'Unauthorized'): never {
  throw new HTTPException(401, { message });
}

export function forbidden(message = 'Forbidden'): never {
  throw new HTTPException(403, { message });
}

export function notFound(message = 'Not found'): never {
  throw new HTTPException(404, { message });
}

/**
 * JSON body validation that reports failures through the same `{error}` envelope
 * as every other error (instead of zod's raw issue object).
 */
export function validateJson<T extends z.ZodType>(schema: T) {
  return zValidator('json', schema, (result) => {
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      throw new HTTPException(400, { message: `Validation failed — ${detail}` });
    }
  });
}
