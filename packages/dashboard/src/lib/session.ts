export interface Session {
  apiUrl: string;
  token: string;
}

const STORAGE_KEY = 'croquis.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.apiUrl || !parsed.token) return null;
    return { apiUrl: parsed.apiUrl, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
