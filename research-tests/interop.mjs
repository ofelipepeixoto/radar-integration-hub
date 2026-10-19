// Copyright (c) 2026 Carlos Felipe. SPDX-License-Identifier: MIT
// Real local Python consumer; separate suite requires pinned evidence-kit src.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileLedger } from '../src/ledger.mjs';
import { createResearchPreview, validateResearchPreview } from '../src/research-preview.mjs';
import { createOfflineEvidenceReader } from '../src/research-worker.mjs';

assert.ok(process.env.RADAR_EVIDENCE_KIT_PATH, 'RADAR_EVIDENCE_KIT_PATH must point to pinned evidence-kit src');
const root = fileURLToPath(new URL('../', import.meta.url));
const kit = resolve(process.env.RADAR_EVIDENCE_KIT_PATH);
const python = process.env.RADAR_EVIDENCE_PYTHON ?? 'python3';
const snapshot = JSON.parse(await readFile(join(root, 'fixtures/research/snapshot.json'), 'utf8'));

async function local(t, data = snapshot, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'radar-research-interop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'snapshot.json');
  await writeFile(path, JSON.stringify(data));
  const readEvidence = createOfflineEvidenceReader({ evidenceSourcePath: kit,
    pythonExecutable: python, scopePath: join(root, 'fixtures/research/scope.json'),
    snapshotPath: path, ...config });
  const consumer = createResearchPreview({ tenantId: 'radar-demo', projectId: 'research-demo',
    ledger: new FileLedger(join(directory, 'state')), readEvidence });
  return { directory, path, readEvidence, consumer };
}

test('Node + Python reais: duas fontes preservadas e Unicode interoperável', async t => {
  const { consumer } = await local(t);
  const result = await consumer.execute({ requestId: 'real-python' }, 'radar-demo');
  assert.equal(result.includedOccurrences, 2);
  assert.equal(result.groups.length, 1);
  assert.equal(result.issuerVerified, false);
  assert.deepEqual(new Set(result.groups[0].occurrences.map(x => x.documentId)), new Set(['doc-a', 'doc-b']));
});

test('troca de cliente/projeto/revisão e revisão pendente causam abstenção', async t => {
  for (const change of [{ tenant_id: 'other' }, { project_id: 'other' },
    { revision: 2 }, { review_status: 'pending' }, { identity_verified: false }]) {
    const data = structuredClone(snapshot);
    data.evidence = data.evidence.map(x => ({ ...x, ...change }));
    const { consumer } = await local(t, data);
    const result = await consumer.execute({ requestId: 'excluded' }, 'radar-demo');
    assert.equal(result.decision, 'abstained'); assert.deepEqual(result.groups, []);
  }
});

test('recibos conflitantes da mesma ocorrência bloqueiam toda a prévia nas duas ordens', async t => {
  for (const change of [{ review_status: 'rejected' }, { review_status: 'pending' },
    { identity_verified: false }, { reviewer: '' }]) {
    const approved = structuredClone(snapshot.evidence[0]);
    const denied = { ...approved, ...change };
    for (const records of [[approved, denied], [denied, approved]]) {
      // An independent approved source must not produce a partial success.
      const data = { ...snapshot, evidence: [...records, snapshot.evidence[1]] };
      const { consumer } = await local(t, data);
      await assert.rejects(consumer.execute({ requestId: 'conflicting' }, 'radar-demo'),
        { code: 'EVIDENCE_PREVIEW_DENIED', message: 'EVIDENCE_PREVIEW_DENIED' });
      await assert.rejects(consumer.execute({ requestId: 'conflicting' }, 'radar-demo'),
        { code: 'DUPLICATE_REQUEST' });
    }
  }
});

test('conflitos fora do escopo não ocultam fontes atuais e replay exato permanece deduplicado', async t => {
  const approved = structuredClone(snapshot.evidence[0]);
  for (const change of [{ tenant_id: 'other' }, { project_id: 'other' },
    { revision: 2 }, { document_id: 'unknown' }]) {
    const excluded = { ...approved, ...change };
    const data = { ...snapshot, evidence: [approved, approved, excluded,
      { ...excluded, review_status: 'rejected' }] };
    const { consumer } = await local(t, data);
    const result = await consumer.execute({ requestId: 'scope-safe' }, 'radar-demo');
    assert.equal(result.decision, 'needs_review');
    assert.equal(result.includedOccurrences, 1);
    assert.equal(result.excludedRecords, 2);
    assert.equal(result.duplicateRecords, 1);
    assert.equal(result.groups[0].occurrences[0].documentId, approved.document_id);
  }
});

