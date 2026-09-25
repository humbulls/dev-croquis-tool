import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api, errorMessage } from '../../lib/api';
import { t } from '../../lib/i18n';
import { invalidate } from '../../lib/query';
import { workspace } from '../../lib/session';
import { toast } from '../../lib/toast';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Display';
import { Field, Input, Select } from '../../ui/Form';
import { Modal } from '../../ui/Modal';

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { route } = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: Event) => {
    const data = new FormData(event.target as HTMLFormElement);
    setBusy(true);
    setError(null);
    try {
      const origin = String(data.get('origin') ?? '').trim();
      const project = await api.projects.create({
        workspace_id: workspace.value?.id,
        name: String(data.get('name')),
        widget_mode: data.get('widget_mode') as 'activated' | 'always' | 'off',
        origin: origin || undefined,
      });
      await invalidate(['projects']);
      toast(t('projects.created'));
      onClose();
      route(`/projects/${project.id}/settings?setup=1`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('projects.new')}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Field label={t('projects.name')}>
        {(id) => (
          <Input
            id={id}
            name="name"
            required
            maxLength={120}
            placeholder={t('projects.namePlaceholder')}
            autoFocus
          />
        )}
      </Field>
      <Field label={t('projects.origin')} hint={t('projects.originHint')} optional>
        {(id) => (
          <Input id={id} name="origin" type="url" placeholder="https://staging.example.com" />
        )}
      </Field>
      <Field label={t('projects.widgetMode')}>
        {(id) => (
          <Select
            id={id}
            name="widget_mode"
            options={[
              { value: 'activated', label: t('projects.mode.activated') },
              { value: 'always', label: t('projects.mode.always') },
              { value: 'off', label: t('projects.mode.off') },
            ]}
          />
        )}
      </Field>
    </Modal>
  );
}
