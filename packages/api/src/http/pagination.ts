import { badRequest } from './problem';

/**
 * Opaque keyset cursor: base64url(JSON [sortValue, id]). Keyset pagination is
 * stable under inserts and costs O(limit) regardless of depth (no OFFSET).
 */
export type CursorValue = [number | string, string];

export function encodeCursor(value: CursorValue): string {
  const json = JSON.stringify(value);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string | undefined): CursorValue | null {
  if (!cursor) return null;
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const parsed: unknown = JSON.parse(atob(padded));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      (typeof parsed[0] === 'number' || typeof parsed[0] === 'string') &&
      typeof parsed[1] === 'string'
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // fall through
  }
  throw badRequest('invalid_cursor', 'The cursor is malformed; start again without it');
}

/**
 * Given `limit + 1` rows, return the page and the cursor for the next one.
 * `key` extracts the sort value used in the WHERE clause.
 */
export function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
  key: (row: T) => number | string,
): { data: T[]; next_cursor: string | null } {
  if (rows.length <= limit) return { data: rows, next_cursor: null };
  const data = rows.slice(0, limit);
  const last = data[data.length - 1] as T;
  return { data, next_cursor: encodeCursor([key(last), last.id]) };
}
