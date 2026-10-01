import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createHub } from './hub.mjs';
import { FileLedger } from './ledger.mjs';
import { NangoCrmAdapter } from './nango.mjs';
import { HubError } from './errors.mjs';

try {
  if (process.argv.slice(2).some(x => x !== '--live') || process.argv.length > 3) throw new HubError('INVALID_ARGUMENTS');
  const live = process.argv.includes('--live');
  const adapter = live ? new NangoCrmAdapter({ secretKey: process.env.NANGO_SECRET_KEY })
    : { async listDeals() { return JSON.parse(await readFile(new URL('../fixtures/deals.json', import.meta.url), 'utf8')); } };
  const hub = createHub({ bindings: { 'camaleao-demo': { connectionId: process.env.NANGO_CONNECTION_ID,
    providerConfigKey: process.env.NANGO_PROVIDER_CONFIG_KEY } }, adapter,
    ledger: new FileLedger(new URL('../.state/', import.meta.url).pathname) });
  // CLI de operador. Uma futura API DEVE obter o tenant da identidade autenticada.
  const result = await hub.execute({ tenantId: 'camaleao-demo', action: 'crm.deals.preview', requestId: randomUUID() }, 'camaleao-demo');
  console.log(JSON.stringify({ mode: live ? 'live' : 'mock', ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof HubError ? error.code : 'LOCAL_FAILURE' }));
  process.exitCode = 1;
}
