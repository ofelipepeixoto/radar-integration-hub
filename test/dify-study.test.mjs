// Copyright (c) 2026 Carlos Felipe. MIT. Synthetic study regression tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLifecycleStudy } from '../studies/dify/lifecycle.mjs';
import { createRuntimeBridge } from '../src/runtime-bridge.mjs';
import { serviceEvent } from '../src/observability.mjs';

test('cancel before start frees capacity, but does not permit reservation replay', async () => {
  const result = await runLifecycleStudy();
  assert.equal(result.beforeStart, 'cancelled');
  assert.equal(result.cancelledReplay, 'RESERVATION_REPLAY');
  // A second full reservation did start; the first reservation released capacity.
  assert.equal(result.afterStart, 'started');
});

test('unknown started result remains charged after SQLite reopen', async () => {
  const result = await runLifecycleStudy();
  assert.equal(result.cancellationDenied, 'RESERVATION_STATE_DENIED');
  assert.equal(result.replayAfterReopen, 'RESERVATION_STATE_DENIED');
  assert.equal(result.capacityDenied, 'BUDGET_EXCEEDED');
});

test('study output has an exact public schema and cannot certify provider or identity', async () => {
  const result = await runLifecycleStudy();
  assert.deepEqual(Object.keys(result).sort(), ['schema', 'scope', 'beforeStart', 'cancelledReplay',
    'afterStart', 'cancellationDenied', 'replayAfterReopen', 'capacityDenied',
    'providerCalled', 'humanIdentityVerified', 'productionVerified'].sort());
  for (const flag of ['providerCalled', 'humanIdentityVerified', 'productionVerified']) assert.equal(result[flag], false);
  const text = JSON.stringify(result);
  for (const privateValue of ['fixture-author', 'fixture-reviewer', 'fixture-executor',
    'study-tenant', 'synthetic-only', 'fixture.sqlite']) assert.ok(!text.includes(privateValue));
});

test('repeated study runs use independent temporary stores', async () => {
  assert.deepEqual(await runLifecycleStudy(), await runLifecycleStudy());
});

test('bridge failure releases busy state, hides private errors and does not retry', async () => {
  let calls = 0;
  const bridge = createRuntimeBridge({ tool: { name: 'radar_crm_preview', execute: async () => {
    calls++;
    if (calls === 1) throw new Error('https://user:secret@example.com/private?token=secret');
    return { details: { synthetic: true } };
  } } });
  try {
    assert.deepEqual(await bridge.handle({ id: 'first', tool: 'radar_crm_preview', arguments: {} }),
      { id: 'first', ok: false, error: { code: 'HUB_REQUEST_FAILED' } });
    assert.equal(calls, 1);
    assert.deepEqual(await bridge.handle({ id: 'second', tool: 'radar_crm_preview', arguments: {} }),
      { id: 'second', ok: true, result: { synthetic: true } });
    assert.equal(calls, 2);
  } finally { bridge.close(); }
});

test('allowlisted observability discards error text, URL, headers and body', () => {
  const event = serviceEvent({ action: 'crm.deals.preview', outcome: 'private-provider-error', status: 503,
    durationMs: 1, requestId: 'synthetic-request', url: 'https://user:secret@example.com/private',
    headers: { authorization: 'synthetic-secret' }, body: 'synthetic-private-body', error: 'synthetic-stack' });
  assert.equal(event.outcome, 'SERVICE_UNAVAILABLE');
  assert.match(event.requestIdHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(event).sort(), ['schemaVersion', 'component', 'action', 'outcome', 'status',
    'durationMs', 'requestIdHash'].sort());
});
