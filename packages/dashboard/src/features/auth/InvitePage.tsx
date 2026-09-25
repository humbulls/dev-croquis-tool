import type { InvitationPreview } from '@croquis/client';
import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api, errorMessage } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useQuery } from '../../lib/query';
import { loadMe, me, selectWorkspace, signOut } from '../../lib/session';
import { Button, buttonClass } from '../../ui/Button';
import { Callout, Skeleton } from '../../ui/Display';

export function InvitePage({ token }: { token: string }) {
  const { route } = useLocation();
  const preview = useQuery(['invitation', token], () =>
    api.request<InvitationPreview>('GET', `/invitations/${token}`),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = `/invite/${token}`;

  if (preview.loading)
    return (
      <div class="c-auth__card">
        <Skeleton />
      </div>
    );
  if (preview.error || !preview.data) {
    return (
      <div class="c-auth__card">
        <h2>{t('invite.title')}</h2>
        <Callout tone="warning">{t('invite.expired')}</Callout>
      </div>
    );
  }
  const invitation = preview.data;
  const user = me.value?.user;
  const wrongAccount = user && user.email.toLowerCase() !== invitation.email;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const workspace = await api.request<{ id: string }>('POST', `/invitations/${token}/accept`);
      await loadMe();
      selectWorkspace(workspace.id);
      route('/projects', true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="c-auth__card">
      <h2>{t('invite.title')}</h2>
      <p>
        {t('invite.body', {
          inviter: invitation.inviter_name ?? '—',
          workspace: invitation.workspace.name,
          role: t(`workspace.role.${invitation.role}`),
        })}
      </p>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {!user ? (
        <>
          <p class="u-secondary u-text-sm">
            {invitation.account_exists
              ? t('invite.signInFirst', { email: invitation.email })
              : t('invite.createAccount', { email: invitation.email })}
          </p>
          <a
            class={buttonClass('primary', 'lg', 'c-btn--block')}
            href={
              invitation.account_exists
                ? `/sign-in?next=${encodeURIComponent(here)}`
                : `/sign-up?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invitation.email)}`
            }
          >
            {invitation.account_exists ? t('auth.signIn') : t('auth.signUp')}
          </a>
        </>
      ) : wrongAccount ? (
        <>
          <Callout tone="warning">{t('invite.wrongAccount', { email: invitation.email })}</Callout>
          <Button
            onClick={async () => {
              await signOut();
              route(`/sign-in?next=${encodeURIComponent(here)}`);
            }}
          >
            {t('nav.signOut')}
          </Button>
        </>
      ) : (
        <Button variant="primary" size="lg" block loading={busy} onClick={accept}>
          {t('invite.accept')}
        </Button>
      )}
    </div>
  );
}
