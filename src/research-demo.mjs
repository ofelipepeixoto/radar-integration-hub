// Copyright (c) 2026 Carlos Felipe. SPDX-License-Identifier: MIT
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileLedger } from './ledger.mjs';
import { createResearchPreview } from './research-preview.mjs';
import { createOfflineEvidenceReader } from './research-worker.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.RADAR_EVIDENCE_KIT_PATH) {
  console.error('Configure RADAR_EVIDENCE_KIT_PATH para o diretório src do evidence-kit homologado.');
  process.exitCode = 2;
} else {
  const directory = await mkdtemp(join(tmpdir(), 'radar-research-demo-'));
  try {
    const readEvidence = createOfflineEvidenceReader({
      evidenceSourcePath: resolve(process.env.RADAR_EVIDENCE_KIT_PATH),
      pythonExecutable: process.env.RADAR_EVIDENCE_PYTHON ?? 'python3',
      scopePath: join(root, 'fixtures/research/scope.json'),
      snapshotPath: join(root, 'fixtures/research/snapshot.json') });
    const preview = createResearchPreview({ tenantId: 'radar-demo', projectId: 'research-demo',
      ledger: new FileLedger(directory), readEvidence });
    // Local fixture identity, not an authenticated person or SaaS session.
    console.log(JSON.stringify(await preview.execute({ requestId: 'demo' }, 'radar-demo'), null, 2));
  } catch { console.error('EVIDENCE_PREVIEW_DENIED'); process.exitCode = 2; }
  finally { await rm(directory, { recursive: true, force: true }); }
}
