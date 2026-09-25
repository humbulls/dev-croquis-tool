import type {
  ActivityEvent,
  AiDigest,
  AiRun,
  AiTranslation,
  AiTriage,
  AiTypoCheck,
  ApiKey,
  Comment,
  CommentCounts,
  CommentDetail,
  ContentBlock,
  CreateApiKeyInput,
  CreateApprovalInput,
  CreateCommentInput,
  CreateContentBlockInput,
  CreatedApiKey,
  CreatedInvitation,
  CreatedWebhook,
  CreateInvitationInput,
  CreateLabelInput,
  CreateOriginInput,
  CreatePageInput,
  CreateProjectInput,
  CreateReplyInput,
  CreateReviewRoundInput,
  CreateShareLinkInput,
  CreateWebhookInput,
  ExternalLink,
  FixCommentInput,
  Integration,
  Invitation,
  Label,
  Me,
  Member,
  PageApproval,
  PageWithStats,
  Paginated,
  Problem,
  ProjectExport,
  ProjectOrigin,
  ProjectWithStats,
  Reply,
  ReviewRound,
  SetupStatus,
  ShareLink,
  UpdateCommentInput,
  UpdateContentBlockInput,
  UpdateLabelInput,
  UpdatePageInput,
  UpdateProjectInput,
  UpdateShareLinkInput,
  UpdateWebhookInput,
  UpsertIntegrationInput,
  WebhookDelivery,
  WebhookEndpoint,
  Workspace,
} from '@croquis/shared';

/**
 * Typed client for the Croquis REST API (`/api/v1`).
 *
 * ```ts
 * const croquis = new CroquisClient({ baseUrl: 'https://croquis.example.com', apiKey: process.env.CROQUIS_API_KEY });
 * const { data } = await croquis.comments.list(projectId, { status: 'open' });
 * ```
 *
 * In the dashboard (same origin, cookie session) omit `apiKey`.
 */

export interface CroquisClientOptions {
  /** Origin of the Croquis instance, e.g. `https://croquis.example.com`. */
  baseUrl: string;
  /** `crq_…` API key. Omit to use the browser session cookie. */
  apiKey?: string;
  /** Identifies the caller; MCP servers send `mcp/<version>` so writes are attributed to an agent. */
  client?: string;
  fetch?: typeof fetch;
  /** Abort requests after this many milliseconds (default 30 s). */
  timeoutMs?: number;
}

/** An API error with the RFC 9457 problem document. Switch on `code`. */
export class CroquisApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ? `${problem.title}: ${problem.detail}` : problem.title);
    this.name = 'CroquisApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.problem = problem;
  }
}

type Query = Record<string, string | number | boolean | undefined | null | readonly string[]>;
type ListOptions = { cursor?: string; limit?: number };

export interface CommentFilters extends ListOptions {
  status?: string | readonly string[];
  priority?: string | readonly string[];
  kind?: string | readonly string[];
  page?: string;
  assignee?: string;
  label?: string;
  q?: string;
  sort?: 'newest' | 'oldest' | 'priority' | 'updated';
}

export class CroquisClient {
  /** Instance origin without a trailing slash ('' = same origin). */
  readonly baseUrl: string;
  private readonly options: CroquisClientOptions;

  constructor(options: CroquisClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.options = options;
  }

