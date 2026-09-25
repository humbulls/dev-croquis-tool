import type { CroquisClient } from '@croquis/client';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callTool, INSTRUCTIONS, prompts, SERVER_INFO, tools } from './tools';

export { callTool, SERVER_INFO } from './tools';

export function createServer(client: CroquisClient): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const definition of tools) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.input,
        annotations: definition.annotations,
      },
      (args: unknown) => callTool(client, definition.name, args),
    );
  }
  for (const prompt of prompts) {
    const argsSchema = Object.fromEntries(
      prompt.args.map((a) => [
        a.name,
        a.required
          ? z.string().describe(a.description)
          : z.string().optional().describe(a.description),
      ]),
    );
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema },
      (args) => ({
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: prompt.render(args as Record<string, string>) },
          },
        ],
      }),
    );
  }
  return server;
}
