import type { Me, SetupStatus, Workspace } from '@croquis/client';
import { computed, signal } from '@preact/signals';
import { api, isStatus } from './api';
import { clearQueries } from './query';

/** undefined = still loading, null = signed out. */
export const me = signal<Me | null | undefined>(undefined);
export const instance = signal<SetupStatus | null>(null);

const WORKSPACE_KEY = 'croquis:workspace';

function savedWorkspace(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export const workspaceId = signal<string | null>(savedWorkspace());

export const workspace = computed<Workspace | null>(() => {
  const list = me.value?.workspaces ?? [];
  return list.find((w) => w.id === workspaceId.value) ?? list[0] ?? null;
});

export function selectWorkspace(id: string): void {
  workspaceId.value = id;
  try {
    localStorage.setItem(WORKSPACE_KEY, id);
  } catch {
    // ignore
  }
}

export async function loadInstance(): Promise<SetupStatus> {
  instance.value = await api.setup.status();
  return instance.value;
}

export async function loadMe(): Promise<Me | null> {
  try {
    me.value = await api.me();
  } catch (error) {
    if (!isStatus(error, 401)) throw error;
    me.value = null;
  }
  return me.value;
}

async function authPost(path: string, body: unknown): Promise<Response> {
  return fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function authOrThrow(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
  } | null;
  throw new AuthError(body?.code ?? 'AUTH_ERROR', body?.message ?? response.statusText);
}

export async function signIn(email: string, password: string): Promise<void> {
  await authOrThrow(await authPost('sign-in/email', { email, password }));
  clearQueries();
  await loadMe();
}

export async function signUp(name: string, email: string, password: string): Promise<void> {
  await authOrThrow(await authPost('sign-up/email', { name, email, password }));
  clearQueries();
  await loadMe();
}

/** Social sign-in: Better Auth answers with the provider's authorization URL. */
export async function signInSocial(
  provider: 'github' | 'google',
  callbackURL: string,
): Promise<void> {
  const response = await authPost('sign-in/social', { provider, callbackURL });
  await authOrThrow(response);
  const { url } = (await response.json()) as { url?: string };
  if (url) location.assign(url);
}

export async function signOut(): Promise<void> {
  await authPost('sign-out', {});
  clearQueries();
  me.value = null;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authOrThrow(
    await authPost('change-password', { currentPassword, newPassword, revokeOtherSessions: true }),
  );
}

export async function updateName(name: string): Promise<void> {
  await authOrThrow(await authPost('update-user', { name }));
  await loadMe();
}
