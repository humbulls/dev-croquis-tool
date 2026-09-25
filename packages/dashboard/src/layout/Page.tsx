import type { ComponentChildren } from 'preact';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  actions?: ComponentChildren;
}) {
  return (
    <header class="c-page-header">
      <div class="c-page-header__title">
        <h1>{title}</h1>
        {subtitle ? <p class="c-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div class="o-cluster">{actions}</div> : null}
    </header>
  );
}

export function Page({ children, narrow }: { children: ComponentChildren; narrow?: boolean }) {
  return (
    <div class="c-page">
      <div class={`o-container${narrow ? ' o-container--prose' : ''}`}>{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ComponentChildren;
}) {
  return (
    <section class="c-settings-section">
      <div class="c-settings-section__intro">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <div class="o-stack">{children}</div>
    </section>
  );
}
