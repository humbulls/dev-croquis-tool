import type {
  IngestCommentInput,
  IngestResult,
  PublicComment,
  WidgetConfig as RemoteConfig,
  ShareCommentDetail,
  ShareMeta,
  ShareSession,
} from '@croquis/shared';

export class WidgetApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Thin client for the public widget and share-viewer endpoints. */
export class WidgetApi {
  constructor(
    private readonly base: string,
    private readonly ingestKey: string,
  ) {}

  shareToken: string | null = null;

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Croquis-Ingest-Key': this.ingestKey,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.shareToken) headers['X-Croquis-Share-Token'] = this.shareToken;
    const response = await fetch(`${this.base}/api/v1/public${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      mode: 'cors',
      credentials: 'omit',
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as {
        code?: string;
        detail?: string;
        title?: string;
      } | null;
      throw new WidgetApiError(
        response.status,
        problem?.code ?? 'http_error',
        problem?.detail ?? problem?.title ?? response.statusText,
      );
    }
    return (await response.json()) as T;
  }

  config(): Promise<RemoteConfig> {
    return this.request('GET', `/widget/config?key=${encodeURIComponent(this.ingestKey)}`);
  }

  shareMeta(slug: string): Promise<ShareMeta> {
    return this.request('GET', `/share/${slug}`);
  }

  startSession(
    slug: string,
    input: { name: string; password?: string; reviewer_token?: string },
  ): Promise<ShareSession> {
    return this.request('POST', `/share/${slug}/session`, input);
  }

  submit(input: IngestCommentInput): Promise<IngestResult> {
    return this.request('POST', '/ingest/comments', input);
  }

  pins(pageUrl: string): Promise<{ data: PublicComment[] }> {
    return this.request('GET', `/pins?page_url=${encodeURIComponent(pageUrl)}`);
  }

  thread(slug: string, commentId: string): Promise<ShareCommentDetail> {
    return this.request('GET', `/share/${slug}/comments/${commentId}`);
  }

  reply(slug: string, commentId: string, body: string): Promise<unknown> {
    return this.request('POST', `/share/${slug}/comments/${commentId}/replies`, { body });
  }
}
