import { z } from '@hono/zod-openapi';
import { createAuth } from '../auth';
import { runtimeConfig, VERSION } from '../config';
import {
  type ApiKeyRow,
  countOwners,
  getInvitationByTokenHash,
  getMember,
  INVITATION_SELECT,
  type InvitationRow,
  type InvitationWithInviter,
  listAllWorkspaces,
  listApiKeys,
  listInvitations,
  listMembers,
  listUserWorkspaces,
  toApiKey,
  toInvitation,
  toWorkspace,
  uniqueWorkspaceSlug,
} from '../db/workspaces';
import { background } from '../http/background';
import {
  body,
  createRouter,
  idParam,
  json,
  noContent,
  problem,
  publicRoute,
  route,
} from '../http/openapi';
import {
  ApiError,
  conflict,
  forbidden,
  notFound,
  orThrow,
  unauthorized,
  unprocessable,
} from '../http/problem';
import { rateLimit } from '../http/rate-limit';
import * as S from '../http/schemas';
import { requireWorkspace, type WorkspaceRow } from '../security/access';
import { secretsEqual, sha256Hex } from '../security/crypto';
import { requireUser, roleAtLeast } from '../security/permissions';
import { displayPrefix, newApiKey, newId, newInvitationToken, slugify } from '../security/tokens';
import { aiConfigured } from '../services/ai';
import { deleteObjects, deleteProjectObjects } from '../services/attachments';
import { emailEnabled, sendEmail } from '../services/email';

const INVITATION_TTL_MS = 7 * 24 * 3_600_000;
/** Workspace created for v0 projects by migration 0002; claimed by /setup. */
const LEGACY_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

const app = createRouter();
const WorkspaceParams = idParam('workspaceId', 'Workspace id');
const tags = ['Workspaces'];

// ---------------------------------------------------------------------------
// Instance setup
// ---------------------------------------------------------------------------

app.openapi(
  publicRoute({
    method: 'get',
    path: '/setup',
    tags: ['Setup'],
    summary: 'Instance status',
    description:
      'Tells the dashboard whether the first account still has to be created, and which features are on.',
    responses: { 200: json(S.SetupStatus, 'Instance status') },
  }),
  async (c) => {
    const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    const config = runtimeConfig(c.env);
    return c.json(
      {
        needs_setup: (row?.n ?? 0) === 0,
        signup_mode: config.signupMode,
        ai_enabled: aiConfigured(c.env),
        edition: config.edition,
        version: VERSION,
      },
      200,
    );
  },
);

