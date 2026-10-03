import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/hub.mjs';
import { HubError } from '../src/errors.mjs';
import { FileLedger } from '../src/ledger.mjs';
import { createReadOnlyServer, listenLocal } from '../src/service.mjs';
import { createRadarTool, registerRadarTool } from '../plugins/openclaw-radar/tool.mjs';

const token = randomBytes(32).toString('base64url');
const aggregate = { tenantId: 'internal', action: 'crm.deals.preview', sampleCount: 1,
  stages: { qualified: 1 }, hasMore: false, scope: 'sample-only' };
const defaultEndpoint = 'http://127.0.0.1:8787/v1/crm/deals/preview';
async function withServer(callback, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'radar-openclaw-test-'));
  const events = []; let calls = 0;
  const hub = createHub({ ledger: new FileLedger(directory, { maxAttempts: options.quota ?? 10 }),
    bindings: { internal: { connectionId: 'operator-owned-binding' } },
    adapter: { async listDeals(binding) {
      calls++; assert.equal(binding.connectionId, 'operator-owned-binding');
      if (options.error) throw options.error;
      return { results: [{ id: 'sensitive-id', properties: { name: 'private-name', dealstage: 'qualified' } }] };
    } } });
  const server = createReadOnlyServer({ hub, tenantId: 'internal', token, audit: event => events.push(event) });
  try {
    const address = await listenLocal(server, 0); assert.equal(address.address, '127.0.0.1');
    const endpoint = `http://127.0.0.1:${address.port}/v1/crm/deals/preview`;
    const send = (body = { requestId: 'first' }, extra = {}) => fetch(endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), ...extra });
    await callback({ endpoint, send, events, calls: () => calls });
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}
test('HTTP real deriva identidade do servidor, agrega e audita sem segredos', () => withServer(async ({ send, events, calls }) => {
  const response = await send(); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), aggregate); assert.equal(calls(), 1);
  for (const forbidden of [token, 'private-name', 'sensitive-id', 'operator-owned-binding']) assert.ok(!JSON.stringify(events).includes(forbidden));
  assert.equal(events[0].outcome, 'SUCCESS');
  assert.equal(events[0].requestIdHash, createHash('sha256').update('first').digest('hex'));
  assert.equal(events[0].requestId, undefined);
}));
for (const authorization of [undefined, 'Bearer invalid', `Bearer ${token}wrong`]) {
  test('HTTP recusa credencial ausente ou incorreta antes do provedor', () => withServer(async ({ send, calls }) => {
    const headers = { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) };
    assert.equal((await send(undefined, { headers })).status, 401); assert.equal(calls(), 0);
  }));
}
for (const body of [
  { requestId: 'id', tenantId: 'other' }, { requestId: 'id', authenticatedTenantId: 'other' },
  { requestId: 'id', action: 'crm.deals.create' }, { requestId: 'id', connectionId: 'other' },
  { requestId: 'id', url: 'http://private' }, { requestId: '../bad' }, {}, null, []
]) test('HTTP recusa autoridade no payload e entrada malformada', () => withServer(async ({ send, calls }) => {
  assert.equal((await send(body)).status, 400); assert.equal(calls(), 0);
}));
test('HTTP recusa JSON quebrado e conteúdo excessivo', () => withServer(async ({ send, calls }) => {
  assert.equal((await send(undefined, { body: '{' })).status, 400);
  assert.equal((await send(undefined, { body: 'x'.repeat(2049) })).status, 413); assert.equal(calls(), 0);
}));
test('HTTP recusa outro método, tipo e caminho', () => withServer(async ({ send, endpoint, calls }) => {
  assert.equal((await send(undefined, { method: 'PUT' })).status, 405);
  assert.equal((await send(undefined, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await fetch(endpoint + '?url=elsewhere', { headers: { Authorization: `Bearer ${token}` } })).status, 404);
  assert.equal(calls(), 0);
}));
test('HTTP bloqueia replay e cota no domínio', () => withServer(async ({ send, calls }) => {
  assert.equal((await send()).status, 200); assert.equal((await send()).status, 409);
  assert.equal((await send({ requestId: 'second' })).status, 429); assert.equal(calls(), 1);
}, { quota: 1 }));
for (const error of [new Error('secret-provider-token'), new HubError('secret-provider-token')]) {
  test('HTTP sanitiza erro desconhecido e auditoria', () => withServer(async ({ send, events }) => {
    const response = await send(); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'SERVICE_UNAVAILABLE' });
    assert.ok(!JSON.stringify(events).includes('secret-provider-token'));
  }, { error }));
}
test('tool -> HTTP real -> Hub; replay não chama o provedor duas vezes', () => withServer(async ({ endpoint, calls }) => {
  const tool = createRadarTool({ endpoint, token }); const result = await tool.execute('same-call', {});
  assert.deepEqual(result.details, { scope: 'sample-only', sampleCount: 1, stages: { qualified: 1 }, hasMore: false });
  assert.ok(!JSON.stringify(result).includes('internal'));
  await assert.rejects(tool.execute('same-call', {}), { message: 'HUB_REQUEST_FAILED' }); assert.equal(calls(), 1);
}));
test('registro opcional não expõe token no schema', () => {
  let captured;
  registerRadarTool({ registerTool(tool, policy) { captured = { tool, policy }; } }, { RADAR_SERVICE_TOKEN: token });
  assert.equal(captured.tool.name, 'radar_crm_preview'); assert.deepEqual(captured.policy, { optional: true });
  assert.ok(!JSON.stringify(captured).includes(token));
});
test('tool recusa autoridade do modelo antes da rede', async () => {
  let calls = 0;
  const tool = createRadarTool({ endpoint: defaultEndpoint, token, fetchImpl: async () => { calls++; } });
  for (const params of [{ tenantId: 'other' }, { url: 'http://evil' }, { action: 'send' }, null, []]) {
    await assert.rejects(tool.execute('id', params), { message: 'INVALID_TOOL_ARGUMENTS' });
  }
  assert.equal(calls, 0);
});
test('tool recusa destinos externos, userinfo, query e path', () => {
  for (const endpoint of ['http://localhost:8787/v1/crm/deals/preview', 'https://example.com/v1/crm/deals/preview',
    'http://127.0.0.1:8787/other', 'http://user@127.0.0.1:8787/v1/crm/deals/preview',
    'http://127.0.0.1:8787/v1/crm/deals/preview?q=1', 'not a url']) {
    assert.throws(() => createRadarTool({ endpoint, token }), { message: 'INVALID_HUB_ENDPOINT' });
  }
});
test('tool fixa contrato sem retry e filtra campos inesperados', async () => {
  let calls = 0;
  const tool = createRadarTool({ endpoint: defaultEndpoint, token, fetchImpl: async (url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal); assert.deepEqual(Object.keys(JSON.parse(options.body)), ['requestId']);
    return Response.json({ ...aggregate, secret: 'provider-secret' });
  } });
  assert.ok(!JSON.stringify(await tool.execute('id', {})).includes('provider-secret')); assert.equal(calls, 1);
});
for (const fetchImpl of [
  async () => new Response('provider-secret', { status: 302 }),
  async () => Response.json({ ...aggregate, sampleCount: 10 }),
  async () => Response.json({ ...aggregate, stages: { '<script>': 1 } }),
  async () => Response.json({ ...aggregate, extra: 'x'.repeat(16384) }),
  async () => { throw new Error('private-token'); }
]) test('tool sanitiza falhas e violações do contrato', async () => {
  const tool = createRadarTool({ endpoint: defaultEndpoint, token, fetchImpl });
  await assert.rejects(tool.execute('id', {}), { message: 'HUB_REQUEST_FAILED' });
});
test('token ausente ou fraco falha fechado', () => {
  assert.throws(() => createReadOnlyServer({ hub: {}, tenantId: 'internal', token: '' }), { code: 'INVALID_SERVICE_TOKEN' });
  assert.throws(() => createRadarTool({ endpoint: defaultEndpoint, token: 'weak' }), { message: 'INVALID_SERVICE_TOKEN' });
});
