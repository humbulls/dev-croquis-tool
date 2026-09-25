import {
  Activity,
  BookOpen,
  Check,
  ChevronsUpDown,
  FolderKanban,
  Inbox,
  KanbanSquare,
  Languages,
  LogOut,
  Map as MapIcon,
  Moon,
  Plus,
  Settings,
  Share2,
  SlidersHorizontal,
  User,
} from 'lucide-preact';
import { useLocation } from 'preact-iso';
import { locale, setLocale, t } from '../lib/i18n';
import { hasRole } from '../lib/permissions';
import { useCounts, useProjects } from '../lib/queries';
import { me, selectWorkspace, signOut, workspace } from '../lib/session';
import { applyTheme, theme } from '../lib/theme';
import { Avatar, initials } from '../ui/Display';
import { Menu, MenuHeading, MenuItem, MenuSeparator } from '../ui/Menu';

function NavLink({
  href,
  icon,
  children,
  count,
  nested,
}: {
  href: string;
  icon: preact.ComponentChildren;
  children: preact.ComponentChildren;
  count?: number;
  nested?: boolean;
}) {
  const { path } = useLocation();
  const active = path === href || (href !== '/projects' && path.startsWith(`${href}/`));
  return (
    <a
      href={href}
      class={`c-sidebar__link${active ? ' is-active' : ''}${nested ? ' c-sidebar__link--nested' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span class="u-truncate">{children}</span>
      {count ? <span class="c-sidebar__count">{count}</span> : null}
    </a>
  );
}

function ProjectNav({ projectId }: { projectId: string }) {
  const counts = useCounts(projectId);
  const open = counts.data
    ? counts.data.by_status.open +
      counts.data.by_status.in_progress +
      counts.data.by_status.in_review
    : undefined;
  const base = `/projects/${projectId}`;
  return (
    <>
      <NavLink nested href={`${base}/inbox`} icon={<Inbox class="c-icon" />} count={open}>
        {t('nav.inbox')}
      </NavLink>
      <NavLink nested href={`${base}/board`} icon={<KanbanSquare class="c-icon" />}>
        {t('nav.board')}
      </NavLink>
      <NavLink nested href={`${base}/pages`} icon={<MapIcon class="c-icon" />}>
        {t('nav.pages')}
      </NavLink>
      <NavLink nested href={`${base}/share`} icon={<Share2 class="c-icon" />}>
        {t('nav.share')}
      </NavLink>
      <NavLink nested href={`${base}/activity`} icon={<Activity class="c-icon" />}>
        {t('nav.activity')}
      </NavLink>
      {hasRole('admin') ? (
        <NavLink nested href={`${base}/settings`} icon={<SlidersHorizontal class="c-icon" />}>
          {t('nav.settings')}
        </NavLink>
      ) : null}
    </>
  );
}

export function Sidebar() {
  const { path, route } = useLocation();
  const projects = useProjects();
  const current = workspace.value;
  const activeProject = /^\/projects\/([0-9a-f-]{36})/.exec(path)?.[1] ?? null;
  const user = me.value?.user;

  return (
    <nav class="c-sidebar" aria-label="Main">
      <Menu
        trigger={(props) => (
          <button
            type="button"
            class="c-workspace"
            onClick={props.toggle}
            aria-expanded={props['aria-expanded']}
            aria-haspopup="menu"
          >
            <span class="c-workspace__mark">{initials(current?.name)}</span>
            <span class="u-truncate u-grow">{current?.name ?? t('app.name')}</span>
            <ChevronsUpDown class="c-icon c-icon--sm u-muted" />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuHeading>{t('nav.switchWorkspace')}</MenuHeading>
            {(me.value?.workspaces ?? []).map((w) => (
              <MenuItem
                key={w.id}
                selected={w.id === current?.id}
                onSelect={() => {
                  selectWorkspace(w.id);
                  close();
                  route('/projects');
                }}
              >
                <span class="u-grow u-truncate">{w.name}</span>
                {w.id === current?.id ? <Check class="c-icon c-icon--sm" /> : null}
              </MenuItem>
            ))}
            {hasRole('admin') ? (
              <>
                <MenuSeparator />
                <MenuItem href="/settings/workspace" onSelect={close}>
                  <Settings class="c-icon c-icon--sm" />
                  {t('nav.workspace')}
                </MenuItem>
              </>
            ) : null}
          </>
        )}
      </Menu>

      <div class="c-sidebar__section">
        <NavLink href="/projects" icon={<FolderKanban class="c-icon" />}>
          {t('nav.projects')}
        </NavLink>
      </div>

      <div class="c-sidebar__section">
        <div class="c-sidebar__heading">
          <span>{t('nav.projects')}</span>
          {hasRole('admin') ? (
            <a
              href="/projects?new=1"
              class="c-btn c-btn--ghost c-btn--icon c-btn--sm"
              aria-label={t('nav.newProject')}
              title={t('nav.newProject')}
            >
              <Plus class="c-icon c-icon--sm" />
            </a>
          ) : null}
        </div>
        {(projects.data ?? []).map((project) => (
          <div key={project.id} class="c-sidebar__section">
            <a
              href={`/projects/${project.id}/inbox`}
              class={`c-sidebar__link${activeProject === project.id ? ' is-active' : ''}`}
              aria-current={activeProject === project.id ? 'true' : undefined}
            >
              <span class="c-workspace__mark c-avatar--sm">{initials(project.name)}</span>
              <span class="u-truncate">{project.name}</span>
              {project.stats.comments_active ? (
                <span class="c-sidebar__count">{project.stats.comments_active}</span>
              ) : null}
            </a>
            {activeProject === project.id ? <ProjectNav projectId={project.id} /> : null}
          </div>
        ))}
      </div>

      <div class="c-sidebar__footer">
        <a class="c-sidebar__link" href="/api/docs" target="_blank" rel="noreferrer">
          <BookOpen class="c-icon" />
          {t('nav.docs')}
        </a>
        <Menu
          direction="up"
          trigger={(props) => (
            <button
              type="button"
              class="c-workspace"
              onClick={props.toggle}
              aria-expanded={props['aria-expanded']}
              aria-haspopup="menu"
            >
              <Avatar name={user?.name ?? null} image={user?.image} small />
              <span class="u-truncate u-grow">{user?.name}</span>
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuHeading>{user?.email}</MenuHeading>
              <MenuItem href="/settings/account" onSelect={close}>
                <User class="c-icon c-icon--sm" />
                {t('nav.account')}
              </MenuItem>
              <MenuSeparator />
              <MenuHeading>
                <Languages class="c-icon c-icon--sm" /> {t('nav.language')}
              </MenuHeading>
              <MenuItem selected={locale.value === 'en'} onSelect={() => setLocale('en')}>
                English
              </MenuItem>
              <MenuItem selected={locale.value === 'ja'} onSelect={() => setLocale('ja')}>
                日本語
              </MenuItem>
              <MenuSeparator />
              <MenuHeading>
                <Moon class="c-icon c-icon--sm" /> {t('nav.theme')}
              </MenuHeading>
              {(['system', 'light', 'dark'] as const).map((value) => (
                <MenuItem
                  key={value}
                  selected={theme.value === value}
                  onSelect={() => applyTheme(value)}
                >
                  {t(`theme.${value}`)}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                danger
                onSelect={async () => {
                  close();
                  await signOut();
                  route('/sign-in');
                }}
              >
                <LogOut class="c-icon c-icon--sm" />
                {t('nav.signOut')}
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </nav>
  );
}