app.openapi(
  publicRoute({
    method: 'post',
    path: '/setup',
    tags: ['Setup'],
    summary: 'Create the first owner',
    description:
      'One-time bootstrap: creates the first account and its workspace. Requires the instance ADMIN_TOKEN, so only the operator can claim a fresh deployment. Responds with a session cookie.',
    request: body(S.SetupInput),
    responses: {
      201: json(S.Me, 'Owner account created and signed in'),
      401: problem('Wrong ADMIN_TOKEN'),
      409: problem('Already set up, or ADMIN_TOKEN is not configured'),
    },
  }),
  async (c) => {
    await rateLimit(c, 'setup');
    const input = c.req.valid('json');
    if (!c.env.ADMIN_TOKEN) {
      throw conflict(
        'admin_token_not_configured',
        'Set the ADMIN_TOKEN secret (wrangler secret put ADMIN_TOKEN) before running setup',
      );
    }
    if (!(await secretsEqual(input.admin_token, c.env.ADMIN_TOKEN))) {
      throw new ApiError(
        401,
        'invalid_admin_token',
        'Unauthorized',
        'The admin token is not correct',
      );
    }
    const existing = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{
      n: number;
    }>();
    if ((existing?.n ?? 0) > 0)
      throw conflict('already_set_up', 'This instance already has an owner; sign in instead');

    const auth = createAuth(c.env, new URL(c.req.url).origin, { bootstrap: true });
    const { headers, response } = await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    const user = response.user;
    const now = Date.now();

    const legacy = await c.env.DB.prepare('SELECT id FROM workspaces WHERE id = ?')
      .bind(LEGACY_WORKSPACE_ID)
      .first();
    const workspaceId = legacy ? LEGACY_WORKSPACE_ID : newId();
    const slug = await uniqueWorkspaceSlug(c.env.DB, slugify(input.workspace_name));
    await c.env.DB.batch([
      legacy
        ? c.env.DB.prepare(
            'UPDATE workspaces SET name = ?, slug = ?, updated_at = ? WHERE id = ?',
          ).bind(input.workspace_name, slug, now, workspaceId)
        : c.env.DB.prepare(
            'INSERT INTO workspaces (id, name, slug, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          ).bind(workspaceId, input.workspace_name, slug, 'free', now, now),
      c.env.DB.prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`,
      ).bind(newId(), workspaceId, user.id, now),
    ]);

    const cookie = headers.get('set-cookie');
    if (cookie) c.header('Set-Cookie', cookie);
    return c.json(
      {
        user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
        workspaces: await listUserWorkspaces(c.env.DB, user.id),
      },
      201,
    );
  },
);

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/me',
    tags: ['Account'],
    summary: 'Current user',
    description: 'The signed-in user and the workspaces they belong to (session only).',
    responses: { 200: json(S.Me, 'The current user') },
  }),
  async (c) => {
    const principal = c.get('principal');
    requireUser(principal);
    return c.json(
      { user: principal.user, workspaces: await listUserWorkspaces(c.env.DB, principal.user.id) },
      200,
    );
  },
);

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/workspaces',
    tags,
    summary: 'List workspaces',
    description:
      'Workspaces visible to the caller: memberships for users, the key’s workspace for API keys.',
    responses: { 200: json(S.data(S.Workspace), 'Workspaces') },
  }),
  async (c) => {
    const principal = c.get('principal');
    switch (principal.type) {
      case 'user':
        return c.json({ data: await listUserWorkspaces(c.env.DB, principal.user.id) }, 200);
      case 'admin':
        return c.json({ data: await listAllWorkspaces(c.env.DB) }, 200);
      case 'api_key': {
        const row = await c.env.DB.prepare('SELECT * FROM workspaces WHERE id = ?')
          .bind(principal.key.workspaceId)
          .first<WorkspaceRow>();
        return c.json({ data: row ? [toWorkspace(row, 'member')] : [] }, 200);
      }
      default:
        throw unauthorized();
    }
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/workspaces',
    tags,
    summary: 'Create a workspace',
    description:
      'Anyone may create workspaces when sign-up is open (Croquis Cloud). On invite-only instances, existing workspace owners can.',
    request: body(S.CreateWorkspaceInput),
    responses: { 201: json(S.Workspace, 'Created; the caller is its owner') },
  }),
  async (c) => {
    const principal = c.get('principal');
    requireUser(principal);
    const input = c.req.valid('json');
    if (runtimeConfig(c.env).signupMode !== 'open') {
      const owner = await c.env.DB.prepare(
        `SELECT 1 AS ok FROM workspace_members WHERE user_id = ? AND role = 'owner' LIMIT 1`,
      )
        .bind(principal.user.id)
        .first();
      if (!owner)
        throw forbidden('Only workspace owners can create more workspaces on this instance');
    }
    const now = Date.now();
    const id = newId();
    const slug = await uniqueWorkspaceSlug(c.env.DB, slugify(input.name));
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO workspaces (id, name, slug, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(
        id,
        input.name,
        slug,
        runtimeConfig(c.env).edition === 'cloud' ? 'beta' : 'free',
        now,
        now,
      ),
      c.env.DB.prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`,
      ).bind(newId(), id, principal.user.id, now),
    ]);
    const { workspace } = await requireWorkspace(c, id, 'workspace.read');
    return c.json(toWorkspace(workspace, 'owner'), 201);
  },
);

