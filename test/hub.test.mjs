import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../src/hub.mjs';
import { FileLedger } from '../src/ledger.mjs';
import { NangoCrmAdapter } from '../src/nango.mjs';

const request = { tenantId: 'camaleao-demo', action: 'crm.deals.preview', requestId: 'one' };
const fixture = { results: [{ properties: { dealstage: 'qualified' } }, { properties: { dealstage: 'qualified' } }] };
function setup(data = fixture) {
  let calls = 0, reserves = 0;
  const hub = createHub({ bindings: { 'camaleao-demo': { connectionId: 'bound', providerConfigKey: 'crm' } },
    adapter: { async listDeals(binding) { calls++; assert.equal(binding.connectionId, 'bound'); return data; } },
    ledger: { async reserve() { reserves++; } } });
  return { hub, counts: () => ({ calls, reserves }) };
}
test('retorna apenas contagem amostral; omite nomes, ids e tokens', async () => {
  const { hub } = setup({ ...fixture, token: 'secret', paging: { next: { after: 'x' } } });
  assert.deepEqual(await hub.execute(request, 'camaleao-demo'), {
    tenantId: 'camaleao-demo', action: 'crm.deals.preview', sampleCount: 2,
    stages: { qualified: 2 }, hasMore: true, scope: 'sample-only'
  });
});
for (const [label, input, identity, code] of [
  ['tenant diferente', request, 'other-tenant', 'TENANT_DENIED'],
  ['identidade ausente', request, undefined, 'TENANT_DENIED'],
  ['escrita', { ...request, action: 'crm.deals.create' }, 'camaleao-demo', 'ACTION_DENIED'],
  ['url arbitrária', { ...request, url: 'https://example.com' }, 'camaleao-demo', 'INVALID_REQUEST'],
  ['connection id arbitrário', { ...request, connectionId: 'other' }, 'camaleao-demo', 'INVALID_REQUEST'],
  ['headers arbitrários', { ...request, headers: {} }, 'camaleao-demo', 'INVALID_REQUEST'],
  ['request id inválido', { ...request, requestId: '../secret' }, 'camaleao-demo', 'INVALID_REQUEST'],
  ['tenant malformado', { ...request, tenantId: '__proto__' }, '__proto__', 'INVALID_REQUEST'],
  ['tenant sem binding', { ...request, tenantId: 'unknown' }, 'unknown', 'BINDING_NOT_FOUND'],
  ['objeto nulo', null, 'camaleao-demo', 'INVALID_REQUEST']
]) test(`bloqueia ${label} antes de reservar/chamar provedor`, async () => {
  const { hub, counts } = setup();
  await assert.rejects(hub.execute(input, identity), { code });
  assert.deepEqual(counts(), { calls: 0, reserves: 0 });
});
for (const data of [{}, { results: Array(11).fill(fixture.results[0]) }, { results: [{ properties: { dealstage: '<script>' } }] }]) {
  test('rejeita resposta fora do contrato', async () => {
    await assert.rejects(setup(data).hub.execute(request, 'camaleao-demo'), { code: 'INVALID_UPSTREAM_RESULTS' });
  });
}

