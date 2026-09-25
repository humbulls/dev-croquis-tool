import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { t } from '../../lib/i18n';
import { AuthError, instance, signIn, signUp } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Display';
import { Field, Input } from '../../ui/Form';

function nextPath(query: Record<string, string>): string {
  const next = query.next ?? '/projects';
  // Only same-app paths — never redirect to another origin.
  return next.startsWith('/') && !next.startsWith('//') ? next : '/projects';
}

export function SignInPage() {
  const { route, query } = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    setBusy(true);
    setError(null);
    try {
      await signIn(String(data.get('email')), String(data.get('password')));
      route(nextPath(query), true);
    } catch (err) {
      setError(
        err instanceof AuthError && /INVALID/.test(err.code)
          ? t('auth.invalid')
          : err instanceof Error
            ? err.message
            : t('common.unknownError'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="c-auth__card" onSubmit={submit}>
      <h2>{t('auth.signInTitle')}</h2>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Field label={t('common.email')}>
        {(id) => (
          <Input id={id} name="email" type="email" required autoComplete="email" autoFocus />
        )}
      </Field>
      <Field label={t('common.password')}>
        {(id) => (
          <Input id={id} name="password" type="password" required autoComplete="current-password" />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        {t('auth.signIn')}
      </Button>
      <p class="u-muted u-text-sm">
        {instance.value?.signup_mode === 'open' ? (
          <>
            {t('auth.openSignup')}{' '}
            <a href={`/sign-up${query.next ? `?next=${encodeURIComponent(query.next)}` : ''}`}>
              {t('auth.signUp')}
            </a>
          </>
        ) : (
          t('auth.noAccount')
        )}
      </p>
    </form>
  );
}

export function SignUpPage() {
  const { route, query } = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    setBusy(true);
    setError(null);
    try {
      await signUp(
        String(data.get('name')),
        String(data.get('email')),
        String(data.get('password')),
      );
      route(nextPath(query), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="c-auth__card" onSubmit={submit}>
      <h2>{t('auth.signUpTitle')}</h2>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Field label={t('common.name')}>
        {(id) => <Input id={id} name="name" required autoComplete="name" autoFocus />}
      </Field>
      <Field label={t('common.email')}>
        {(id) => (
          <Input
            id={id}
            name="email"
            type="email"
            required
            autoComplete="email"
            value={query.email ?? ''}
          />
        )}
      </Field>
      <Field label={t('common.password')} hint={t('auth.passwordHint')}>
        {(id) => (
          <Input
            id={id}
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        {t('auth.signUp')}
      </Button>
      <p class="u-muted u-text-sm">
        {t('auth.haveAccount')}{' '}
        <a href={`/sign-in${query.next ? `?next=${encodeURIComponent(query.next)}` : ''}`}>
          {t('auth.signIn')}
        </a>
      </p>
    </form>
  );
}