app.openapi(
  route({
    method: 'get',
    path: '/workspaces/{workspaceId}',
    tags,
    summary: 'Get a workspace',
    request: { params: WorkspaceParams },
    responses: { 200: json(S.Workspace, 'The workspace') },
  }),
  async (c) => {
    const { workspace, role } = await requireWorkspace(
      c,
      c.req.valid('param').workspaceId,
      'workspace.read',
    );
    return c.json(toWorkspace(workspace, role ?? 'member'), 200);
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/workspaces/{workspaceId}',
    tags,
    summary: 'Rename a workspace',
    description: 'Owners only. The slug is permanent.',
    request: { params: WorkspaceParams, ...body(S.UpdateWorkspaceInput) },
    responses: { 200: json(S.Workspace, 'Updated') },
  }),
  async (c) => {
    const { workspaceId } = c.req.valid('param');
    const input = c.req.valid('json');
    const { workspace, role } = await requireWorkspace(c, workspaceId, 'workspace.manage');
    if (input.name !== undefined) {
      await c.env.DB.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?')
        .bind(input.name, Date.now(), workspaceId)
        .run();
    }
    return c.json(
      toWorkspace({ ...workspace, name: input.name ?? workspace.name }, role ?? 'owner'),
      200,
    );
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/workspaces/{workspaceId}',
    tags,
    summary: 'Delete a workspace',
    description: 'Owners only. Permanently deletes every project, comment and attachment in it.',
    request: { params: WorkspaceParams },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { workspaceId } = c.req.valid('param');
    await requireWorkspace(c, workspaceId, 'workspace.manage');
    const { results: projects } = await c.env.DB.prepare(
      'SELECT id FROM projects WHERE workspace_id = ?',
    )
      .bind(workspaceId)
      .all<{ id: string }>();
    const { results: objects } = await c.env.DB.prepare(
      'SELECT a.r2_key FROM attachments a JOIN projects p ON p.id = a.project_id WHERE p.workspace_id = ?',
    )
      .bind(workspaceId)
      .all<{ r2_key: string }>();
    await c.env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(workspaceId).run();
    await background(
      c,
      (async () => {
        await deleteObjects(
          c.env.BUCKET,
          objects.map((o) => o.r2_key),
        );
        for (const project of projects) await deleteProjectObjects(c.env.BUCKET, project.id);
      })(),
    );
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const MemberParams = WorkspaceParams.extend(idParam('memberId', 'Member id').shape);

app.openapi(
  route({
    method: 'get',
    path: '/workspaces/{workspaceId}/members',
    tags: ['Members'],
    summary: 'List members',
    request: { params: WorkspaceParams },
    responses: { 200: json(S.data(S.Member), 'Members') },
  }),
  async (c) => {
    const { workspaceId } = c.req.valid('param');
    await requireWorkspace(c, workspaceId, 'workspace.read');
    return c.json({ data: await listMembers(c.env.DB, workspaceId) }, 200);
  },
);

app.openapi(
  route({
    method: 'patch',
    path: '/workspaces/{workspaceId}/members/{memberId}',
    tags: ['Members'],
    summary: 'Change a member’s role',
    description:
      'Admins manage members and admins; only owners can grant or remove the owner role. A workspace always keeps at least one owner.',
    request: { params: MemberParams, ...body(S.UpdateMemberInput) },
    responses: {
      200: json(S.Member, 'Updated'),
      409: problem('Would leave the workspace without an owner'),
    },
  }),
  async (c) => {
    const { workspaceId, memberId } = c.req.valid('param');
    const { role: nextRole } = c.req.valid('json');
    const { role: callerRole } = await requireWorkspace(c, workspaceId, 'member.manage');
    const member = orThrow(await getMember(c.env.DB, workspaceId, memberId), notFound('member'));
    const callerIsOwner = callerRole === null || callerRole === 'owner';
    if ((member.role === 'owner' || nextRole === 'owner') && !callerIsOwner) {
      throw forbidden('Only owners can grant or remove the owner role');
    }
    if (
      member.role === 'owner' &&
      nextRole !== 'owner' &&
      (await countOwners(c.env.DB, workspaceId)) <= 1
    ) {
      throw conflict('last_owner', 'Promote another member to owner first');
    }
    await c.env.DB.prepare('UPDATE workspace_members SET role = ? WHERE id = ?')
      .bind(nextRole, memberId)
      .run();
    return c.json({ ...member, role: nextRole }, 200);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/workspaces/{workspaceId}/members/{memberId}',
    tags: ['Members'],
    summary: 'Remove a member (or leave)',
    description:
      'Admins can remove members; anyone can remove themselves. Owners can only be removed by owners, and never the last one.',
    request: { params: MemberParams },
    responses: { 204: noContent, 409: problem('Would leave the workspace without an owner') },
  }),
  async (c) => {
    const { workspaceId, memberId } = c.req.valid('param');
    const principal = c.get('principal');
    const { role: callerRole } = await requireWorkspace(c, workspaceId, 'workspace.read');
    const member = orThrow(await getMember(c.env.DB, workspaceId, memberId), notFound('member'));
    const self = principal.type === 'user' && principal.user.id === member.user.id;
    const callerRank = principal.type === 'admin' ? 'owner' : callerRole;
    if (!self) {
      if (!callerRank || !roleAtLeast(callerRank, 'admin'))
        throw forbidden('Only admins can remove members');
      if (member.role === 'owner' && callerRank !== 'owner')
        throw forbidden('Only owners can remove an owner');
    }
    if (member.role === 'owner' && (await countOwners(c.env.DB, workspaceId)) <= 1) {
      throw conflict(
        'last_owner',
        'A workspace needs at least one owner; delete the workspace instead',
      );
    }
    await c.env.DB.prepare('DELETE FROM workspace_members WHERE id = ?').bind(memberId).run();
    return c.body(null, 204);
  },
);

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/workspaces/{workspaceId}/invitations',
    tags: ['Members'],
    summary: 'List pending invitations',
    request: { params: WorkspaceParams },
    responses: { 200: json(S.data(S.Invitation), 'Pending invitations') },
  }),
  async (c) => {
    const { workspaceId } = c.req.valid('param');
    await requireWorkspace(c, workspaceId, 'member.manage');
    return c.json({ data: await listInvitations(c.env.DB, workspaceId) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/workspaces/{workspaceId}/invitations',
    tags: ['Members'],
    summary: 'Invite someone',
    description:
      'Creates a 7-day invitation link. When the instance has email configured it is mailed; otherwise share `url` yourself. Re-inviting an address replaces its previous link.',
    request: { params: WorkspaceParams, ...body(S.CreateInvitationInput) },
    responses: {
      201: json(S.CreatedInvitation, 'Invitation created'),
      409: problem('Already a member'),
    },
  }),
  async (c) => {
    const { workspaceId } = c.req.valid('param');
    const input = c.req.valid('json');
    const principal = c.get('principal');
    const { workspace } = await requireWorkspace(c, workspaceId, 'member.manage');
    const email = input.email.toLowerCase();

    const member = await c.env.DB.prepare(
      'SELECT 1 AS ok FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND u.email = ?',
    )
      .bind(workspaceId, email)
      .first();
    if (member) throw conflict('already_member', `${email} is already a member of this workspace`);

    const token = newInvitationToken();
    const now = Date.now();
    const row: InvitationRow = {
      id: newId(),
      workspace_id: workspaceId,
      email,
      role: input.role,
      status: 'pending',
      token_hash: await sha256Hex(token),
      inviter_id: principal.type === 'user' ? principal.user.id : null,
      expires_at: now + INVITATION_TTL_MS,
      accepted_at: null,
      created_at: now,
    };
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE workspace_invitations SET status = 'revoked' WHERE workspace_id = ? AND email = ? AND status = 'pending'`,
      ).bind(workspaceId, email),
      c.env.DB.prepare(
        `INSERT INTO workspace_invitations (id, workspace_id, email, role, status, token_hash, inviter_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      ).bind(
        row.id,
        workspaceId,
        email,
        row.role,
        row.token_hash,
        row.inviter_id,
        row.expires_at,
        now,
      ),
    ]);

    const origin = runtimeConfig(c.env).publicUrl ?? new URL(c.req.url).origin;
    const url = `${origin}/invite/${token}`;
    const inviterName = principal.type === 'user' ? principal.user.name : 'A workspace admin';
    const emailSent = emailEnabled(c.env)
      ? await sendEmail(c.env, {
          to: email,
          subject: `${inviterName} invited you to ${workspace.name} on Croquis`,
          text: `${inviterName} invited you to review work in "${workspace.name}" on Croquis.\n\nAccept the invitation (valid for 7 days):\n${url}\n`,
        })
      : false;

    const saved = await c.env.DB.prepare(`${INVITATION_SELECT} WHERE i.id = ?`)
      .bind(row.id)
      .first<InvitationWithInviter>();
    return c.json(
      { ...toInvitation(orThrow(saved, notFound('invitation'))), url, email_sent: emailSent },
      201,
    );
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/workspaces/{workspaceId}/invitations/{invitationId}',
    tags: ['Members'],
    summary: 'Revoke an invitation',
    request: { params: WorkspaceParams.extend(idParam('invitationId', 'Invitation id').shape) },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { workspaceId, invitationId } = c.req.valid('param');
    await requireWorkspace(c, workspaceId, 'member.manage');
    const result = await c.env.DB.prepare(
      `UPDATE workspace_invitations SET status = 'revoked' WHERE id = ? AND workspace_id = ? AND status = 'pending'`,
    )
      .bind(invitationId, workspaceId)
      .run();
    if (result.meta.changes === 0) throw notFound('invitation');
    return c.body(null, 204);
  },
);

