import { CroquisClient } from '@croquis/client';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, SERVER_INFO } from './server';

// CROQUIS_API_URL / CROQUIS_TOKEN are the v0 names, still accepted.
const baseUrl = process.env.CROQUIS_URL ?? process.env.CROQUIS_API_URL;
const apiKey = process.env.CROQUIS_API_KEY ?? process.env.CROQUIS_TOKEN;

if (!baseUrl || !apiKey) {
  process.stderr.write(
    [
      'croquis-mcp: set CROQUIS_URL (your Croquis instance, e.g. https://croquis.example.com)',
      'and CROQUIS_API_KEY (create one under Workspace settings → API keys).',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const client = new CroquisClient({ baseUrl, apiKey, client: `mcp/${SERVER_INFO.version}` });
await createServer(client).connect(new StdioServerTransport());
