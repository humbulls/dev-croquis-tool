import { renderHook, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { clearQueries, invalidate, setQueryData, useQuery } from './query';

describe('query cache', () => {
  it('shares data between hooks with the same key and refetches on invalidate', async () => {
    clearQueries();
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const a = renderHook(() => useQuery(['thing', 1], fetcher));
    const b = renderHook(() => useQuery(['thing', 1], fetcher));
    await waitFor(() => expect(a.result.current.data).toBe(1));
    expect(b.result.current.data).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await invalidate(['thing']);
    a.rerender();
    await waitFor(() => expect(a.result.current.data).toBe(2));

    setQueryData<number>(['thing', 1], (v) => (v ?? 0) * 10);
    a.rerender();
    expect(a.result.current.data).toBe(20);
  });

  it('exposes errors', async () => {
    clearQueries();
    const { result } = renderHook(() =>
      useQuery(['broken'], async () => Promise.reject(new Error('nope'))),
    );
    await waitFor(() => expect((result.current.error as Error)?.message).toBe('nope'));
  });
});
