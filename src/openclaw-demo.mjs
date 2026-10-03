// Copyright (c) 2026 Carlos Felipe. MIT. No OpenClaw host or external API is started.
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from './hub.mjs';
import { FileLedger } from './ledger.mjs';
import { createReadOnlyServer, listenLocal } from './service.mjs';
import { createRadarTool } from '../plugins/openclaw-radar/tool.mjs';

const directory = await mkdtemp(join(tmpdir(), 'radar-demo-'));
const token = randomBytes(32).toString('base64url');
const fixture = JSON.parse(await readFile(new URL('../fixtures/deals.json', import.meta.url), 'utf8'));
const hub = createHub({ bindings: { 'camaleao-demo': {} }, ledger: new FileLedger(directory),
  adapter: { async listDeals() { return fixture; } } });
const server = createReadOnlyServer({ hub, token, tenantId: 'camaleao-demo' });
try {
  const address = await listenLocal(server, 0);
  const tool = createRadarTool({ endpoint: `http://127.0.0.1:${address.port}/v1/crm/deals/preview`, token });
  const result = await tool.execute('synthetic-demo-one', {});
  process.stdout.write(JSON.stringify({ mode: 'synthetic', transport: 'real-local-http', ...result.details }, null, 2) + '\n');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
