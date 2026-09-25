import type { WorkspaceRole } from '@croquis/shared';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { notFound } from '../http/problem';
import { authorize, type Permission } from './permissions';

type Ctx = Context<AppEnv>;

export interface Scope {
  workspaceId: string;
  projectId: string;
  role: WorkspaceRole | null;
}

interface ScopeColumns {
  _workspace_id: string;
  _project_id: string;
  _role: WorkspaceRole | null;
}

function userIdOf(c: Ctx): string {
  const principal = c.get('principal');
  return principal.type === 'user' ? principal.user.id : '';
}

/**
 * Load one row that belongs to a project and authorize the caller in a single
 * query. `from` must alias the target table as `x` and its project as `p`, e.g.
 * `content_blocks x JOIN pages pg ON pg.id = x.page_id JOIN projects p ON p.id = pg.project_id`.
 */
export async function loadScoped<T>(
  c: Ctx,
  options: { from: string; id: string; permission: Permission; resource: string },
): Promise<{ row: T; scope: Scope }> {
  const result = await c.env.DB.prepare(
    `SELECT x.*, p.workspace_id AS _workspace_id, p.id AS _project_id, m.role AS _role
       FROM ${options.from}
       LEFT JOIN workspace_members m ON m.workspace_id = p.workspace_id AND m.user_id = ?1
      WHERE x.id = ?2`,
  )
    .bind(userIdOf(c), options.id)
    .first<T & ScopeColumns>();
  if (!result) throw notFound(options.resource);
  const { _workspace_id, _project_id, _role, ...row } = result;
  const scope = { workspaceId: _workspace_id, projectId: _project_id, role: _role };
  authorize(c.get('principal'), options.permission, scope, options.resource);
  return { row: row as T, scope };
}

export interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string;
  ingest_key: string;
  widget_mode: 'activated' | 'always' | 'off';
  created_at: number;
  updated_at: number;
}

export function requireProject(c: Ctx, projectId: string, permission: Permission) {
  return loadScoped<ProjectRow>(c, {
    from: 'projects x JOIN projects p ON p.id = x.id',
    id: projectId,
    permission,
    resource: 'project',
  });
}

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'beta' | 'pro';
  created_at: number;
  updated_at: number;
}

export async function requireWorkspace(
  c: Ctx,
  workspaceId: string,
  permission: Permission,
): Promise<{ workspace: WorkspaceRow; role: WorkspaceRole | null }> {
  const result = await c.env.DB.prepare(
    `SELECT w.*, m.role AS _role FROM workspaces w
       LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ?1
      WHERE w.id = ?2`,
  )
    .bind(userIdOf(c), workspaceId)
    .first<WorkspaceRow & { _role: WorkspaceRole | null }>();
  if (!result) throw notFound('workspace');
  const { _role, ...workspace } = result;
  authorize(c.get('principal'), permission, { workspaceId, role: _role }, 'workspace');
  return { workspace, role: _role };
}
