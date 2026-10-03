import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createReadOnlyServer, listenLocal } from '../src/service.mjs';
import { serviceEvent } from '../src/observability.mjs';

test('eventos usam allowlist e hash de correlação; não copiam campos, segredo ou erro arbitrário', () => {
  const secret = 'SYNTHETIC_PRIVATE_MARKER';
  const event = serviceEvent({ action: secret, outcome: secret, requestId: secret, status: 999,
    durationMs: -1, body: { token: secret }, headers: { Authorization: secret } });
  assert.equal(event.outcome, 'SERVICE_UNAVAILABLE'); assert.equal(event.status, 503);
  assert.equal(event.requestIdHash, createHash('sha256').update(secret).digest('hex'));
  assert.equal(JSON.stringify(event).includes(secret), false);
  assert.deepEqual(Object.keys(event), ['schemaVersion', 'component', 'action', 'outcome', 'status', 'durationMs', 'requestIdHash']);
});
async function serverFixture(t, checkReadiness) {
  const token = randomBytes(32).toString('base64url'), events = []; let calls = 0;
  const server = createReadOnlyServer({ token, tenantId: 'internal',
    hub: { async execute() { calls++; return {}; } }, audit: event => events.push(event),
    ...(checkReadiness ? { checkReadiness } : {}) });
  const address = await listenLocal(server, 0);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { send: (path, authenticated = true, method = 'GET') => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method, ...(authenticated ? { headers: { Authorization: `Bearer ${token}` } } : {}) }), calls: () => calls, events };
}
test('HTTP real separa processo vivo de readiness bloqueada; autentica ambos e não chama provedor', async t => {
  const f = await serverFixture(t);
  for (const path of ['/healthz', '/readyz']) assert.equal((await f.send(path, false)).status, 401);
  const health = await f.send('/healthz'); assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'alive', scope: 'process-only' });
  const ready = await f.send('/readyz'); assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: 'blocked', scope: 'read-only-local-contract',
    humanIdentityConfigured: false, paidCallsEnabled: false, providerVerified: false });
  assert.equal((await f.send('/readyz', true, 'POST')).status, 405);
  assert.equal((await f.send('/readyz?tenant=other')).status, 404);
  assert.equal((await f.send('/v1/approvals', true, 'POST')).status, 404);
  assert.equal(f.calls(), 0);
  assert.ok(f.events.some(x => x.action === 'health.check'));
  assert.ok(f.events.some(x => x.action === 'readiness.check' && x.outcome === 'NOT_READY'));
});
test('readiness projeta somente contrato local; campos extras não viram evidência operacional', async t => {
  const f = await serverFixture(t, async () => ({ localReady: true, humanIdentityConfigured: true,
    paidCallsEnabled: true, providerVerified: true, secret: 'synthetic-private' }));
  const response = await f.send('/readyz'); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.humanIdentityConfigured, false);
  assert.equal(data.paidCallsEnabled, false); assert.equal(data.providerVerified, false);
  assert.equal(JSON.stringify(data).includes('synthetic-private'), false); assert.equal(f.calls(), 0);
});
test('readiness falha fechada em erro, tipo incorreto ou verificador que trava', async t => {
  for (const callback of [async () => { throw new Error('synthetic-private'); }, async () => ({ localReady: 'true' }),
    () => new Promise(() => {})]) {
    const f = await serverFixture(t, callback), response = await f.send('/readyz');
    assert.equal(response.status, 503); assert.equal(JSON.stringify(await response.json()).includes('synthetic-private'), false);
    assert.equal(f.calls(), 0);
  }
});
