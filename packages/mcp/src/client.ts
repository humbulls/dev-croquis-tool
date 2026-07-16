import type {
  Comment,
  CommentWithReplies,
  ContentBlock,
  CreatedProject,
  OwnerProject,
  Page,
  ProjectExport,
} from '@croquis/shared';

export interface CroquisClientOptions {
  baseUrl: string;
  token: string;
}

/** Thin typed HTTP client for the Croquis API. */
export class CroquisClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: CroquisClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null; // non-JSON body (e.g. platform error page)
      }
    }
    if (!res.ok) {
      const message =
        (data && typeof data === 'object' && 'error' in data && (data as { error: unknown }).error) ||
        text.slice(0, 200);
      throw new Error(`Croquis API ${res.status}: ${message}`);
    }
    return data as T;
  }

  listProjects(): Promise<{ projects: OwnerProject[] }> {
    return this.request('GET', '/projects');
  }

  getProject(projectId: string): Promise<OwnerProject> {
    return this.request('GET', `/projects/${projectId}`);
  }

  createProject(input: { name: string; share_password?: string }): Promise<CreatedProject> {
    return this.request('POST', '/projects', input);
  }

  listPages(projectId: string): Promise<{ pages: Page[] }> {
    return this.request('GET', `/projects/${projectId}/pages`);
  }

  createPage(projectId: string, input: Record<string, unknown>): Promise<Page> {
    return this.request('POST', `/projects/${projectId}/pages`, input);
  }

  updatePage(projectId: string, pageId: string, input: Record<string, unknown>): Promise<Page> {
    return this.request('PATCH', `/projects/${projectId}/pages/${pageId}`, input);
  }

  listContentBlocks(projectId: string, pageId: string): Promise<{ content_blocks: ContentBlock[] }> {
    return this.request('GET', `/projects/${projectId}/pages/${pageId}/content-blocks`);
  }

  createContentBlock(
    projectId: string,
    pageId: string,
    input: Record<string, unknown>,
  ): Promise<ContentBlock> {
    return this.request('POST', `/projects/${projectId}/pages/${pageId}/content-blocks`, input);
  }

  listComments(
    projectId: string,
    query: { status?: string; page_id?: string } = {},
  ): Promise<{ comments: Comment[] }> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.page_id) params.set('page_id', query.page_id);
    const qs = params.toString();
    return this.request('GET', `/projects/${projectId}/comments${qs ? `?${qs}` : ''}`);
  }

  getComment(projectId: string, commentId: string): Promise<CommentWithReplies> {
    return this.request('GET', `/projects/${projectId}/comments/${commentId}`);
  }

  updateComment(
    projectId: string,
    commentId: string,
    input: Record<string, unknown>,
  ): Promise<CommentWithReplies> {
    return this.request('PATCH', `/projects/${projectId}/comments/${commentId}`, input);
  }

  replyComment(
    projectId: string,
    commentId: string,
    input: { body: string; author_name?: string | null },
  ): Promise<unknown> {
    return this.request('POST', `/projects/${projectId}/comments/${commentId}/replies`, input);
  }

  exportProject(projectId: string): Promise<ProjectExport> {
    return this.request('GET', `/projects/${projectId}/export`);
  }

  // AI generation
  generateSitemap(projectId: string, brief: string): Promise<{ created: Page[]; skipped_existing: number }> {
    return this.request('POST', `/projects/${projectId}/ai/sitemap`, { brief });
  }
  generateContent(
    projectId: string,
    pageId: string,
    brief?: string,
  ): Promise<{ created: ContentBlock[] }> {
    return this.request('POST', `/projects/${projectId}/ai/content`, {
      page_id: pageId,
      ...(brief ? { brief } : {}),
    });
  }
  digestComments(projectId: string): Promise<{ digest: string; open_count: number }> {
    return this.request('GET', `/projects/${projectId}/ai/digest`);
  }
}
