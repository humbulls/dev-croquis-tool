import { problemSchema } from '@croquis/shared';
import { createRoute, OpenAPIHono, type RouteConfig, z } from '@hono/zod-openapi';
import type { AppEnv } from '../env';
import { validationError } from './problem';

export const ProblemSchema = problemSchema.openapi('Problem');

/** Router whose validation failures become RFC 9457 422 responses. */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw validationError(result.error);
    },
  });
}

export const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: ProblemSchema } },
});

/** Error responses shared by every authenticated endpoint. */
const STANDARD_ERRORS = {
  401: problem('Missing, invalid or expired credentials'),
  403: problem('Authenticated, but the role or API key scope does not allow this'),
  404: problem('The resource does not exist or is not visible to the caller'),
  422: problem('The request did not match the schema (see `errors`)'),
  429: problem('Rate limited — retry after the `Retry-After` header'),
} as const;

const PUBLIC_ERRORS = {
  401: problem('Unknown ingest key, wrong password or missing share session'),
  403: problem('Not allowed (origin, share link settings or reviewer identity)'),
  404: problem('Unknown key, link or resource'),
  422: problem('The request did not match the schema (see `errors`)'),
  429: problem('Rate limited — retry after the `Retry-After` header'),
} as const;

export const SECURITY: Record<string, string[]>[] = [{ bearerAuth: [] }, { cookieAuth: [] }];

/** `createRoute` with the standard error responses and security requirements. */
export function route<const R extends RouteConfig>(config: R) {
  return createRoute({
    security: SECURITY,
    ...config,
    responses: { ...STANDARD_ERRORS, ...config.responses },
  });
}

/** Unauthenticated (or share-token) endpoints used by the widget and share viewer. */
export function publicRoute<const R extends RouteConfig>(config: R) {
  return createRoute({
    security: [] as Record<string, string[]>[],
    ...config,
    responses: { ...PUBLIC_ERRORS, ...config.responses },
  });
}

export function json<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { 'application/json': { schema } } } as const;
}

export function body<T extends z.ZodType>(schema: T, description?: string) {
  return {
    body: { required: true, description, content: { 'application/json': { schema } } },
  } as const;
}

export const noContent = { description: 'Done (no body)' } as const;

/** `{ id }` path parameter, validated as a UUID. */
export function idParam<const N extends string>(name: N, description: string) {
  const shape = {
    [name]: z.uuid().openapi({ param: { name, in: 'path' }, description }),
  } as Record<N, z.ZodUUID>;
  return z.object(shape);
}

export const OkSchema = z.object({ ok: z.literal(true) }).openapi('Ok');
