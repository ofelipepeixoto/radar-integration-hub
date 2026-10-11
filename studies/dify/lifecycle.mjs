// Copyright (c) 2026 Carlos Felipe. MIT. Original offline study; no Dify code.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GovernanceStore, createPrincipalResolver } from '../../src/governance.mjs';
import { HubError } from '../../src/errors.mjs';

function denied(work, expected) {
  try { work(); } catch (error) {
    if (error instanceof HubError && error.code === expected) return expected;
  }
  throw new Error('STUDY_EXPECTATION_FAILED');
}

// Runs only fixed fixtures against a new temporary SQLite store. The synthetic
// paidEnabled option exercises accounting; no provider or network adapter exists.
export async function runLifecycleStudy() {
  const directory = await mkdtemp(join(tmpdir(), 'radar-dify-study-'));
  const path = join(directory, 'fixture.sqlite');
  const now = 1800000000000;
  const config = { clock: () => now, paidEnabled: true, dailyLimitsMicros: { 'study-tenant': 100 } };
  let store;
  try {
    store = new GovernanceStore(path, config);
    const identity = (subject, role, kind) => createPrincipalResolver(async () => ({
      subject, roles: [role], kind, tenantId: 'study-tenant', expiresAt: now + 3600000,
    }), { clock: () => now })('synthetic-fixture');
    const author = await identity('fixture-author', 'submitter', 'human-session');
    const reviewer = await identity('fixture-reviewer', 'reviewer', 'human-session');
    const executor = await identity('fixture-executor', 'executor', 'service');
    const proposal = id => {
      const reference = store.submit({ tenantId: 'study-tenant', proposalId: id,
        version: 1, action: 'ai.draft.preview',
        payload: { currency: 'BRL', maximumCostMicros: 100, text: 'synthetic-only' },
      }, author);
      return { reference, approval: store.approve(reference, reviewer) };
    };
    const reserve = (item, id) => store.reservePaid(item.reference, item.approval.approvalId, id, 100, executor);

    const cancelled = proposal('before-start');
    reserve(cancelled, 'cancelled-reservation');
    const beforeStart = store.cancelBeforeStart('study-tenant', 'cancelled-reservation', executor).state;
    const cancelledReplay = denied(() => reserve(cancelled, 'cancelled-reservation'), 'RESERVATION_REPLAY');

    const uncertain = proposal('started-unknown');
    reserve(uncertain, 'uncertain-reservation');
    const afterStart = store.markStarted('study-tenant', 'uncertain-reservation', executor).state;
    // Model an unknown result by leaving the reservation started. No simulated
    // timeout can establish zero cost; deliberately do not reconcile to zero.
    const cancellationDenied = denied(() => store.cancelBeforeStart('study-tenant', 'uncertain-reservation', executor),
      'RESERVATION_STATE_DENIED');
    store.close(); store = undefined;
    store = new GovernanceStore(path, config);
    const replayAfterReopen = denied(() => store.markStarted('study-tenant', 'uncertain-reservation', executor),
      'RESERVATION_STATE_DENIED');
    const next = proposal('next-attempt');
    const capacityDenied = denied(() => reserve(next, 'next-reservation'), 'BUDGET_EXCEEDED');

    return {
      schema: 'radar.dify.lifecycle.study.v1', scope: 'synthetic-local-sqlite',
      beforeStart, cancelledReplay, afterStart, cancellationDenied, replayAfterReopen, capacityDenied,
      providerCalled: false, humanIdentityVerified: false, productionVerified: false,
    };
  } finally {
    try { store?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { console.log(JSON.stringify(await runLifecycleStudy())); }
  catch { console.error('STUDY_FAILED'); process.exitCode = 1; }
}
