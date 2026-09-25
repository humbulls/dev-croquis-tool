import { z } from 'zod';
import { FIELD_LIMITS, PAGE_SIZE } from '../constants';

/** UUID primary key. */
export const id = z.uuid();
/** Epoch milliseconds (`Date.now()`). */
export const epochMs = z.number().int().nonnegative();
export const httpUrl = z
  .string()
  .max(FIELD_LIMITS.url)
  .refine((v) => /^https?:\/\//i.test(v), 'must be an http(s) URL');

/** `?cursor=…&limit=…` for list endpoints (opaque cursor). */
export const listQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE.max).default(PAGE_SIZE.default),
});
export type ListQuery = z.infer<typeof listQuery>;

/** Envelope for paginated lists. `next_cursor` is null on the last page. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), next_cursor: z.string().nullable() });
}
export interface Paginated<T> {
  data: T[];
  next_cursor: string | null;
}

/** Envelope for small, unpaginated collections. */
export function list<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item) });
}

/** RFC 9457 problem details — every error response uses this shape. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  /** Stable machine-readable code, e.g. `comment_not_found`. */
  code: z.string(),
  /** Field errors for 422 responses. */
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  request_id: z.string().optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export const okSchema = z.object({ ok: z.literal(true) });
