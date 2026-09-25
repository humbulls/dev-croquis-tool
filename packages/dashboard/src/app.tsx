import { useEffect } from 'preact/hooks';
import { ErrorBoundary, LocationProvider, lazy, Route, Router, useLocation } from 'preact-iso';
import { AuthLayout } from './features/auth/AuthLayout';
import { InvitePage } from './features/auth/InvitePage';
import { SetupPage } from './features/auth/SetupPage';
import { SignInPage, SignUpPage } from './features/auth/SignInPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { AppShell } from './layout/AppShell';
import { t } from './lib/i18n';
import { instance, loadInstance, loadMe, me } from './lib/session';
import { EmptyState, Spinner } from './ui/Display';
import { Toasts } from './ui/Toasts';

const ProjectLayout = lazy(() =>
  import('./features/project/ProjectLayout').then((m) => m.ProjectLayout),
);
const WorkspaceSettings = lazy(() =>
  import('./features/settings/WorkspaceSettings').then((m) => m.WorkspaceSettings),
);
const AccountPage = lazy(() =>
  import('./features/settings/AccountPage').then((m) => m.AccountPage),
);
const ShareViewer = lazy(() => import('./features/viewer/ShareViewer').then((m) => m.ShareViewer));

function Redirect({ to }: { to: string }) {
  const { route } = useLocation();
  useEffect(() => route(to, true), [to]);
  return null;
}

function NotFound() {
  return <EmptyState title="404" text={t('common.unknownError')} />;
}

/** Everything behind sign-in lives in the shell. */
function Authenticated() {
  const { url } = useLocation();
  if (me.value === null) return <Redirect to={`/sign-in?next=${encodeURIComponent(url)}`} />;
  return (
    <AppShell>
      <ErrorBoundary>
        <Router>
          <Route path="/" component={() => <Redirect to="/projects" />} />
          <Route path="/projects" component={ProjectsPage} />
          <Route path="/projects/:projectId/:tab?" component={ProjectLayout} />
          <Route path="/settings/workspace" component={WorkspaceSettings} />
          <Route path="/settings/account" component={AccountPage} />
          <Route default component={NotFound} />
        </Router>
      </ErrorBoundary>
    </AppShell>
  );
}

function Routes() {
  const { path } = useLocation();
  useEffect(() => {
    void loadInstance().catch(() => undefined);
    void loadMe().catch(() => undefined);
  }, []);

  if (path.startsWith('/s/')) {
    return (
      <Router>
        <Route path="/s/:slug/:pageId?" component={ShareViewer} />
        <Route default component={NotFound} />
      </Router>
    );
  }
  if (me.value === undefined || instance.value === null) {
    return (
      <div class="o-center">
        <Spinner />
      </div>
    );
  }
  if (instance.value.needs_setup && path !== '/setup') return <Redirect to="/setup" />;

  return (
    <Router>
      <Route
        path="/setup"
        component={() => (
          <AuthLayout>
            <SetupPage />
          </AuthLayout>
        )}
      />
      <Route
        path="/sign-in"
        component={() => (
          <AuthLayout>
            <SignInPage />
          </AuthLayout>
        )}
      />
      <Route
        path="/sign-up"
        component={() => (
          <AuthLayout>
            <SignUpPage />
          </AuthLayout>
        )}
      />
      <Route
        path="/invite/:token"
        component={({ token }: { token: string }) => (
          <AuthLayout>
            <InvitePage token={token} />
          </AuthLayout>
        )}
      />
      <Route default component={Authenticated} />
    </Router>
  );
}

export function App() {
  return (
    <LocationProvider>
      <ErrorBoundary>
        <Routes />
      </ErrorBoundary>
      <Toasts />
    </LocationProvider>
  );
}
