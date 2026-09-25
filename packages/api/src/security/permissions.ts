import type { ApiKeyScope, WorkspaceRole } from '@croquis/shared';
import { forbidden, notFound, unauthorized } from '../http/problem';
import type { Principal } from './principal';

/**
 * Every protected operation names one permission. A permission is granted to
 * members at or above `role`, and to API keys holding `scope` (null = never
 * available to API keys, e.g. managing people or other keys).
 */
export const PERMISSIONS = {
  'workspace.read': { role: 'member', scope: 'projects:read' },
  'workspace.manage': { role: 'owner', scope: null },
  'member.manage': { role: 'admin', scope: null },
  'api_key.manage': { role: 'admin', scope: null },
  'project.read': { role: 'member', scope: 'projects:read' },
  'project.create': { role: 'admin', scope: 'projects:write' },
  'project.update': { role: 'admin', scope: 'projects:write' },
  'project.delete': { role: 'admin', scope: 'projects:write' },
  /** Share links, review rounds and labels: everyday work for any member. */
  'share.manage': { role: 'member', scope: 'projects:write' },
  'page.read': { role: 'member', scope: 'pages:read' },
  'page.write': { role: 'member', scope: 'pages:write' },
  'comment.read': { role: 'member', scope: 'comments:read' },
  'comment.write': { role: 'member', scope: 'comments:write' },
  'ai.run': { role: 'member', scope: 'ai:run' },
  'webhook.manage': { role: 'admin', scope: 'webhooks:write' },
} as const satisfies Record<string, { role: WorkspaceRole; scope: ApiKeyScope | null }>;

export type Permission = keyof typeof PERMISSIONS;

const ROLE_RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** `*` grants everything; `x:write` implies `x:read`. */
export function scopesAllow(scopes: readonly ApiKeyScope[], required: ApiKeyScope): boolean {
  if (scopes.includes('*') || scopes.includes(required)) return true;
  if (required.endsWith(':read')) {
    return scopes.includes(required.replace(/:read$/, ':write') as ApiKeyScope);
  }
  return false;
}

/** The resource being accessed, as far as authorization is concerned. */
export interface AccessTarget {
  workspaceId: string;
  /** Present for project-level resources; API keys may be limited to one project. */
  projectId?: string;
  /** The caller's membership role, when the principal is a user. */
  role: WorkspaceRole | null;
}

/**
 * Decide whether `principal` may perform `permission` on `target`.
 *
 * Resources the caller cannot see at all produce 404 (not 403) so the API
 * does not reveal which ids exist. 403 is reserved for "you can see it, but
 * your role or key scope does not allow this".
 */
export function authorize(
  principal: Principal,
  permission: Permission,
  target: AccessTarget,
  resource: string,
): void {
  const rule = PERMISSIONS[permission];
  switch (principal.type) {
    case 'admin':
      return;
    case 'anonymous':
      throw unauthorized();
    case 'user': {
      if (!target.role) throw notFound(resource);
      if (!roleAtLeast(target.role, rule.role)) {
        throw forbidden(`This action requires the ${rule.role} role in the workspace`);
      }
      return;
    }
    case 'api_key': {
      const { key } = principal;
      const visible =
        key.workspaceId === target.workspaceId &&
        (key.projectId === null ||
          target.projectId === undefined ||
          key.projectId === target.projectId);
      if (!visible) throw notFound(resource);
      if (rule.scope === null)
        throw forbidden('API keys cannot perform this action; sign in instead');
      if (!scopesAllow(key.scopes, rule.scope)) {
        throw forbidden(`This API key is missing the ${rule.scope} scope`);
      }
      // A project-limited key must not act on the workspace as a whole.
      if (
        key.projectId !== null &&
        target.projectId === undefined &&
        permission !== 'workspace.read'
      ) {
        throw forbidden('This API key is limited to a single project');
      }
      return;
    }
  }
}

/** Throw 401 unless someone is signed in or authenticated with a key. */
export function requireAuthenticated(
  principal: Principal,
): asserts principal is Exclude<Principal, { type: 'anonymous' }> {
  if (principal.type === 'anonymous') throw unauthorized();
}

/** Throw unless the caller is a signed-in person (not a key, not the admin token). */
export function requireUser(
  principal: Principal,
): asserts principal is Extract<Principal, { type: 'user' }> {
  if (principal.type === 'anonymous') throw unauthorized();
  if (principal.type !== 'user')
    throw forbidden('This endpoint is only available to signed-in users');
}
