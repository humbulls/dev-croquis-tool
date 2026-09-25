import type { CreatedProject } from '@croquis/shared';
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DashboardClient } from './api/client';
import { clearSession, loadSession, type Session, saveSession } from './lib/session';
import { ProjectDetail } from './views/ProjectDetail';

interface AppContextValue {
  client: DashboardClient;
  notify: (message: string, kind?: 'ok' | 'error') => void;
  disconnect: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext is missing');
  return value;
}

interface AsyncState<T> {
  data?: T;
  loading: boolean;
  error?: string;
  reload: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; loading: boolean; error?: string }>({
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    fn()
      .then((data) => active && setState({ data, loading: false }))
      .catch(
        (e) =>
          active && setState({ loading: false, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession());
  const [toast, setToast] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const notify = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ message, kind });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const client = useMemo(
    () => (session ? new DashboardClient(session.apiUrl, session.token) : null),
    [session],
  );
  const disconnect = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  if (!session || !client) {
    return (
      <AuthScreen
        onConnect={(next) => {
          saveSession(next);
          setSession(next);
        }}
      />
    );
  }

  return (
    <AppContext.Provider value={{ client, notify, disconnect }}>
      <Shell />
      {toast && (
        <div class={`c-toast ${toast.kind === 'error' ? 'c-toast--error' : ''}`}>
          {toast.message}
        </div>
      )}
    </AppContext.Provider>
  );
}

function AuthScreen({ onConnect }: { onConnect: (session: Session) => void }) {
  // Dev convenience only — production builds start blank so a deployed
  // dashboard never points at localhost by default.
  const [apiUrl, setApiUrl] = useState(import.meta.env.DEV ? 'http://localhost:8787' : '');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const client = new DashboardClient(apiUrl, token);
      await client.listProjects();
      onConnect({ apiUrl: apiUrl.replace(/\/$/, ''), token });
    } catch (e) {
      // A TypeError from fetch means the API was never reached — the two usual
      // causes are a wrong URL or a CORS lock (DASHBOARD_ORIGIN mismatch).
      if (e instanceof TypeError) {
        setError(
          "Could not reach the API. Check the URL, and make sure the API's DASHBOARD_ORIGIN allows this dashboard's origin.",
        );
      } else {
        setError(e instanceof Error ? e.message : 'Connection failed');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="c-auth">
      <div class="c-card c-auth__card o-stack">
        <div class="c-sidebar__brand">
          <span class="c-sidebar__mark" />
          Croquis
        </div>
        <p class="u-secondary u-sm">Connect to your Croquis API with the operator (admin) token.</p>
        <label class="c-field">
          <span class="c-field__label">API URL</span>
          <input
            class="c-input"
            value={apiUrl}
            onInput={(e) => setApiUrl((e.target as HTMLInputElement).value)}
            placeholder="https://croquis-api.example.workers.dev"
          />
        </label>
        <label class="c-field">
          <span class="c-field__label">Admin token</span>
          <input
            class="c-input"
            type="password"
            value={token}
            onInput={(e) => setToken((e.target as HTMLInputElement).value)}
            placeholder="ADMIN_TOKEN"
          />
        </label>
        {error && (
          <p class="u-sm" style={{ color: 'var(--cq-color-danger-default)' }}>
            {error}
          </p>
        )}
        <button
          type="button"
          class="c-btn c-btn--primary"
          disabled={busy || !token}
          onClick={connect}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const { disconnect } = useApp();
  const [projectId, setProjectId] = useState<string | null>(null);

  return (
    <div class="o-app">
      <aside class="c-sidebar">
        <div class="c-sidebar__brand">
          <span class="c-sidebar__mark" />
          Croquis
        </div>
        <nav class="c-nav">
          <button
            type="button"
            class={`c-nav__item ${projectId ? '' : 'c-nav__item--active'}`}
            onClick={() => setProjectId(null)}
          >
            Projects
          </button>
        </nav>
        <div class="u-grow" />
        <button type="button" class="c-btn c-btn--ghost c-btn--sm" onClick={disconnect}>
          Disconnect
        </button>
      </aside>
      <main class="o-main">
        {projectId ? (
          <ProjectDetail projectId={projectId} onBack={() => setProjectId(null)} />
        ) : (
          <ProjectList onOpen={setProjectId} />
        )}
      </main>
    </div>
  );
}

function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const { client, notify } = useApp();
  const { data, loading, error, reload } = useAsync(() => client.listProjects(), []);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const project = await client.createProject({ name: name.trim() });
      setCreated(project);
      setName('');
      reload();
      notify('Project created');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to create', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="c-topbar">
        <span class="c-topbar__title">Projects</span>
      </div>
      <div class="o-container o-stack o-stack--loose">
        <div class="c-card o-stack">
          <span class="u-strong">New project</span>
          <div class="o-cluster">
            <input
              class="c-input u-grow"
              value={name}
              placeholder="Project name"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              // isComposing guard: Enter that confirms an IME conversion must not submit.
              onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && create()}
            />
            <button
              type="button"
              class="c-btn c-btn--primary"
              disabled={busy || !name.trim()}
              onClick={create}
            >
              Create
            </button>
          </div>
          {created && <CreatedProjectReveal project={created} onDismiss={() => setCreated(null)} />}
        </div>

        {loading && <div class="c-empty">Loading…</div>}
        {error && <div class="c-empty">Error: {error}</div>}
        {data && data.projects.length === 0 && <div class="c-empty">No projects yet.</div>}
        {data && data.projects.length > 0 && (
          <div class="o-grid">
            {data.projects.map((project) => (
              <button
                type="button"
                key={project.id}
                class="c-card c-card--link o-stack o-stack--tight"
                onClick={() => onOpen(project.id)}
              >
                <span class="c-card__title">{project.name}</span>
                <span class="c-card__meta u-mono">/{project.slug}</span>
                <span class="c-card__meta">
                  Share: /share/{project.share_slug}
                  {project.share_password_protected ? ' 🔒' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function CreatedProjectReveal({
  project,
  onDismiss,
}: {
  project: CreatedProject;
  onDismiss: () => void;
}) {
  const { notify } = useApp();
  const rows: { label: string; value: string }[] = [
    { label: 'API token', value: project.api_token },
    { label: 'Ingest key', value: project.ingest_key },
    { label: 'Share slug', value: project.share_slug },
  ];
  return (
    <div class="o-stack o-stack--tight">
      <p class="u-sm u-secondary">
        Store these now — the API token is shown only once and disappears when you leave this
        screen.
      </p>
      {rows.map((row) => (
        <div key={row.label} class="o-cluster">
          <div class="c-secret u-grow">
            {row.label}: {row.value}
          </div>
          <button
            type="button"
            class="c-btn c-btn--sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(row.value);
                notify(`${row.label} copied`);
              } catch {
                notify('Clipboard write failed', 'error');
              }
            }}
          >
            Copy
          </button>
        </div>
      ))}
      <button type="button" class="c-btn c-btn--ghost c-btn--sm" onClick={onDismiss}>
        I saved these — dismiss
      </button>
    </div>
  );
}
