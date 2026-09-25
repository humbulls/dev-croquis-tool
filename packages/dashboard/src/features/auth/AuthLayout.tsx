import type { ComponentChildren } from 'preact';
import { t } from '../../lib/i18n';

export function Logo() {
  return (
    <svg class="c-icon c-icon--lg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 18c3-9 7-13 16-14" />
      <path d="M4 18c4-1 7-3 9-6" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

export function AuthLayout({ children }: { children: ComponentChildren }) {
  return (
    <div class="o-center">
      <div class="c-auth">
        <div class="c-auth__brand">
          <Logo />
          {t('app.name')}
        </div>
        {children}
        <p class="u-muted u-text-xs">{t('app.tagline')}</p>
      </div>
    </div>
  );
}
