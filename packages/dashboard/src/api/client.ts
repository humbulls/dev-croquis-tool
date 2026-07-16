import type {
  Comment,
  CommentReply,
  CommentWithReplies,
  ContentBlock,
  CreatedProject,
  OwnerProject,
  Page,
  ProjectExport,
} from '@croquis/shared';

/** Browser API client for the Croquis dashboard (uses the admin token). */
export class DashboardClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
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
        (data && typeof data === 'object' && 'error' in data && (data as { error: string }).error) ||
        (text ? text.slice(0, 200) : `HTTP ${res.status}`);
      throw new Error(String(message));
    }
    return data as T;
  }

  // Projects
  listProjects(): Promise<{ projects: OwnerProject[] }> {
    return this.request('GET', '/projects');
  }
  createProject(input: { name: string; share_password?: string }): Promise<CreatedProject> {
    return this.request('POST', '/projects', input);
  }
  getProject(id: string): Promise<OwnerProject> {
    return this.request('GET', `/projects/${id}`);
  }
  deleteProject(id: string): Promise<{ ok: true }> {
    return this.request('DELETE', `/projects/${id}`);
  }
  exportProject(id: string): Promise<ProjectExport> {
    return this.request('GET', `/projects/${id}/export`);
  }

  // Pages
  listPages(projectId: string): Promise<{ pages: Page[] }> {
    return this.request('GET', `/projects/${projectId}/pages`);
  }
  createPage(projectId: string, input: Record<string, unknown>): Promise<Page> {
    return this.request('POST', `/projects/${projectId}/pages`, input);
  }
  updatePage(projectId: string, pageId: string, input: Record<string, unknown>): Promise<Page> {
    return this.request('PATCH', `/projects/${projectId}/pages/${pageId}`, input);
  }
  deletePage(projectId: string, pageId: string): Promise<{ ok: true }> {
    return this.request('DELETE', `/projects/${projectId}/pages/${pageId}`);
  }

  // Content blocks
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
  updateContentBlock(
    projectId: string,
    pageId: string,
    blockId: string,
    input: Record<string, unknown>,
  ): Promise<ContentBlock> {
    return this.request(
      'PATCH',
      `/projects/${projectId}/pages/${pageId}/content-blocks/${blockId}`,
      input,
    );
  }
  deleteContentBlock(projectId: string, pageId: string, blockId: string): Promise<{ ok: true }> {
    return this.request(
      'DELETE',
      `/projects/${projectId}/pages/${pageId}/content-blocks/${blockId}`,
    );
  }

  // Comments
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
  ): Promise<CommentReply> {
    return this.request('POST', `/projects/${projectId}/comments/${commentId}/replies`, input);
  }

  screenshotUrl(projectId: string, commentId: string): string {
    return `${this.baseUrl}/projects/${projectId}/comments/${commentId}/screenshot`;
  }

  /** Fetch a screenshot (with auth) and return an object URL for an <img>. */
  async fetchScreenshotObjectUrl(projectId: string, commentId: string): Promise<string> {
    const res = await fetch(this.screenshotUrl(projectId, commentId), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`screenshot ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }
}
