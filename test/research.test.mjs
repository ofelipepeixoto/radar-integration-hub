// Copyright (c) 2026 Carlos Felipe. SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLedger } from '../src/ledger.mjs';
import { createResearchPreview, validateResearchPreview } from '../src/research-preview.mjs';

const receipt = JSON.parse(await readFile(new URL('../fixtures/research/preview.json', import.meta.url), 'utf8'));
const snapshot = JSON.parse(await readFile(new URL('../fixtures/research/snapshot.json', import.meta.url), 'utf8'));
const validate = (value, source = snapshot) => validateResearchPreview(value, 'radar-demo', 'research-demo', source);
const captured = () => ({ preview: receipt, snapshot });

test('preserva duas origens para o mesmo texto Unicode e não altera o recibo do adapter', () => {
  const result = validate(receipt);
  assert.equal(result.groups.length, 1);
  assert.equal(result.includedOccurrences, 2);
  assert.equal(new Set(result.groups[0].occurrences.map(x => x.documentId)).size, 2);
  assert.equal(result.groups[0].occurrences[0].quote, receipt.groups[0].text);
  result.groups[0].text = 'changed';
  assert.notEqual(result.groups[0].text, receipt.groups[0].text);
});

test('bloqueia recibos de outro cliente/projeto e qualquer habilitação de execução', () => {
  for (const change of [{ tenantId: 'other' }, { projectId: 'other' },
    { paidCallsEnabled: true }, { externalActionsEnabled: true }, { issuerVerified: true },
    { shell: 'whoami' }, { decision: 'approved' }, { includedOccurrences: 1 }]) {
    assert.throws(() => validate({ ...receipt, ...change }), { code: 'EVIDENCE_PREVIEW_DENIED' });
  }
});

test('recusa conteúdo, referência, span, hash e duplicata adulterados', () => {
  const changes = [x => { x.groups[0].text += ' invented'; },
    x => { x.groups[0].contentId = 'a'.repeat(64); },
    x => { x.groups[0].occurrences[0].sourceSha256 = 'b'.repeat(64); },
    x => { x.groups[0].occurrences[0].quote = 'invented'; },
    x => { x.groups[0].occurrences[0].start = 1; },
    x => { x.groups[0].occurrences[0].revision = 2; },
    x => { x.groups[0].occurrences[0].evidenceId = 'a'.repeat(64); },
    x => { x.groups[0].occurrences[1].evidenceId = x.groups[0].occurrences[0].evidenceId; },
    x => { x.groups[0].occurrences.push(x.groups[0].occurrences[0]); x.includedOccurrences++; },
    x => { x.groups[0].occurrences[0].documentId = ' '.repeat(3); }];
  for (const change of changes) {
    const value = structuredClone(receipt); change(value);
    assert.throws(() => validate(value), { code: 'EVIDENCE_PREVIEW_DENIED' });
  }
});

test('pedido não escolhe tenant, modelo, orçamento, ação ou fonte; falha antes do adapter', async () => {
  let calls = 0, reservations = 0;
  const consumer = createResearchPreview({ tenantId: 'radar-demo', projectId: 'research-demo',
    ledger: { reserve: async () => { reservations++; } }, readEvidence: async () => { calls++; return captured(); } });
  await assert.rejects(consumer.execute({ requestId: 'run' }, 'other'), { code: 'TENANT_DENIED' });
  for (const extra of [{ tenantId: 'other' }, { maximumCostMicros: 1 }, { model: 'paid' },
    { action: 'shell' }, { snapshotPath: '/private' }, { url: 'http://127.0.0.1' }]) {
    await assert.rejects(consumer.execute({ requestId: 'run', ...extra }, 'radar-demo'), { code: 'RESEARCH_REQUEST_DENIED' });
  }
  assert.equal(calls, 0); assert.equal(reservations, 0);
});

test('reserva antes da leitura, persiste replay no mesmo dia e mantém orçamento sem chamadas', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'radar-research-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const make = () => createResearchPreview({ tenantId: 'radar-demo', projectId: 'research-demo',
    ledger: new FileLedger(directory), readEvidence: async () => { calls++; return captured(); } });
  const result = await make().execute({ requestId: 'persisted-run' }, 'radar-demo');
  assert.equal(result.paidCallsEnabled, false);
  assert.equal(result.externalActionsEnabled, false);
  await assert.rejects(make().execute({ requestId: 'persisted-run' }, 'radar-demo'), { code: 'DUPLICATE_REQUEST' });
  assert.equal(calls, 1);
});

test('falha do adapter é sanitizada e continua consumindo a tentativa', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'radar-research-fail-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const consumer = createResearchPreview({ tenantId: 'radar-demo', projectId: 'research-demo',
    ledger: new FileLedger(directory), readEvidence: async () => { throw new Error('PRIVATE_DOCUMENT'); } });
  await assert.rejects(consumer.execute({ requestId: 'failed' }, 'radar-demo'), { code: 'EVIDENCE_PREVIEW_DENIED' });
  await assert.rejects(consumer.execute({ requestId: 'failed' }, 'radar-demo'), { code: 'DUPLICATE_REQUEST' });
});

test('ausência de fontes exige abstenção e configuração inválida não inicia consumo', () => {
  assert.equal(validate({ ...receipt, groups: [], includedOccurrences: 0,
    excludedRecords: 2, duplicateRecords: 0, decision: 'abstained' }).decision, 'abstained');
  assert.throws(() => validate({ ...receipt, groups: [], decision: 'needs_review' }), { code: 'EVIDENCE_PREVIEW_DENIED' });
  assert.throws(() => createResearchPreview({}), { code: 'INVALID_RESEARCH_CONFIG' });
});

test('recibos ficam vinculados ao snapshot de origem sem expor os campos de revisão', () => {
  for (const change of [{ reviewer: 'different' }, { review_status: 'rejected' },
    { identity_verified: false }, { tenant_id: 'other' }]) {
    const source = structuredClone(snapshot); Object.assign(source.evidence[0], change);
    assert.throws(() => validate(receipt, source), { code: 'EVIDENCE_PREVIEW_DENIED' });
  }
  assert.throws(() => validateResearchPreview(receipt, 'radar-demo', 'research-demo'),
    { code: 'EVIDENCE_PREVIEW_DENIED' });
  const result = validate(receipt);
  assert.equal(Object.hasOwn(result, 'snapshot'), false);
  assert.equal(Object.hasOwn(result.groups[0].occurrences[0], 'reviewer'), false);
});

test('contagens reconciliam com o input e distinguem exclusão de replay exato', () => {
  assert.throws(() => validate({ ...receipt, excludedRecords: 998 }), { code: 'EVIDENCE_PREVIEW_DENIED' });
  const source = structuredClone(snapshot); source.evidence.push(source.evidence[0]);
  assert.equal(validate({ ...receipt, duplicateRecords: 1 }, source).duplicateRecords, 1);
  assert.throws(() => validate({ ...receipt, excludedRecords: 1 }, source), { code: 'EVIDENCE_PREVIEW_DENIED' });
  const excluded = structuredClone(snapshot.evidence[0]); excluded.tenant_id = 'other';
  const mixed = { ...snapshot, evidence: [...snapshot.evidence, excluded] };
  assert.equal(validate({ ...receipt, excludedRecords: 1 }, mixed).excludedRecords, 1);
  assert.throws(() => validate({ ...receipt, duplicateRecords: 1 }, mixed), { code: 'EVIDENCE_PREVIEW_DENIED' });
});
