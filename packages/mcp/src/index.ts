import {
  COMMENT_STATUSES,
  CONTENT_BLOCK_TYPES,
  formatExportMarkdown,
  PAGE_STATUSES,
} from '@croquis/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CroquisClient } from './client';

const baseUrl = process.env.CROQUIS_API_URL;
const token = process.env.CROQUIS_TOKEN;

if (!baseUrl || !token) {
  process.stderr.write(
    'croquis-mcp: set CROQUIS_API_URL and CROQUIS_TOKEN environment variables.\n',
  );
  process.exit(1);
}

const client = new CroquisClient({ baseUrl, token });

const server = new McpServer({ name: 'croquis', version: '0.1.0' });

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function textResult(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Wrap a handler so API errors become MCP tool errors rather than crashes. */
function tool<A>(handler: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      return textResult(await handler(args));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  };
}

server.registerTool(
  'croquis_list_projects',
  {
    title: 'List projects',
    description: 'List all Croquis projects (requires an admin token).',
    inputSchema: {},
  },
  tool(async () => client.listProjects()),
);

server.registerTool(
  'croquis_get_project',
  {
    title: 'Get project',
    description: 'Get a single project by id.',
    inputSchema: { projectId: z.string().describe('Project id') },
  },
  tool(({ projectId }) => client.getProject(projectId)),
);

server.registerTool(
  'croquis_create_project',
  {
    title: 'Create project',
    description: 'Create a new project (requires an admin token). Returns the API token once.',
    inputSchema: {
      name: z.string(),
      share_password: z
        .string()
        .optional()
        .describe('Optional password for the public review link'),
    },
  },
  tool((args) => client.createProject(args)),
);

server.registerTool(
  'croquis_list_pages',
  {
    title: 'List pages',
    description: 'List the sitemap pages of a project (hierarchy via parent_id).',
    inputSchema: { projectId: z.string() },
  },
  tool(({ projectId }) => client.listPages(projectId)),
);

server.registerTool(
  'croquis_create_page',
  {
    title: 'Create page',
    description: 'Add a page (sitemap node / content row / review target) to a project.',
    inputSchema: {
      projectId: z.string(),
      path: z.string().describe('URL path, e.g. /about'),
      title: z.string().optional(),
      purpose: z.string().optional(),
      audience: z.string().optional(),
      status: z.enum(PAGE_STATUSES).optional(),
      parent_id: z.string().nullable().optional(),
    },
  },
  tool(({ projectId, ...input }) => client.createPage(projectId, input)),
);

server.registerTool(
  'croquis_update_page',
  {
    title: 'Update page',
    description: 'Update page fields (title, purpose, audience, status, parent_id, path).',
    inputSchema: {
      projectId: z.string(),
      pageId: z.string(),
      path: z.string().optional(),
      title: z.string().optional(),
      purpose: z.string().optional(),
      audience: z.string().optional(),
      status: z.enum(PAGE_STATUSES).optional(),
      parent_id: z.string().nullable().optional(),
    },
  },
  tool(({ projectId, pageId, ...input }) => client.updatePage(projectId, pageId, input)),
);

server.registerTool(
  'croquis_list_content_blocks',
  {
    title: 'List content blocks',
    description: 'List the draft content blocks of a page.',
    inputSchema: { projectId: z.string(), pageId: z.string() },
  },
  tool(({ projectId, pageId }) => client.listContentBlocks(projectId, pageId)),
);

server.registerTool(
  'croquis_create_content_block',
  {
    title: 'Create content block',
    description: 'Add a content block (heading/body/image/cta) to a page.',
    inputSchema: {
      projectId: z.string(),
      pageId: z.string(),
      type: z.enum(CONTENT_BLOCK_TYPES),
      content: z.string().optional(),
      position: z.number().int().optional(),
      ai_generated: z.boolean().optional(),
    },
  },
  tool(({ projectId, pageId, ...input }) => client.createContentBlock(projectId, pageId, input)),
);

server.registerTool(
  'croquis_list_comments',
  {
    title: 'List comments',
    description: 'List review comments in a project, optionally filtered by status or page.',
    inputSchema: {
      projectId: z.string(),
      status: z.enum(COMMENT_STATUSES).optional(),
      page_id: z.string().optional(),
    },
  },
  tool(({ projectId, status, page_id }) => client.listComments(projectId, { status, page_id })),
);

server.registerTool(
  'croquis_get_comment',
  {
    title: 'Get comment',
    description: 'Get a single review comment with its replies.',
    inputSchema: { projectId: z.string(), commentId: z.string() },
  },
  tool(({ projectId, commentId }) => client.getComment(projectId, commentId)),
);

server.registerTool(
  'croquis_resolve_comment',
  {
    title: 'Resolve comment',
    description: 'Mark a review comment as resolved.',
    inputSchema: { projectId: z.string(), commentId: z.string() },
  },
  tool(({ projectId, commentId }) =>
    client.updateComment(projectId, commentId, { status: 'resolved' }),
  ),
);

server.registerTool(
  'croquis_reply_comment',
  {
    title: 'Reply to comment',
    description: 'Add a reply to a review comment.',
    inputSchema: {
      projectId: z.string(),
      commentId: z.string(),
      body: z.string(),
      author_name: z.string().optional(),
    },
  },
  tool(({ projectId, commentId, body, author_name }) =>
    client.replyComment(projectId, commentId, { body, author_name }),
  ),
);

server.registerTool(
  'croquis_export_project',
  {
    title: 'Export project (JSON)',
    description: 'Export the full project (pages, content, comments) as structured JSON.',
    inputSchema: { projectId: z.string() },
  },
  tool(({ projectId }) => client.exportProject(projectId)),
);

server.registerTool(
  'croquis_export_project_markdown',
  {
    title: 'Export project (Markdown)',
    description:
      'Export the project as Markdown — ready to hand to an AI agent for acting on feedback.',
    inputSchema: { projectId: z.string() },
  },
  tool(async ({ projectId }) => formatExportMarkdown(await client.exportProject(projectId))),
);

server.registerTool(
  'croquis_generate_sitemap',
  {
    title: 'Generate sitemap (AI)',
    description:
      'Generate a sitemap draft from a brief and insert the pages (requires an AI provider configured on the API).',
    inputSchema: {
      projectId: z.string(),
      brief: z.string().describe('What the website is about, goals, audience'),
    },
  },
  tool(({ projectId, brief }) => client.generateSitemap(projectId, brief)),
);

server.registerTool(
  'croquis_generate_content',
  {
    title: 'Generate page content (AI)',
    description: 'Draft content blocks for a page (marked ai_generated).',
    inputSchema: {
      projectId: z.string(),
      pageId: z.string(),
      brief: z.string().optional(),
    },
  },
  tool(({ projectId, pageId, brief }) => client.generateContent(projectId, pageId, brief)),
);

server.registerTool(
  'croquis_digest_comments',
  {
    title: 'Digest open comments (AI)',
    description: 'Summarize open review comments into a prioritized Markdown action digest.',
    inputSchema: { projectId: z.string() },
  },
  tool(({ projectId }) => client.digestComments(projectId)),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('croquis-mcp: ready (stdio)\n');
}

main().catch((error) => {
  process.stderr.write(`croquis-mcp: fatal ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
