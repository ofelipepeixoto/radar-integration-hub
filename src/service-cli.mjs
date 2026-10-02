// Copyright (c) 2026 Carlos Felipe. MIT.
import { readFile } from 'node:fs/promises';
import { createHub } from './hub.mjs';
import { FileLedger } from './ledger.mjs';
import { NangoCrmAdapter } from './nango.mjs';
import { createReadOnlyServer, listenLocal } from './service.mjs';

try {
  const live = process.argv.includes('--live');
  const tenantId = process.env.RADAR_TENANT_ID ?? 'camaleao-demo';
  const adapter = live ? new NangoCrmAdapter({ secretKey: process.env.NANGO_SECRET_KEY }) : {
    async listDeals() { return JSON.parse(await readFile(new URL('../fixtures/deals.json', import.meta.url), 'utf8')); }
  };
  const hub = createHub({ ledger: new FileLedger('.state'), adapter, bindings: { [tenantId]: {
    connectionId: process.env.NANGO_CONNECTION_ID, providerConfigKey: process.env.NANGO_PROVIDER_CONFIG_KEY
  } } });
  const server = createReadOnlyServer({ hub, tenantId, token: process.env.RADAR_SERVICE_TOKEN,
    audit: event => process.stdout.write(`${JSON.stringify(event)}\n`) });
  await listenLocal(server);
  process.stdout.write(JSON.stringify({ status: 'listening', address: '127.0.0.1', port: 8787,
    mode: live ? 'live-test' : 'synthetic' }) + '\n');
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => server.close());
} catch {
  process.stderr.write('SERVICE_START_FAILED: confira configuração local e porta.\n');
  process.exitCode = 1;
}
