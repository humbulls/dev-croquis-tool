import { ChevronRight } from 'lucide-preact';
import { ErrorBoundary, lazy } from 'preact-iso';
import { t } from '../../lib/i18n';
import { useProject } from '../../lib/queries';
import { EmptyState, Spinner } from '../../ui/Display';

const TABS = {
  inbox: lazy(() => import('../inbox/InboxPage').then((m) => m.InboxPage)),
  board: lazy(() => import('../board/BoardPage').then((m) => m.BoardPage)),
  pages: lazy(() => import('../pages/SitemapPage').then((m) => m.SitemapPage)),
  share: lazy(() => import('../share/SharePage').then((m) => m.SharePage)),
  activity: lazy(() => import('../activity/ActivityPage').then((m) => m.ActivityPage)),
  settings: lazy(() => import('../settings/ProjectSettings').then((m) => m.ProjectSettings)),
} as const;

type Tab = keyof typeof TABS;

const TAB_LABEL: Record<Tab, Parameters<typeof t>[0]> = {
  inbox: 'nav.inbox',
  board: 'nav.board',
  pages: 'nav.pages',
  share: 'nav.share',
  activity: 'nav.activity',
  settings: 'nav.settings',
};

export function ProjectLayout({ projectId, tab = 'inbox' }: { projectId: string; tab?: string }) {
  const project = useProject(projectId);
  const key = (tab in TABS ? tab : 'inbox') as Tab;
  const View = TABS[key];

  if (project.error) return <EmptyState title="404" text={t('common.unknownError')} />;
  return (
    <>
      <div class="c-topbar">
        <nav class="c-breadcrumbs" aria-label="Breadcrumb">
          <a href="/projects">{t('nav.projects')}</a>
          <ChevronRight class="c-icon c-icon--sm" />
          <a href={`/projects/${projectId}/inbox`} class="u-truncate">
            {project.data?.name ?? '…'}
          </a>
          <ChevronRight class="c-icon c-icon--sm" />
          <span class="c-breadcrumbs__current">{t(TAB_LABEL[key])}</span>
        </nav>
      </div>
      {project.data ? (
        <ErrorBoundary>
          <View project={project.data} />
        </ErrorBoundary>
      ) : (
        <div class="o-center">
          <Spinner />
        </div>
      )}
    </>
  );
}