test('texto adulterado, payload desconhecido e JSON duplicado falham fechados', async t => {
  const data = structuredClone(snapshot); data.evidence[0].text += 'alterado';
  for (const input of [data, { ...snapshot, action: 'shell' }]) {
    const { consumer } = await local(t, input);
    await assert.rejects(consumer.execute({ requestId: 'invalid' }, 'radar-demo'), { code: 'EVIDENCE_PREVIEW_DENIED' });
  }
  const { path, readEvidence } = await local(t);
  await writeFile(path, '{"schema":"x","schema":"radar-evidence-snapshot-v1","evidence":[]}');
  await assert.rejects(readEvidence(), { code: 'EVIDENCE_PREVIEW_DENIED' });
});

test('limite de entrada e configuração de Python ausente retornam código sanitizado', async t => {
  const { path, readEvidence } = await local(t);
  await writeFile(path, ' '.repeat(256 * 1024 + 1));
  await assert.rejects(readEvidence(), { code: 'EVIDENCE_PREVIEW_DENIED' });
  const { consumer } = await local(t, snapshot, { pythonExecutable: '/radar-missing-python' });
  await assert.rejects(consumer.execute({ requestId: 'no-python' }, 'radar-demo'), { code: 'EVIDENCE_PREVIEW_DENIED' });
});

test('timeout e limite de saída funcionam durante a execução do processo fixo', async t => {
  const { directory } = await local(t);
  const packagePath = join(directory, 'radar_evidence'); await mkdir(packagePath);
  await writeFile(join(packagePath, '__init__.py'), '');
  for (const { body, timeoutMs } of [
    { body: 'import time; time.sleep(5)', timeoutMs: 100 },
    { body: 'print("x" * (1024 * 1024 + 1))', timeoutMs: 3000 }
  ]) {
    await writeFile(join(packagePath, 'research_preview.py'), body);
    const { readEvidence } = await local(t, snapshot, { evidenceSourcePath: directory, timeoutMs });
    await assert.rejects(readEvidence(), { code: 'EVIDENCE_PREVIEW_DENIED' });
  }
});

test('processo não herda chaves do ambiente do Hub', async t => {
  const { directory } = await local(t);
  const packagePath = join(directory, 'radar_evidence'); await mkdir(packagePath);
  await writeFile(join(packagePath, '__init__.py'), '');
  await writeFile(join(packagePath, 'research_preview.py'), 'import os,json\nprint(json.dumps({"secretInherited": "RADAR_TEST_PRIVATE_VALUE" in os.environ}))');
  process.env.RADAR_TEST_PRIVATE_VALUE = 'synthetic';
  t.after(() => { delete process.env.RADAR_TEST_PRIVATE_VALUE; });
  const { readEvidence } = await local(t, snapshot, { evidenceSourcePath: directory });
  const captured = await readEvidence();
  assert.deepEqual(captured.preview, { secretInherited: false });
  assert.deepEqual(captured.snapshot, snapshot);
});

test('falhas simuladas do adapter não podem alterar IDs ou contagens do snapshot real', async t => {
  const receipt = JSON.parse(await readFile(join(root, 'fixtures/research/preview.json'), 'utf8'));
  const { directory } = await local(t);
  const packagePath = join(directory, 'radar_evidence'); await mkdir(packagePath);
  await writeFile(join(packagePath, '__init__.py'), '');
  for (const mutate of [
    x => { x.groups[0].occurrences[0].evidenceId = 'a'.repeat(64); },
    x => { x.groups[0].occurrences[1].evidenceId = x.groups[0].occurrences[0].evidenceId; },
    x => { x.excludedRecords = 998; },
    x => { x.duplicateRecords = 1; }
  ]) {
    const output = structuredClone(receipt); mutate(output);
    await writeFile(join(packagePath, 'research_preview.py'),
      `import json\nprint(json.dumps(json.loads(${JSON.stringify(JSON.stringify(output))})))`);
    const { consumer } = await local(t, snapshot, { evidenceSourcePath: directory });
    await assert.rejects(consumer.execute({ requestId: 'bad-adapter' }, 'radar-demo'),
      { code: 'EVIDENCE_PREVIEW_DENIED' });
  }
});
