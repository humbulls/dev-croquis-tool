import { t } from './i18n';
import { toast } from './toast';

export async function copyText(text: string, message = t('common.copied')): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    // Clipboard API blocked (insecure context): fall back to a selection copy.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast(message);
  }
}
