import { beforeAll, describe, expect, it } from 'vitest';
import { api, call, createApiKey, createProject, json, type Session, setupOwner } from './helpers';

let owner: Session;
let token: string;

beforeAll(async () => {
  owner = await setupOwner();
  token = await createApiKey(owner, { name: 'Remote agent' });
});

function rpc(body: unknown, key: string | null = token) {
  return call('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('remote MCP endpoint', () => {
  it('initializes with a valid key and rejects missing or bad keys', async () => {
    const init = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    });
    expect(init.status).toBe(200);
    expect(await json(init)).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'croquis' },
        capabilities: { tools: {} },
      },
    });
    const none = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, null);
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toContain('Bearer');
    const bad = await rpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      'crq_invalid',
    );
    expect(bad.status).toBe(401);
  });

  it('acknowledges notifications with 202', async () => {
    const response = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(response.status).toBe(202);
  });

  it('lists tools with JSON Schema inputs', async () => {
    const response = await json(await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const fix = response.result.tools.find(
      (t: { name: string }) => t.name === 'croquis_report_fix',
    );
    expect(fix.inputSchema).toMatchObject({ type: 'object', required: ['comment_id'] });
    expect(fix.inputSchema).not.toHaveProperty('$schema');
    expect(response.result.tools.length).toBeGreaterThanOrEqual(25);
  });

  it('runs tools through the API with the caller’s key', async () => {
    const project = await createProject(owner, { name: 'Remote MCP site' });
    await api.post(`/projects/${project.id}/comments`, { body: 'Hero text is cut off' }, owner);
    const response = await json(
      await rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'croquis_list_feedback', arguments: { project_id: project.id } },
      }),
    );
    expect(response.result.isError).toBeUndefined();
    expect(response.result.content[0].text).toContain('Hero text is cut off');
    expect(response.result.content[0].text).toContain('untrusted-feedback');

    const created = await json(
      await rpc({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'croquis_create_feedback',
          arguments: { project_id: project.id, body: 'Filed by the agent' },
        },
      }),
    );
    expect(created.result.content[0].text).toMatch(/Created comment #2/);
    const list = await json(await api.get(`/projects/${project.id}/comments`, owner));
    expect(list.data[0]).toMatchObject({
      source: 'mcp',
      author: { type: 'agent', name: 'Remote agent' },
    });
  });

  it('serves prompts and answers unknown methods with JSON-RPC errors', async () => {
    const prompt = await json(
      await rpc({
        jsonrpc: '2.0',
        id: 5,
        method: 'prompts/get',
        params: { name: 'fix-open-feedback', arguments: { project_id: 'p1' } },
      }),
    );
    expect(prompt.result.messages[0].content.text).toContain('croquis_report_fix');
    const unknown = await json(await rpc({ jsonrpc: '2.0', id: 6, method: 'resources/list' }));
    expect(unknown.error.code).toBe(-32601);
  });

  it('refuses GET and foreign browser origins', async () => {
    expect((await call('/mcp')).status).toBe(405);
    const foreign = await call('/mcp', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(foreign.status).toBe(403);
  });
});
