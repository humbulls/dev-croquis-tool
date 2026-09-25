import { describe, expect, it } from 'vitest';
import { filtersFromQuery, filtersToQuery, toApiFilters } from './FilterBar';

describe('inbox filters', () => {
  it('round-trips through the URL query', () => {
    const query = {
      status: 'open,in_review',
      priority: 'urgent',
      page: 'unassigned',
      assignee: 'me',
      q: 'hero',
      sort: 'priority',
    };
    const filters = filtersFromQuery(query);
    expect(filters).toMatchObject({
      status: ['open', 'in_review'],
      priority: ['urgent'],
      page: 'unassigned',
      assignee: 'me',
      q: 'hero',
      sort: 'priority',
    });
    expect(filtersToQuery(filters)).toEqual(query);
  });

  it('omits defaults and maps to API filters', () => {
    const filters = filtersFromQuery({});
    expect(filtersToQuery(filters)).toEqual({});
    expect(toApiFilters(filters)).toEqual({
      status: undefined,
      priority: undefined,
      kind: undefined,
      page: undefined,
      assignee: undefined,
      label: undefined,
      q: undefined,
      sort: 'newest',
      limit: 50,
    });
    expect(filtersFromQuery({ sort: 'bogus' }).sort).toBe('newest');
  });
});
