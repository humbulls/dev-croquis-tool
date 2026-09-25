import type { WorkspaceRole } from '@croquis/client';
import { workspace } from './session';

const RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 };

/** Mirrors the API permission matrix so the UI can hide what would be refused. */
export function hasRole(minimum: WorkspaceRole): boolean {
  const role = workspace.value?.role;
  return role !== undefined && RANK[role] >= RANK[minimum];
}
