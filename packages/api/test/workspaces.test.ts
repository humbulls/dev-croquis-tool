import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_TOKEN,
  addMember,
  api,
  BASE,
  call,
  cookieFrom,
  createApiKey,
  createProject,
  json,
  type Session,
  setupOwner,
  signUp,
  uniqueEmail,
} from './helpers';

let owner: Session;

beforeAll(async () => {
  owner = await setupOwner();
});

describe('setup', () => {
  it('reports status without authentication', async () => {
    const status = await json(await api.get('/setup'));
    expect(status).toMatchObject({
      needs_setup: false,
      signup_mode: 'invite',
      ai_enabled: false,
      edition: 'self-hosted',
    });
    expect(status.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('refuses a second setup and a wrong admin token with problem details', async () => {
    const again = await api.post('/setup', {
      admin_token: ADMIN_TOKEN,
      name: 'Mallory',
      email: uniqueEmail('mallory'),
      password: 'long enough password',
      workspace_name: 'Evil',
    });
    expect(again.status).toBe(409);
    expect(again.headers.get('content-type')).toContain('application/problem+json');
    expect(await json(again)).toMatchObject({
      code: 'already_set_up',
      type: 'urn:croquis:error:already_set_up',
    });

    const wrong = await api.post('/setup', {
      admin_token: 'nope',
      name: 'Mallory',
      email: uniqueEmail('mallory'),
      password: 'long enough password',
      workspace_name: 'Evil',
    });
    expect(wrong.status).toBe(401);
    expect((await json(wrong)).code).toBe('invalid_admin_token');
  });
});

describe('sessions and the current user', () => {
  it('returns the owner with an owner-role workspace', async () => {
    const me = await json(await api.get('/me', owner));
    expect(me.user.email).toBe(owner.email);
    expect(me.workspaces).toEqual([
      expect.objectContaining({ id: owner.workspaceId, role: 'owner', name: 'Acme' }),
    ]);
  });

  it('requires authentication', async () => {
    const response = await api.get('/me');
    expect(response.status).toBe(401);
    expect(await json(response)).toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  it('rejects an invalid bearer token instead of falling back to cookies', async () => {
    const response = await call('/api/v1/me', {
      headers: { Authorization: 'Bearer crq_bogus', Cookie: owner.cookie },
    });
    expect(response.status).toBe(401);
  });

  it('blocks cookie-authenticated writes from foreign origins (CSRF)', async () => {
    const response = await call('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        Cookie: owner.cookie,
        Origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(response.status).toBe(401);
  });
});

describe('invite-only sign-up', () => {
  it('rejects sign-ups without an invitation', async () => {
    const response = await signUp(uniqueEmail('stranger'));
    expect(response.status).toBe(403);
    expect(JSON.stringify(await json(response))).toContain('SIGNUP_REQUIRES_INVITATION');
  });

  it('lets an invited person sign up, preview and accept exactly once', async () => {
    const email = uniqueEmail('bob');
    const created = await api.post(
      `/workspaces/${owner.workspaceId}/invitations`,
      { email },
      owner,
    );
    expect(created.status).toBe(201);
    const invitation = await json(created);
    expect(invitation).toMatchObject({
      email,
      role: 'member',
      status: 'pending',
      email_sent: false,
    });
    expect(invitation.url).toMatch(new RegExp(`^${BASE}/invite/inv_`));
    const token = invitation.url.split('/invite/')[1];

    const preview = await json(await api.get(`/invitations/${token}`));
    expect(preview).toMatchObject({
      email,
      workspace: { name: 'Acme' },
      account_exists: false,
      inviter_name: 'Olivia Owner',
    });

    const signup = await signUp(email, 'Bob');
    expect(signup.status).toBe(200);
    const cookie = cookieFrom(signup);

    const accepted = await api.post(`/invitations/${token}/accept`, {}, { cookie });
    expect(accepted.status).toBe(200);
    expect(await json(accepted)).toMatchObject({ id: owner.workspaceId, role: 'member' });

    const again = await api.post(`/invitations/${token}/accept`, {}, { cookie });
    expect(again.status).toBe(410);
    expect((await json(again)).code).toBe('invitation_used');
  });

  it('only accepts the invitation for the invited address', async () => {
    const invited = uniqueEmail('carol');
    const invitation = await json(
      await api.post(`/workspaces/${owner.workspaceId}/invitations`, { email: invited }, owner),
    );
    const token = invitation.url.split('/invite/')[1];
    const other = await addMember(owner, uniqueEmail('dave'));
    const response = await api.post(`/invitations/${token}/accept`, {}, other);
    expect(response.status).toBe(403);
  });

  it('re-inviting replaces the previous link and refuses existing members', async () => {
    const email = uniqueEmail('erin');
    const first = await json(
      await api.post(`/workspaces/${owner.workspaceId}/invitations`, { email }, owner),
    );
    await api.post(`/workspaces/${owner.workspaceId}/invitations`, { email }, owner);
    const old = await api.get(`/invitations/${first.url.split('/invite/')[1]}`);
    expect(old.status).toBe(404);

    const member = await addMember(owner, uniqueEmail('frank'));
    const dup = await api.post(
      `/workspaces/${owner.workspaceId}/invitations`,
      { email: member.email },
      owner,
    );
    expect(dup.status).toBe(409);
    expect((await json(dup)).code).toBe('already_member');
  });
});

describe('roles', () => {
  it('members can read the workspace but not manage people or keys', async () => {
    const member = await addMember(owner, uniqueEmail('member'));
    expect((await api.get(`/workspaces/${owner.workspaceId}`, member)).status).toBe(200);
    expect((await api.get(`/workspaces/${owner.workspaceId}/members`, member)).status).toBe(200);
    const invite = await api.post(
      `/workspaces/${owner.workspaceId}/invitations`,
      { email: uniqueEmail() },
      member,
    );
    expect(invite.status).toBe(403);
    expect((await api.get(`/workspaces/${owner.workspaceId}/api-keys`, member)).status).toBe(403);
  });

  it('hides workspaces from non-members with 404', async () => {
    const outsider = await addMember(owner, uniqueEmail('outsider'));
    const members = await json(await api.get(`/workspaces/${owner.workspaceId}/members`, owner));
    const outsiderMember = members.data.find(
      (m: { user: { email: string } }) => m.user.email === outsider.email,
    );
    expect(
      (await api.delete(`/workspaces/${owner.workspaceId}/members/${outsiderMember.id}`, owner))
        .status,
    ).toBe(204);
    expect((await api.get(`/workspaces/${owner.workspaceId}`, outsider)).status).toBe(404);
  });

  it('admins cannot touch owners, and the last owner cannot step down', async () => {
    const admin = await addMember(owner, uniqueEmail('admin'), 'admin');
    const members = await json(await api.get(`/workspaces/${owner.workspaceId}/members`, owner));
    const ownerMember = members.data.find((m: { role: string }) => m.role === 'owner');

    const byAdmin = await api.patch(
      `/workspaces/${owner.workspaceId}/members/${ownerMember.id}`,
      { role: 'member' },
      admin,
    );
    expect(byAdmin.status).toBe(403);

    const selfDemote = await api.patch(
      `/workspaces/${owner.workspaceId}/members/${ownerMember.id}`,
      { role: 'admin' },
      owner,
    );
    expect(selfDemote.status).toBe(409);
    expect((await json(selfDemote)).code).toBe('last_owner');
  });

  it('anyone can leave a workspace', async () => {
    const member = await addMember(owner, uniqueEmail('leaver'));
    const members = await json(await api.get(`/workspaces/${owner.workspaceId}/members`, member));
    const mine = members.data.find(
      (m: { user: { email: string } }) => m.user.email === member.email,
    );
    expect(
      (await api.delete(`/workspaces/${owner.workspaceId}/members/${mine.id}`, member)).status,
    ).toBe(204);
  });
});

describe('API keys', () => {
  it('are shown once, authenticate, respect scopes and can be revoked', async () => {
    const created = await api.post(
      `/workspaces/${owner.workspaceId}/api-keys`,
      { name: 'Reader', scopes: ['projects:read'] },
      owner,
    );
    expect(created.status).toBe(201);
    const key = await json(created);
    expect(key.key).toMatch(/^crq_[A-Za-z0-9_-]{40,}$/);
    expect(key.prefix).toBe(`${key.key.slice(0, 12)}…`);

    const list = await json(await api.get(`/workspaces/${owner.workspaceId}/api-keys`, owner));
    expect(JSON.stringify(list)).not.toContain(key.key);

    const auth = { token: key.key };
    expect((await json(await api.get('/workspaces', auth))).data).toHaveLength(1);
    expect((await api.get('/me', auth)).status).toBe(403);
    const write = await api.post('/projects', { name: 'Nope' }, auth);
    expect(write.status).toBe(403);
    expect((await json(write)).detail).toContain('projects:write');

    expect(
      (await api.delete(`/workspaces/${owner.workspaceId}/api-keys/${key.id}`, owner)).status,
    ).toBe(204);
    expect((await api.get('/workspaces', auth)).status).toBe(401);
  });

  it('can be limited to one project', async () => {
    const a = await createProject(owner, { name: 'Project A' });
    const b = await createProject(owner, { name: 'Project B' });
    const token = await createApiKey(owner, { project_id: a.id });
    const listed = await json(await api.get('/projects', { token }));
    expect(listed.data.map((p: { id: string }) => p.id)).toEqual([a.id]);
    expect((await api.get(`/projects/${b.id}`, { token })).status).toBe(404);
    expect(
      (await api.post('/projects', { name: 'C', workspace_id: owner.workspaceId }, { token }))
        .status,
    ).toBe(403);
  });

  it('never works for people management', async () => {
    const token = await createApiKey(owner);
    const response = await api.get(`/workspaces/${owner.workspaceId}/api-keys`, { token });
    expect(response.status).toBe(403);
  });
});

describe('the admin token', () => {
  it('sees every workspace', async () => {
    const response = await api.get('/workspaces', { token: ADMIN_TOKEN });
    expect(response.status).toBe(200);
    expect((await json(response)).data.length).toBeGreaterThanOrEqual(1);
  });
});
