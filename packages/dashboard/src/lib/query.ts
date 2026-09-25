import { type Signal, signal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';

/**
 * A small query cache (stale-while-revalidate) built on signals. Components
 * read `query.data` and re-render when any code path refreshes the same key
 * (e.g. `invalidate(['comments', projectId])` after a mutation).
 */

type Key = readonly (string | number | boolean | null | undefined | Record<string, unknown>)[];

interface Entry<T> {
  data: Signal<T | undefined>;
  error: Signal<unknown>;
  loading: Signal<boolean>;
  fetchedAt: number;
  inflight: Promise<void> | null;
  fetcher: () => Promise<T>;
}

const cache = new Map<string, Entry<unknown>>();
const STALE_MS = 15_000;

export const keyOf = (key: Key) => JSON.stringify(key);

function entryFor<T>(key: string, fetcher: () => Promise<T>): Entry<T> {
  let entry = cache.get(key) as Entry<T> | undefined;
  if (!entry) {
    entry = {
      data: signal(undefined),
      error: signal(null),
      loading: signal(false),
      fetchedAt: 0,
      inflight: null,
      fetcher,
    };
    cache.set(key, entry as Entry<unknown>);
  }
  entry.fetcher = fetcher;
  return entry;
}

function run<T>(entry: Entry<T>): Promise<void> {
  if (entry.inflight) return entry.inflight;
  entry.loading.value = true;
  entry.inflight = entry
    .fetcher()
    .then((data) => {
      entry.data.value = data;
      entry.error.value = null;
      entry.fetchedAt = Date.now();
    })
    .catch((error: unknown) => {
      entry.error.value = error;
    })
    .finally(() => {
      entry.loading.value = false;
      entry.inflight = null;
    });
  return entry.inflight;
}

export interface Query<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useQuery<T>(
  key: Key | null,
  fetcher: () => Promise<T>,
  options: { refreshMs?: number } = {},
): Query<T> {
  const k = key ? keyOf(key) : null;
  const entry = useMemo(() => (k ? entryFor(k, fetcher) : null), [k]);
  if (entry) entry.fetcher = fetcher;

  useEffect(() => {
    if (!entry) return;
    if (Date.now() - entry.fetchedAt > STALE_MS || entry.data.value === undefined) void run(entry);
    if (!options.refreshMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void run(entry);
    }, options.refreshMs);
    return () => clearInterval(timer);
  }, [entry, options.refreshMs]);

  return {
    data: entry?.data.value,
    error: entry?.error.value ?? null,
    loading: entry ? entry.loading.value && entry.data.value === undefined : false,
    refetch: () => (entry ? run(entry) : Promise.resolve()),
  };
}

/** Refetch every cached query whose key starts with `prefix`. */
export async function invalidate(prefix: Key): Promise<void> {
  const start = keyOf(prefix).slice(0, -1);
  const jobs: Promise<void>[] = [];
  for (const [key, entry] of cache) {
    if (key.startsWith(start)) {
      entry.fetchedAt = 0;
      jobs.push(run(entry));
    }
  }
  await Promise.all(jobs);
}

/** Optimistically replace cached data (e.g. before a PATCH resolves). */
export function setQueryData<T>(key: Key, update: (current: T | undefined) => T | undefined): void {
  const entry = cache.get(keyOf(key)) as Entry<T> | undefined;
  if (entry) entry.data.value = update(entry.data.value);
}

export function clearQueries(): void {
  cache.clear();
}

export function useMutation<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options: {
    onSuccess?: (result: R, ...args: A) => unknown;
    onError?: (error: unknown) => void;
  } = {},
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mutate = async (...args: A): Promise<R | undefined> => {
    setPending(true);
    setError(null);
    try {
      const result = await fn(...args);
      await options.onSuccess?.(result, ...args);
      return result;
    } catch (err) {
      setError(err);
      options.onError?.(err);
      return undefined;
    } finally {
      setPending(false);
    }
  };
  return { mutate, pending, error };
}
