import { useState } from 'preact/hooks';
import { Page, PageHeader, SettingsSection } from '../../layout/Page';
import { type Locale, locale, setLocale, t } from '../../lib/i18n';
import { AuthError, changePassword, me, updateName } from '../../lib/session';
import { applyTheme, type Theme, theme } from '../../lib/theme';
import { toast } from '../../lib/toast';
import { Button } from '../../ui/Button';
import { Field, Input, Select } from '../../ui/Form';

export function AccountPage() {
  const user = me.value?.user;
  const [busy, setBusy] = useState<'name' | 'password' | null>(null);
  if (!user) return null;

  return (
    <Page narrow>
      <PageHeader title={t('account.title')} subtitle={user.email} />
      <SettingsSection title={t('account.profile')}>
        <form
          class="o-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy('name');
            try {
              await updateName(
                String(new FormData(event.currentTarget as HTMLFormElement).get('name')),
              );
              toast(t('common.saved'));
            } catch (error) {
              toast(error instanceof Error ? error.message : t('common.unknownError'), {
                tone: 'error',
              });
            } finally {
              setBusy(null);
            }
          }}
        >
          <Field label={t('common.name')}>
            {(id) => <Input id={id} name="name" required maxLength={120} value={user.name} />}
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={busy === 'name'}>
              {t('common.save')}
            </Button>
          </div>
        </form>
        <div class="o-cluster o-cluster--lg">
          <Field label={t('nav.language')}>
            {(id) => (
              <Select
                id={id}
                value={locale.value}
                onChange={(e) => setLocale((e.target as HTMLSelectElement).value as Locale)}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ja', label: '日本語' },
                ]}
              />
            )}
          </Field>
          <Field label={t('nav.theme')}>
            {(id) => (
              <Select
                id={id}
                value={theme.value}
                onChange={(e) => applyTheme((e.target as HTMLSelectElement).value as Theme)}
                options={(['system', 'light', 'dark'] as const).map((v) => ({
                  value: v,
                  label: t(`theme.${v}`),
                }))}
              />
            )}
          </Field>
        </div>
      </SettingsSection>
      <SettingsSection title={t('account.password')}>
        <form
          class="o-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            const data = new FormData(form);
            setBusy('password');
            try {
              await changePassword(String(data.get('current')), String(data.get('next')));
              toast(t('account.passwordChanged'));
              form.reset();
            } catch (error) {
              toast(error instanceof AuthError ? error.message : t('common.unknownError'), {
                tone: 'error',
              });
            } finally {
              setBusy(null);
            }
          }}
        >
          <Field label={t('account.currentPassword')}>
            {(id) => (
              <Input
                id={id}
                name="current"
                type="password"
                required
                autoComplete="current-password"
              />
            )}
          </Field>
          <Field label={t('account.newPassword')} hint={t('auth.passwordHint')}>
            {(id) => (
              <Input
                id={id}
                name="next"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            )}
          </Field>
          <div>
            <Button type="submit" loading={busy === 'password'}>
              {t('account.changePassword')}
            </Button>
          </div>
        </form>
      </SettingsSection>
    </Page>
  );
}
