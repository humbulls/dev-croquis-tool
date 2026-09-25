import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api, errorMessage } from '../../lib/api';
import { t } from '../../lib/i18n';
import { loadInstance, loadMe } from '../../lib/session';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Display';
import { Field, Input } from '../../ui/Form';

export function SetupPage() {
  const { route } = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    setBusy(true);
    setError(null);
    try {
      await api.request('POST', '/setup', {
        body: {
          admin_token: String(data.get('admin_token')),
          name: String(data.get('name')),
          email: String(data.get('email')),
          password: String(data.get('password')),
          workspace_name: String(data.get('workspace_name')),
        },
      });
      await Promise.all([loadInstance(), loadMe()]);
      route('/projects', true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="c-auth__card" onSubmit={submit}>
      <div class="o-stack o-stack--xs">
        <h2>{t('setup.title')}</h2>
        <p class="u-secondary u-text-sm">{t('setup.intro')}</p>
      </div>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Field label={t('setup.adminToken')} hint={t('setup.adminTokenHint')}>
        {(id) => <Input id={id} name="admin_token" type="password" required autoComplete="off" />}
      </Field>
      <Field label={t('common.name')}>
        {(id) => <Input id={id} name="name" required autoComplete="name" />}
      </Field>
      <Field label={t('common.email')}>
        {(id) => <Input id={id} name="email" type="email" required autoComplete="email" />}
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
      <Field label={t('setup.workspace')} hint={t('setup.workspaceHint')}>
        {(id) => <Input id={id} name="workspace_name" required maxLength={80} />}
      </Field>
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        {t('setup.submit')}
      </Button>
    </form>
  );
}