const TokenParams = z.object({
  token: z
    .string()
    .regex(/^inv_[A-Za-z0-9_-]{16,64}$/)
    .openapi({
      param: { name: 'token', in: 'path' },
      description: 'The token from the invitation link',
    }),
});

async function loadInvitation(db: D1Database, token: string) {
  const invitation = await getInvitationByTokenHash(db, await sha256Hex(token));
  if (!invitation || invitation.status === 'revoked') throw notFound('invitation');
  if (invitation.status === 'accepted') {
    throw new ApiError(410, 'invitation_used', 'Gone', 'This invitation has already been accepted');
  }
  if (invitation.expires_at <= Date.now()) {
    throw new ApiError(
      410,
      'invitation_expired',
      'Gone',
      'This invitation has expired; ask for a new one',
    );
  }
  return invitation;
}

app.openapi(
  publicRoute({
    method: 'get',
    path: '/invitations/{token}',
    tags: ['Members'],
    summary: 'Preview an invitation',
    description: 'Shown on the invite landing page before the invitee signs in or signs up.',
    request: { params: TokenParams },
    responses: {
      200: json(S.InvitationPreview, 'The invitation'),
      410: problem('Used or expired'),
    },
  }),
  async (c) => {
    await rateLimit(c, 'invitation');
    const invitation = await loadInvitation(c.env.DB, c.req.valid('param').token);
    const account = await c.env.DB.prepare('SELECT 1 AS ok FROM users WHERE email = ?')
      .bind(invitation.email)
      .first();
    return c.json(
      {
        workspace: { name: invitation.workspace_name },
        email: invitation.email,
        role: invitation.role,
        inviter_name: invitation.inviter_name,
        expires_at: invitation.expires_at,
        account_exists: account !== null,
      },
      200,
    );
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/invitations/{token}/accept',
    tags: ['Members'],
    summary: 'Accept an invitation',
    description: 'The signed-in user must own the invited email address.',
    request: { params: TokenParams },
    responses: { 200: json(S.Workspace, 'Joined'), 410: problem('Used or expired') },
  }),
  async (c) => {
    const principal = c.get('principal');
    requireUser(principal);
    const invitation = await loadInvitation(c.env.DB, c.req.valid('param').token);
    if (invitation.email !== principal.user.email.toLowerCase()) {
      throw forbidden(`This invitation was sent to ${invitation.email}; sign in with that address`);
    }
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      ).bind(newId(), invitation.workspace_id, principal.user.id, invitation.role, now),
      c.env.DB.prepare(
        `UPDATE workspace_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?`,
      ).bind(now, invitation.id),
    ]);
    const { workspace, role } = await requireWorkspace(
      c,
      invitation.workspace_id,
      'workspace.read',
    );
    return c.json(toWorkspace(workspace, role ?? invitation.role), 200);
  },
);

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