async function withLedger(callback, options) {
  const directory = await mkdtemp(join(tmpdir(), 'radar-ledger-'));
  try { await callback(new FileLedger(directory, options), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
test('cota persiste após recriar instância e conta tentativas', () => withLedger(async (ledger, dir) => {
  await ledger.reserve('tenant', 'first');
  await assert.rejects(new FileLedger(dir, { maxAttempts: 1 }).reserve('tenant', 'second'), { code: 'DAILY_QUOTA_EXCEEDED' });
}, { maxAttempts: 1 }));
test('duplicata no mesmo dia é bloqueada', () => withLedger(async ledger => {
  await ledger.reserve('tenant', 'same');
  await assert.rejects(ledger.reserve('tenant', 'same'), { code: 'DUPLICATE_REQUEST' });
}));
test('cotas separadas por tenant', () => withLedger(async ledger => {
  await ledger.reserve('one', 'same'); await ledger.reserve('two', 'same');
}, { maxAttempts: 1 }));
test('nova data UTC renova cota', () => withLedger(async (ledger, dir) => {
  await ledger.reserve('one', 'first');
  const next = new FileLedger(dir, { maxAttempts: 1, clock: () => new Date('2026-10-02T00:00:00Z') });
  await next.reserve('one', 'second');
}, { maxAttempts: 1, clock: () => new Date('2026-10-01T23:59:59Z') }));
test('arquivo corrompido falha fechado', () => withLedger(async (ledger, dir) => {
  await writeFile(join(dir, 'attempts.json'), 'invalid');
  await assert.rejects(ledger.reserve('one', 'first'), { code: 'LEDGER_CORRUPT' });
}));
test('lock existente bloqueia sem removê-lo', () => withLedger(async (ledger, dir) => {
  await mkdir(join(dir, 'lock'));
  await assert.rejects(ledger.reserve('one', 'first'), { code: 'LEDGER_BUSY' });
}));
test('reservas concorrentes não ultrapassam cota', () => withLedger(async (ledger, dir) => {
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => ledger.reserve('one', String(i))));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(JSON.parse(await readFile(join(dir, 'attempts.json'), 'utf8')).length, 1);
}, { maxAttempts: 1 }));
test('falha upstream consome tentativa; não tenta de novo automaticamente', () => withLedger(async ledger => {
  let calls = 0;
  const hub = createHub({ ledger, bindings: { 'camaleao-demo': {} }, adapter: { async listDeals() { calls++; throw new Error('failure'); } } });
  await assert.rejects(hub.execute(request, 'camaleao-demo'));
  await assert.rejects(hub.execute({ ...request, requestId: 'two' }, 'camaleao-demo'), { code: 'DAILY_QUOTA_EXCEEDED' });
  assert.equal(calls, 1);
}, { maxAttempts: 1 }));

const binding = { connectionId: 'connection-demo', providerConfigKey: 'hubspot-demo' };
test('adaptador mantém host/método fixos, vínculo e timeout, sem redirect/retry', async () => {
  const adapter = new NangoCrmAdapter({ secretKey: 'test-only', fetchImpl: async (url, config) => {
    assert.equal(new URL(url).origin, 'https://api.nango.dev');
    assert.equal(new URL(url).pathname, '/proxy/crm/v3/objects/deals');
    assert.equal(config.method, 'GET'); assert.equal(config.redirect, 'error');
    assert.equal(config.headers['Connection-Id'], binding.connectionId);
    assert.equal(config.headers['Provider-Config-Key'], binding.providerConfigKey);
    assert.equal(config.headers.Authorization, 'Bearer test-only'); assert.equal(config.headers.Retries, '0');
    assert.ok(config.signal instanceof AbortSignal);
    return Response.json(fixture);
  } });
  assert.deepEqual(await adapter.listDeals(binding), fixture);
});
for (const [label, fetchImpl, code] of [
  ['429', async () => new Response('private body', { status: 429 }), 'UPSTREAM_RATE_LIMIT'],
  ['401', async () => new Response('private body', { status: 401 }), 'UPSTREAM_REJECTED'],
  ['html', async () => new Response('<html>'), 'INVALID_UPSTREAM_FORMAT'],
  ['json inválido', async () => new Response('broken', { headers: { 'content-type': 'application/json' } }), 'INVALID_UPSTREAM_FORMAT'],
  ['resposta excessiva', async () => Response.json({ data: 'x'.repeat(65536) }), 'UPSTREAM_BODY_TOO_LARGE'],
  ['erro de transporte', async () => { throw new Error('contains-private-secret'); }, 'UPSTREAM_UNAVAILABLE']
]) test(`adaptador trata ${label} com erro sem dados sensíveis`, async () => {
  const adapter = new NangoCrmAdapter({ secretKey: 'test-only', fetchImpl });
  await assert.rejects(adapter.listDeals(binding), error => error.code === code && error.message === code);
});
test('binding inválido não provoca chamada', async () => {
  let calls = 0;
  const adapter = new NangoCrmAdapter({ secretKey: 'test-only', fetchImpl: async () => { calls++; } });
  await assert.rejects(adapter.listDeals({ ...binding, connectionId: 'x\r\nInjected' }), { code: 'INVALID_BINDING' });
  assert.equal(calls, 0);
});
test('chave ausente é recusada antes da rede', () => {
  assert.throws(() => new NangoCrmAdapter({ secretKey: '' }), { code: 'INVALID_BACKEND_KEY' });
});
