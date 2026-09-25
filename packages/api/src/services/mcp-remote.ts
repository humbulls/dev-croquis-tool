import { CroquisClient } from '@croquis/client';
import { callTool, INSTRUCTIONS, prompts, SERVER_INFO, tools } from '@croquis/mcp/tools';
import type { Context } from 'hono';
import { z } from 'zod';
import { runtimeConfig } from '../config';
import type { AppEnv } from '../env';
import { trustedOrigin } from '../security/principal';

/**
 * Remote MCP endpoint (Streamable HTTP transport, stateless, JSON responses).
 * Every instance serves the same tools as `npx @croquis/mcp` at `/mcp`,
 * authenticated with an API key: `Authorization: Bearer crq_…`. Tool calls are
 * executed as ordinary API requests dispatched inside the Worker.
 */

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

const toolList = () =>
  tools.map((t) => {
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(z.object(t.input), {
      io: 'input',
    }) as Record<string, unknown>;
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema,
      annotations: t.annotations,
    };
  });

async function dispatch(
  client: CroquisClient,
  message: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, text: string): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    error: { code, message: text },
  });
  // Notifications (no id) never get a response.
  if (message.id === undefined) return null;

  switch (message.method) {
    case 'initialize': {
      const requested = String(message.params?.protocolVersion ?? '');
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: toolList() });
    case 'tools/call':
      return ok(
        await callTool(client, String(message.params?.name ?? ''), message.params?.arguments ?? {}),
      );
    case 'prompts/list':
      return ok({
        prompts: prompts.map((p) => ({
          name: p.name,
          title: p.title,
          description: p.description,
          arguments: p.args,
        })),
      });
    case 'prompts/get': {
      const prompt = prompts.find((p) => p.name === message.params?.name);
      if (!prompt) return fail(-32602, 'Unknown prompt');
      const args = (message.params?.arguments ?? {}) as Record<string, string>;
      const missing = prompt.args.filter((a) => a.required && !args[a.name]).map((a) => a.name);
      if (missing.length) return fail(-32602, `Missing arguments: ${missing.join(', ')}`);
      return ok({
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.render(args) } }],
      });
    }
    default:
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

export async function handleMcp(
  c: Context<AppEnv>,
  internalFetch: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (c.req.method !== 'POST') {
    return new Response('This MCP endpoint only accepts POST (stateless Streamable HTTP).', {
      status: 405,
      headers: { Allow: 'POST' },
    });
  }
  const origin = c.req.header('Origin');
  const own = runtimeConfig(c.env).publicUrl ?? new URL(c.req.url).origin;
  // DNS-rebinding protection: browsers must come from this instance or a trusted origin.
  if (
    origin &&
    origin !== own &&
    origin !== new URL(c.req.url).origin &&
    !trustedOrigin(c.env, origin)
  ) {
    return c.json({ error: 'origin not allowed' }, 403);
  }
  const auth = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '');
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Send an API key: Authorization: Bearer crq_…' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="croquis"' },
    });
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      400,
    );
  }
  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcRequest[];
  if (messages.some((m) => m?.jsonrpc !== '2.0' || typeof m.method !== 'string')) {
    return c.json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } },
      400,
    );
  }

  const base = new URL(c.req.url).origin;
  const client = new CroquisClient({
    baseUrl: base,
    apiKey: auth[1],
    client: `mcp-remote/${SERVER_INFO.version}`,
    fetch: (input, init) => internalFetch(new Request(input, init)),
  });

  // Reject a bad key at initialize time so the MCP client can tell the user.
  if (messages.some((m) => m.method === 'initialize')) {
    const probe = await internalFetch(
      new Request(`${base}/api/v1/workspaces`, { headers: { Authorization: `Bearer ${auth[1]}` } }),
    );
    if (probe.status === 401) {
      return new Response(JSON.stringify({ error: 'The API key is invalid, expired or revoked' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="croquis", error="invalid_token"',
        },
      });
    }
  }

  const responses = (await Promise.all(messages.map((m) => dispatch(client, m)))).filter(
    (r): r is JsonRpcResponse => r !== null,
  );
  if (responses.length === 0) return new Response(null, { status: 202 });
  return c.json(Array.isArray(body) ? responses : responses[0]);
}