app.openapi(
  route({
    method: 'get',
    path: '/workspaces/{workspaceId}/api-keys',
    tags: ['API keys'],
    summary: 'List API keys',
    request: { params: WorkspaceParams },
    responses: { 200: json(S.data(S.ApiKey), 'API keys (active first)') },
  }),
  async (c) => {
    const { workspaceId } = c.req.valid('param');
    await requireWorkspace(c, workspaceId, 'api_key.manage');
    return c.json({ data: await listApiKeys(c.env.DB, workspaceId) }, 200);
  },
);

app.openapi(
  route({
    method: 'post',
    path: '/workspaces/{workspaceId}/api-keys',
    tags: ['API keys'],
    summary: 'Create an API key',
    description:
      'For the MCP server, CI and scripts. Optionally limited to one project and a set of scopes. The key is returned once — store it now.',
    request: { params: WorkspaceParams, ...body(S.CreateApiKeyInput) },
    responses: { 201: json(S.CreatedApiKey, 'Created (the only time `key` is shown)') },
  }),
  async (c) => {
    const { workspaceId } = c.req.valid('param');
    const input = c.req.valid('json');
    const principal = c.get('principal');
    await requireWorkspace(c, workspaceId, 'api_key.manage');
    if (input.project_id) {
      const project = await c.env.DB.prepare(
        'SELECT 1 AS ok FROM projects WHERE id = ? AND workspace_id = ?',
      )
        .bind(input.project_id, workspaceId)
        .first();
      if (!project)
        throw unprocessable('project_not_in_workspace', 'project_id must belong to this workspace');
    }
    if (input.expires_at != null && input.expires_at <= Date.now()) {
      throw unprocessable('invalid_expiry', 'expires_at must be in the future');
    }
    const key = newApiKey();
    const row: ApiKeyRow = {
      id: newId(),
      workspace_id: workspaceId,
      project_id: input.project_id ?? null,
      name: input.name,
      prefix: displayPrefix(key),
      key_hash: await sha256Hex(key),
      scopes: JSON.stringify([...new Set(input.scopes)]),
      created_by: principal.type === 'user' ? principal.user.id : null,
      last_used_at: null,
      expires_at: input.expires_at ?? null,
      revoked_at: null,
      created_at: Date.now(),
    };
    await c.env.DB.prepare(
      `INSERT INTO api_keys (id, workspace_id, project_id, name, prefix, key_hash, scopes, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id,
        row.workspace_id,
        row.project_id,
        row.name,
        row.prefix,
        row.key_hash,
        row.scopes,
        row.created_by,
        row.expires_at,
        row.created_at,
      )
      .run();
    return c.json({ ...toApiKey(row), key }, 201);
  },
);

app.openapi(
  route({
    method: 'delete',
    path: '/workspaces/{workspaceId}/api-keys/{keyId}',
    tags: ['API keys'],
    summary: 'Revoke an API key',
    description: 'Takes effect immediately. Revoked keys stay listed for audit.',
    request: { params: WorkspaceParams.extend(idParam('keyId', 'API key id').shape) },
    responses: { 204: noContent },
  }),
  async (c) => {
    const { workspaceId, keyId } = c.req.valid('param');
    await requireWorkspace(c, workspaceId, 'api_key.manage');
    const result = await c.env.DB.prepare(
      'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL',
    )
      .bind(Date.now(), keyId, workspaceId)
      .run();
    if (result.meta.changes === 0) throw notFound('api_key');
    return c.body(null, 204);
  },
);

export default app;
