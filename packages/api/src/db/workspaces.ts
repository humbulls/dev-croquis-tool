import type {
  ApiKey,
  ApiKeyScope,
  Invitation,
  Member,
  UserSummary,
  Workspace,
  WorkspaceRole,
} from '@croquis/shared';
import type { WorkspaceRow } from '../security/access';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export function toUserSummary(row: UserRow): UserSummary {
  return { id: row.id, name: row.name, email: row.email, image: row.image };
}

export function toWorkspace(row: WorkspaceRow, role: WorkspaceRole): Workspace {
  return { id: row.id, name: row.name, slug: row.slug, plan: row.plan, role };
}

export async function listUserWorkspaces(db: D1Database, userId: string): Promise<Workspace[]> {
  const { results } = await db
    .prepare(
      `SELECT w.*, m.role FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = ? ORDER BY w.created_at, w.id`,
    )
    .bind(userId)
    .all<WorkspaceRow & { role: WorkspaceRole }>();
  return results.map((row) => toWorkspace(row, row.role));
}

export async function listAllWorkspaces(db: D1Database): Promise<Workspace[]> {
  const { results } = await db
    .prepare('SELECT * FROM workspaces ORDER BY created_at, id')
    .all<WorkspaceRow>();
  return results.map((row) => toWorkspace(row, 'owner'));
}

/** Unique workspace slug: `acme`, then `acme-2`, `acme-3`, … */
export async function uniqueWorkspaceSlug(db: D1Database, base: string): Promise<string> {
  const { results } = await db
    .prepare(`SELECT slug FROM workspaces WHERE slug = ?1 OR slug LIKE ?1 || '-%'`)
    .bind(base)
    .all<{ slug: string }>();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// --- Members ------------------------------------------------------------------

interface MemberRow extends UserRow {
  member_id: string;
  role: WorkspaceRole;
  member_created_at: number;
}

const MEMBER_SELECT = `SELECT m.id AS member_id, m.role, m.created_at AS member_created_at,
                              u.id, u.name, u.email, u.image
                         FROM workspace_members m JOIN users u ON u.id = m.user_id`;

function toMember(row: MemberRow): Member {
  return {
    id: row.member_id,
    user: toUserSummary(row),
    role: row.role,
    created_at: row.member_created_at,
  };
}

export async function listMembers(db: D1Database, workspaceId: string): Promise<Member[]> {
  const { results } = await db
    .prepare(`${MEMBER_SELECT} WHERE m.workspace_id = ? ORDER BY m.created_at, m.id`)
    .bind(workspaceId)
    .all<MemberRow>();
  return results.map(toMember);
}

export async function getMember(
  db: D1Database,
  workspaceId: string,
  memberId: string,
): Promise<Member | null> {
  const row = await db
    .prepare(`${MEMBER_SELECT} WHERE m.workspace_id = ? AND m.id = ?`)
    .bind(workspaceId, memberId)
    .first<MemberRow>();
  return row ? toMember(row) : null;
}

export async function countOwners(db: D1Database, workspaceId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ? AND role = 'owner'`,
    )
    .bind(workspaceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** True when `userId` belongs to the workspace (used to validate assignees). */
export async function isMember(
  db: D1Database,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .bind(workspaceId, userId)
    .first();
  return row !== null;
}

// --- Invitations --------------------------------------------------------------

export interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'revoked';
  token_hash: string;
  inviter_id: string | null;
  expires_at: number;
  accepted_at: number | null;
  created_at: number;
}

export type InvitationWithInviter = InvitationRow & {
  inviter_name: string | null;
  inviter_email: string | null;
  inviter_image: string | null;
};

export const INVITATION_SELECT = `SELECT i.*, u.name AS inviter_name, u.email AS inviter_email, u.image AS inviter_image
                                    FROM workspace_invitations i LEFT JOIN users u ON u.id = i.inviter_id`;

export function toInvitation(row: InvitationWithInviter): Invitation {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    email: row.email,
    role: row.role,
    status: row.status,
    inviter:
      row.inviter_id && row.inviter_name !== null
        ? {
            id: row.inviter_id,
            name: row.inviter_name,
            email: row.inviter_email ?? '',
            image: row.inviter_image,
          }
        : null,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

export async function listInvitations(db: D1Database, workspaceId: string): Promise<Invitation[]> {
  const { results } = await db
    .prepare(
      `${INVITATION_SELECT} WHERE i.workspace_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC`,
    )
    .bind(workspaceId)
    .all<InvitationWithInviter>();
  return results.map(toInvitation);
}

export async function getInvitationByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<(InvitationWithInviter & { workspace_name: string }) | null> {
  return db
    .prepare(
      `SELECT i.*, u.name AS inviter_name, u.email AS inviter_email, u.image AS inviter_image, w.name AS workspace_name
         FROM workspace_invitations i
         JOIN workspaces w ON w.id = i.workspace_id
         LEFT JOIN users u ON u.id = i.inviter_id
        WHERE i.token_hash = ?`,
    )
    .bind(tokenHash)
    .first();
}

// --- API keys -------------------------------------------------------------------

export interface ApiKeyRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: string;
  created_by: string | null;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

export function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    project_id: row.project_id,
    scopes: JSON.parse(row.scopes) as ApiKeyScope[],
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
  };
}

export async function listApiKeys(db: D1Database, workspaceId: string): Promise<ApiKey[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM api_keys WHERE workspace_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC',
    )
    .bind(workspaceId)
    .all<ApiKeyRow>();
  return results.map(toApiKey);
}
