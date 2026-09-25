import type { ProjectWithStats } from '@croquis/client';
import { FileText, MessageSquare, Plus } from 'lucide-preact';
import { useLocation } from 'preact-iso';
import { Page, PageHeader } from '../../layout/Page';
import { t, timeAgo } from '../../lib/i18n';
import { hasRole } from '../../lib/permissions';
import { useProjects } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Badge, EmptyState, Skeleton } from '../../ui/Display';
import { NewProjectDialog } from './NewProjectDialog';

const COVERS = ['purple', 'blue', 'green', 'yellow', 'orange', 'pink'] as const;

/** A stable pastel for each project, derived from its id. */
function coverOf(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COVERS[hash % COVERS.length] as string;
}

function ProjectCard({ project }: { project: ProjectWithStats }) {
  const { stats } = project;
  return (
    <a class="c-card c-card--interactive" href={`/projects/${project.id}/inbox`}>
      <div class={`c-cover c-cover--${coverOf(project.id)}`} aria-hidden="true" />
      <div class="c-card__header">
        <div class="o-stack o-stack--xs">
          <span class="c-card__title">{project.name}</span>
          <span class="c-card__meta u-truncate">{project.description || project.slug}</span>
        </div>
        {project.widget_mode === 'off' ? <Badge>{t('projects.mode.off')}</Badge> : null}
      </div>
      <div class="o-cluster o-cluster--lg">
        <span class="o-cluster u-secondary u-text-sm">
          <FileText class="c-icon c-icon--sm" />
          {t('projects.pages', { count: stats.pages })}
        </span>
        <span class="o-cluster u-secondary u-text-sm">
          <MessageSquare class="c-icon c-icon--sm" />
          {t('projects.open', { count: stats.comments_active })}
        </span>
        {stats.comments_unassigned ? (
          <Badge tone="warning">
            {t('projects.unassigned', { count: stats.comments_unassigned })}
          </Badge>
        ) : null}
      </div>
      <div class="c-card__footer">
        <span class="c-card__meta">
          {t('common.updated')} {timeAgo(project.updated_at)}
        </span>
      </div>
    </a>
  );
}

export function ProjectsPage() {
  const { query, route } = useLocation();
  const projects = useProjects();
  const canCreate = hasRole('admin');
  const creating = query.new === '1';
  const setCreating = (open: boolean) => route(open ? '/projects?new=1' : '/projects', true);

  return (
    <Page>
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        actions={
          canCreate ? (
            <Button
              variant="primary"
              icon={<Plus class="c-icon" />}
              onClick={() => setCreating(true)}
            >
              {t('projects.new')}
            </Button>
          ) : null
        }
      />
      {projects.loading ? (
        <div class="o-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} class="c-card">
              <Skeleton />
            </div>
          ))}
        </div>
      ) : (projects.data ?? []).length === 0 ? (
        <EmptyState
          title={t('projects.empty')}
          text={t('projects.emptyText')}
          action={
            canCreate ? (
              <Button
                variant="primary"
                icon={<Plus class="c-icon" />}
                onClick={() => setCreating(true)}
              >
                {t('projects.new')}
              </Button>
            ) : null
          }
        />
      ) : (
        <div class="o-grid">
          {(projects.data ?? []).map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
      <NewProjectDialog open={creating && canCreate} onClose={() => setCreating(false)} />
    </Page>
  );
}
