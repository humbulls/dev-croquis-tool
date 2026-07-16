import type { CreateCommentInput } from '@croquis/shared';
import type { WidgetConfig } from './config';

/**
 * Derived from the shared schema so the widget payload cannot drift from the
 * API contract (screenshot/page_id are not sent by the widget yet).
 */
export type CommentPayload = Omit<CreateCommentInput, 'screenshot' | 'page_id'>;

/** POST a comment to the write-only ingest endpoint using the ingest key. */
export async function postComment(config: WidgetConfig, payload: CommentPayload): Promise<void> {
  const res = await fetch(`${config.apiUrl}/ingest/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Croquis-Ingest-Key': config.ingestKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Croquis ingest failed: ${res.status}`);
  }
}
