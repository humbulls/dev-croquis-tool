import type { Problem } from '@croquis/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodError } from 'zod';
import type { AppEnv } from '../env';

/**
 * Every error leaves the API as RFC 9457 problem+json with a stable `code`
 * that clients can switch on (the `title` is for humans and may change).
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(detail ?? title);
  }
}

export const badRequest = (code: string, detail?: string) =>
  new ApiError(400, code, 'Bad request', detail);
export const unauthorized = (detail = 'Authentication required') =>
  new ApiError(401, 'unauthenticated', 'Unauthorized', detail);
export const forbidden = (detail = 'You do not have access to this resource') =>
  new ApiError(403, 'forbidden', 'Forbidden', detail);
export const notFound = (resource: string) =>
  new ApiError(
    404,
    `${resource}_not_found`,
    'Not found',
    `The ${resource.replace(/_/g, ' ')} does not exist or is not visible to you`,
  );
export const conflict = (code: string, detail: string) =>
  new ApiError(409, code, 'Conflict', detail);
export const unprocessable = (code: string, detail: string) =>
  new ApiError(422, code, 'Unprocessable content', detail);
export const tooManyRequests = (detail = 'Too many requests — slow down and retry later') =>
  new ApiError(429, 'rate_limited', 'Too many requests', detail);
export const quotaExceeded = (detail: string) =>
  new ApiError(402, 'quota_exceeded', 'Quota exceeded', detail);
export const badGateway = (code: string, detail: string) =>
  new ApiError(502, code, 'Bad gateway', detail);
export const notImplemented = (code: string, detail: string) =>
  new ApiError(501, code, 'Not implemented', detail);

/** Throw-style helper for narrowing: `const row = orThrow(await get(), notFound('page'))`. */
export function orThrow<T>(value: T | null | undefined, error: ApiError): T {
  if (value === null || value === undefined) throw error;
  return value;
}

export function problemBody(c: Context<AppEnv>, error: ApiError): Problem {
  return {
    type: `urn:croquis:error:${error.code}`,
    title: error.title,
    status: error.status,
    code: error.code,
    ...(error.detail ? { detail: error.detail } : {}),
    ...(error.errors ? { errors: error.errors } : {}),
    request_id: c.get('requestId'),
  };
}

export function problem(c: Context<AppEnv>, error: ApiError): Response {
  return c.json(problemBody(c, error), error.status, {
    'Content-Type': 'application/problem+json',
  });
}

/** Zod issues → 422 with field paths (`anchor.rel_x`). */
export function validationError(error: ZodError): ApiError {
  return new ApiError(
    422,
    'validation_failed',
    'Validation failed',
    'The request body, query or path did not match the expected shape',
    error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      message: issue.message,
    })),
  );
}
