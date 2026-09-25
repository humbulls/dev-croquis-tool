import type { CommentFilters } from '@croquis/client';
import { api } from './api';
import { useQuery } from './query';
import { workspace } from './session';

/** Shared query definitions so every view uses the same cache keys. */

export function useProjects() {
  const workspaceId = workspace.value?.id ?? null;
  return useQuery(workspaceId ? ['projects', workspaceId] : null, async () => {
    const items = [];
    for await (const project of api.paginate((cursor) =>
      api.projects.list({ cursor, workspace_id: workspaceId ?? undefined, limit: 200 }),
    )) {
      items.push(project);
    }
    return items;
  });
}

export const useProject = (projectId: string) =>
  useQuery(['project', projectId], () => api.projects.get(projectId));
export const usePages = (projectId: string) =>
  useQuery(['pages', projectId], async () => (await api.pages.list(projectId)).data);
export const useLabels = (projectId: string) =>
  useQuery(['labels', projectId], async () => (await api.labels.list(projectId)).data);
export const useMembers = (workspaceId: string | undefined) =>
  useQuery(
    workspaceId ? ['members', workspaceId] : null,
    async () => (await api.workspaces.members(workspaceId as string)).data,
  );
export const useCounts = (projectId: string) =>
  useQuery(['comments', projectId, 'counts'], () => api.comments.counts(projectId), {
    refreshMs: 30_000,
  });
export const useComments = (projectId: string, filters: CommentFilters) =>
  useQuery(
    ['comments', projectId, 'list', filters as Record<string, unknown>],
    () => api.comments.list(projectId, filters),
    { refreshMs: 30_000 },
  );
export const useComment = (commentId: string | null) =>
  useQuery(commentId ? ['comment', commentId] : null, () => api.comments.get(commentId as string));
