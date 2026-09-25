/**
 * The reviewer's share session, kept in localStorage per project so it
 * survives navigation on the reviewed site. The long-lived reviewer token
 * keeps the same identity across sessions.
 */
export interface ReviewSession {
  slug: string;
  token: string;
  expiresAt: number;
  reviewerToken: string;
  reviewerName: string;
}

const key = (projectId: string) => `croquis:session:${projectId}`;
const reviewerKey = (projectId: string) => `croquis:reviewer:${projectId}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSession(projectId: string): ReviewSession | null {
  try {
    const raw = storage()?.getItem(key(projectId));
    if (!raw) return null;
    const session = JSON.parse(raw) as ReviewSession;
    if (typeof session.token !== 'string' || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function saveSession(projectId: string, session: ReviewSession): void {
  try {
    storage()?.setItem(key(projectId), JSON.stringify(session));
    storage()?.setItem(
      reviewerKey(projectId),
      JSON.stringify({ token: session.reviewerToken, name: session.reviewerName }),
    );
  } catch {
    // Private mode: the session lasts for this page only.
  }
}

export function clearSession(projectId: string): void {
  try {
    storage()?.removeItem(key(projectId));
  } catch {
    // ignore
  }
}

/** The reviewer identity from a previous session (to reuse the same name and id). */
export function loadReviewer(projectId: string): { token: string; name: string } | null {
  try {
    const raw = storage()?.getItem(reviewerKey(projectId));
    return raw ? (JSON.parse(raw) as { token: string; name: string }) : null;
  } catch {
    return null;
  }
}

/** `?croquis=<slug>` activates the widget for a share link; the parameter is then removed from the URL. */
export function takeActivationSlug(): string | null {
  const url = new URL(location.href);
  const slug = url.searchParams.get('croquis');
  if (!slug || !/^[a-z0-9]{6,32}$/.test(slug)) return null;
  url.searchParams.delete('croquis');
  try {
    history.replaceState(history.state, '', url.toString());
  } catch {
    // Some sandboxed frames forbid replaceState; leaving the parameter is harmless.
  }
  return slug;
}