  /** Low-level request against `/api/v1`. Throws `CroquisApiError` for non-2xx responses. */
  async request<T>(
    method: string,
    path: string,
    init: { query?: Query; body?: unknown; accept?: string } = {},
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value === undefined || value === null) continue;
      params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    // A relative base ('') targets the current origin (the dashboard).
    const url = `${this.baseUrl}/api/v1${path}${params.size > 0 ? `?${params}` : ''}`;
    const headers: Record<string, string> = { Accept: init.accept ?? 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;
    if (this.options.client) headers['X-Croquis-Client'] = this.options.client;
    const doFetch = this.options.fetch ?? globalThis.fetch;
    const response = await doFetch(url, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // Session cookies only when there is no key. (Not every runtime implements
      // `credentials` — Workers rejects it — so it is left out entirely with a key.)
      ...(this.options.apiKey ? {} : ({ credentials: 'include' } as Record<string, string>)),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as Problem | null;
      throw new CroquisApiError(
        problem && typeof problem.code === 'string'
          ? problem
          : {
              type: 'about:blank',
              title: response.statusText || 'Request failed',
              status: response.status,
              code: 'http_error',
            },
      );
    }
    if (response.status === 204) return undefined as T;
    if ((init.accept ?? '').startsWith('text/')) return (await response.text()) as T;
    return (await response.json()) as T;
  }

  /** Iterate every item of a paginated endpoint. */
  async *paginate<T>(
    fetchPage: (cursor: string | undefined) => Promise<Paginated<T>>,
  ): AsyncGenerator<T> {
    let cursor: string | undefined;
    do {
      const page = await fetchPage(cursor);
      yield* page.data;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }

  private get = <T>(path: string, query?: Query) => this.request<T>('GET', path, { query });
  private post = <T>(path: string, body: unknown = {}) => this.request<T>('POST', path, { body });
  private patch = <T>(path: string, body: unknown) => this.request<T>('PATCH', path, { body });
  private put = <T>(path: string, body: unknown) => this.request<T>('PUT', path, { body });
  private del = (path: string) => this.request<void>('DELETE', path);

  readonly setup = { status: () => this.get<SetupStatus>('/setup') };

  me = () => this.get<Me>('/me');

  readonly workspaces = {
    list: () => this.get<{ data: Workspace[] }>('/workspaces'),
    get: (id: string) => this.get<Workspace>(`/workspaces/${id}`),
    create: (name: string) => this.post<Workspace>('/workspaces', { name }),
    rename: (id: string, name: string) => this.patch<Workspace>(`/workspaces/${id}`, { name }),
    delete: (id: string) => this.del(`/workspaces/${id}`),
    members: (id: string) => this.get<{ data: Member[] }>(`/workspaces/${id}/members`),
    setRole: (id: string, memberId: string, role: Member['role']) =>
      this.patch<Member>(`/workspaces/${id}/members/${memberId}`, { role }),
    removeMember: (id: string, memberId: string) =>
      this.del(`/workspaces/${id}/members/${memberId}`),
    invitations: (id: string) => this.get<{ data: Invitation[] }>(`/workspaces/${id}/invitations`),
    invite: (id: string, input: CreateInvitationInput) =>
      this.post<CreatedInvitation>(`/workspaces/${id}/invitations`, input),
    revokeInvitation: (id: string, invitationId: string) =>
      this.del(`/workspaces/${id}/invitations/${invitationId}`),
    apiKeys: (id: string) => this.get<{ data: ApiKey[] }>(`/workspaces/${id}/api-keys`),
    createApiKey: (id: string, input: CreateApiKeyInput) =>
      this.post<CreatedApiKey>(`/workspaces/${id}/api-keys`, input),
    revokeApiKey: (id: string, keyId: string) => this.del(`/workspaces/${id}/api-keys/${keyId}`),
  };

  readonly projects = {
    list: (options: ListOptions & { workspace_id?: string } = {}) =>
      this.get<Paginated<ProjectWithStats>>('/projects', options),
    get: (id: string) => this.get<ProjectWithStats>(`/projects/${id}`),
    create: (input: Partial<CreateProjectInput> & { name: string }) =>
      this.post<ProjectWithStats>('/projects', input),
    update: (id: string, input: UpdateProjectInput) =>
      this.patch<ProjectWithStats>(`/projects/${id}`, input),
    delete: (id: string) => this.del(`/projects/${id}`),
    rotateIngestKey: (id: string) =>
      this.post<ProjectWithStats>(`/projects/${id}/ingest-key/rotate`),
    origins: (id: string) => this.get<{ data: ProjectOrigin[] }>(`/projects/${id}/origins`),
    addOrigin: (id: string, input: Partial<CreateOriginInput> & { url: string }) =>
      this.post<ProjectOrigin>(`/projects/${id}/origins`, input),
    removeOrigin: (originId: string) => this.del(`/origins/${originId}`),
    activity: (id: string, options: ListOptions & { subject_id?: string } = {}) =>
      this.get<Paginated<ActivityEvent>>(`/projects/${id}/activity`, options),
    export: (id: string) => this.get<ProjectExport>(`/projects/${id}/export`),
    exportMarkdown: (id: string) =>
      this.request<string>('GET', `/projects/${id}/export`, {
        query: { format: 'markdown' },
        accept: 'text/markdown',
      }),
  };

  readonly shareLinks = {
    list: (projectId: string) =>
      this.get<{ data: ShareLink[] }>(`/projects/${projectId}/share-links`),
    create: (projectId: string, input: Partial<CreateShareLinkInput> = {}) =>
      this.post<ShareLink>(`/projects/${projectId}/share-links`, input),
    update: (id: string, input: UpdateShareLinkInput) =>
      this.patch<ShareLink>(`/share-links/${id}`, input),
    delete: (id: string) => this.del(`/share-links/${id}`),
  };

  readonly labels = {
    list: (projectId: string) => this.get<{ data: Label[] }>(`/projects/${projectId}/labels`),
    create: (projectId: string, input: Partial<CreateLabelInput> & { name: string }) =>
      this.post<Label>(`/projects/${projectId}/labels`, input),
    update: (id: string, input: UpdateLabelInput) => this.patch<Label>(`/labels/${id}`, input),
    delete: (id: string) => this.del(`/labels/${id}`),
  };

  readonly pages = {
    list: (projectId: string) =>
      this.get<{ data: PageWithStats[] }>(`/projects/${projectId}/pages`),
    get: (id: string) => this.get<PageWithStats>(`/pages/${id}`),
    create: (projectId: string, input: Partial<CreatePageInput> & { path: string }) =>
      this.post<PageWithStats>(`/projects/${projectId}/pages`, input),
    update: (id: string, input: UpdatePageInput) =>
      this.patch<PageWithStats>(`/pages/${id}`, input),
    delete: (id: string) => this.del(`/pages/${id}`),
    reorder: (projectId: string, parentId: string | null, pageIds: string[]) =>
      this.post<{ data: PageWithStats[] }>(`/projects/${projectId}/pages/reorder`, {
        parent_id: parentId,
        page_ids: pageIds,
      }),
    approvals: (id: string) => this.get<{ data: PageApproval[] }>(`/pages/${id}/approvals`),
    approve: (
      id: string,
      input: Partial<CreateApprovalInput> & { decision: PageApproval['decision'] },
    ) => this.post<PageApproval>(`/pages/${id}/approvals`, input),
  };

  readonly content = {
    list: (pageId: string) => this.get<{ data: ContentBlock[] }>(`/pages/${pageId}/content-blocks`),
    create: (
      pageId: string,
      input: Partial<CreateContentBlockInput> & { type: ContentBlock['type'] },
    ) => this.post<ContentBlock>(`/pages/${pageId}/content-blocks`, input),
    update: (id: string, input: UpdateContentBlockInput) =>
      this.patch<ContentBlock>(`/content-blocks/${id}`, input),
    delete: (id: string) => this.del(`/content-blocks/${id}`),
  };

  readonly reviewRounds = {
    list: (projectId: string) =>
      this.get<{ data: ReviewRound[] }>(`/projects/${projectId}/review-rounds`),
    open: (projectId: string, input: Partial<CreateReviewRoundInput> & { name: string }) =>
      this.post<ReviewRound>(`/projects/${projectId}/review-rounds`, input),
    update: (id: string, input: Partial<Pick<ReviewRound, 'name' | 'preview_url' | 'status'>>) =>
      this.patch<ReviewRound>(`/review-rounds/${id}`, input),
  };

  readonly comments = {
    list: (projectId: string, filters: CommentFilters = {}) =>
      this.get<Paginated<Comment>>(`/projects/${projectId}/comments`, filters as Query),
    counts: (projectId: string, page?: string) =>
      this.get<CommentCounts>(`/projects/${projectId}/comments/counts`, { page }),
    get: (id: string) => this.get<CommentDetail>(`/comments/${id}`),
    create: (projectId: string, input: Partial<CreateCommentInput> & { body: string }) =>
      this.post<Comment>(`/projects/${projectId}/comments`, input),
    update: (id: string, input: UpdateCommentInput) =>
      this.patch<Comment>(`/comments/${id}`, input),
    fix: (id: string, input: Partial<FixCommentInput>) =>
      this.post<Comment>(`/comments/${id}/fix`, input),
    reply: (id: string, input: Partial<CreateReplyInput> & { body: string }) =>
      this.post<Reply>(`/comments/${id}/replies`, input),
    deleteReply: (replyId: string) => this.del(`/replies/${replyId}`),
    delete: (id: string) => this.del(`/comments/${id}`),
    createIssue: (id: string, provider: 'github' | 'linear') =>
      this.post<ExternalLink>(`/comments/${id}/external-issue`, { provider }),
    translate: (id: string, lang: 'en' | 'ja') =>
      this.post<AiTranslation>(`/comments/${id}/ai/translate`, { lang }),
  };

  readonly ai = {
    draftSitemap: (projectId: string, brief: string) =>
      this.post<{ data: PageWithStats[] }>(`/projects/${projectId}/ai/sitemap`, { brief }),
    draftContent: (pageId: string, brief?: string) =>
      this.post<{ data: ContentBlock[] }>(`/pages/${pageId}/ai/content`, brief ? { brief } : {}),
    digest: (projectId: string) => this.post<AiDigest>(`/projects/${projectId}/ai/digest`),
    triage: (projectId: string, apply = true) =>
      this.post<AiTriage>(`/projects/${projectId}/ai/triage`, { apply }),
    copyCheck: (projectId: string, options: { page_id?: string; create_comments?: boolean } = {}) =>
      this.post<AiTypoCheck>(`/projects/${projectId}/ai/copy-check`, options),
    runs: (projectId: string, options: ListOptions = {}) =>
      this.get<Paginated<AiRun>>(`/projects/${projectId}/ai/runs`, options),
  };

  readonly webhooks = {
    list: (projectId: string) =>
      this.get<{ data: WebhookEndpoint[] }>(`/projects/${projectId}/webhooks`),
    create: (projectId: string, input: Partial<CreateWebhookInput> & { url: string }) =>
      this.post<CreatedWebhook>(`/projects/${projectId}/webhooks`, input),
    update: (id: string, input: UpdateWebhookInput) =>
      this.patch<WebhookEndpoint>(`/webhooks/${id}`, input),
    delete: (id: string) => this.del(`/webhooks/${id}`),
    deliveries: (id: string, options: ListOptions = {}) =>
      this.get<Paginated<WebhookDelivery>>(`/webhooks/${id}/deliveries`, options),
    test: (id: string) =>
      this.post<{ ok: boolean; status: number | null; error: string | null }>(
        `/webhooks/${id}/test`,
      ),
    retry: (deliveryId: string) =>
      this.post<{ ok: true }>(`/webhook-deliveries/${deliveryId}/retry`),
  };

  readonly integrations = {
    list: (projectId: string) =>
      this.get<{ data: Integration[] }>(`/projects/${projectId}/integrations`),
    upsert: (projectId: string, input: UpsertIntegrationInput) =>
      this.put<Integration>(`/projects/${projectId}/integrations/${input.provider}`, input),
    remove: (projectId: string, provider: Integration['provider']) =>
      this.del(`/projects/${projectId}/integrations/${provider}`),
  };
}

export type * from '@croquis/shared';
