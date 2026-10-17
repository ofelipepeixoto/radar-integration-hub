// Copyright (c) 2026 Carlos Felipe. MIT. Original offline study; no VulnClaw code.
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GovernanceStore, createPrincipalResolver, proposalHash } from '../../src/governance.mjs';
import { HubError } from '../../src/errors.mjs';

const REFERENCE_SOURCE = Object.freeze({ repository: 'Netw0rkNoob/VulnClaw',
  revision: '0b34878f84b089b21fcf85ecd445315f14df0672', path: 'vulnclaw/agent/exec_gate.py' });
const ORIGIN = Object.freeze({ fixtureId: 'synthetic-evidence-a', revision: 'fixture-revision-1' });
const BODY = 'synthetic-private-evidence-never-export';
const EVENT_TYPES = ['proposal.submitted', 'proposal.approved', 'approval.consumed'];

// This is a fixture builder, not an input parser or a production execution adapter.
function proposal(id, { body = BODY, origin = ORIGIN, network = false, version = 1, bound = true } = {}) {
  const payload = { operation: 'offline-review', network };
  if (bound) payload.evidence = { origin, sha256: createHash('sha256').update(body).digest('hex') };
  return { tenantId: 'vulnclaw-study', proposalId: id, version,
    action: 'draft.public-sources.review', payload };
}

function bindingComparison() {
  const original = proposal('comparison');
  const changed = proposal('comparison', { body: BODY + '-changed' });
  const otherOrigin = proposal('comparison', { origin: { ...ORIGIN, revision: 'fixture-revision-2' } });
  return {
    // Without evidence metadata, the same operation cannot distinguish the documents.
    unboundContentChangeDetected: proposalHash(proposal('comparison', { bound: false }))
      !== proposalHash(proposal('comparison', { bound: false, body: BODY + '-changed' })),
    boundContentChangeDetected: proposalHash(original) !== proposalHash(changed),
    boundOriginChangeDetected: proposalHash(original) !== proposalHash(otherOrigin),
  };
}

// Only fixed synthetic fixtures run here. There are no provider, shell or network
// adapters. Consuming an approval creates a local receipt; it executes no action.
export async function runApprovalEvidenceStudy() {
  const directory = await mkdtemp(join(tmpdir(), 'radar-vulnclaw-study-'));
  const path = join(directory, 'fixture.sqlite');
  let now = 1800000000000;
  let store;
  try {
    const options = { clock: () => now }; // paid calls remain disabled
    store = new GovernanceStore(path, options);
    const identity = (subject, roles, kind = 'human-session', tenantId = 'vulnclaw-study') =>
      createPrincipalResolver(async () => ({ subject, roles, kind, tenantId, expiresAt: now + 3600000 }),
        { clock: () => now })('synthetic-fixture');
    const author = await identity('fixture-author', ['submitter', 'reviewer']);
    const reviewer = await identity('fixture-reviewer', ['reviewer']);
    const executor = await identity('fixture-executor', ['executor'], 'service');
    const auditor = await identity('fixture-auditor', ['auditor']);
    const serviceReviewer = await identity('fixture-service', ['reviewer'], 'service');
    const otherTenant = await identity('fixture-other', ['executor'], 'service', 'other-study');
    const rows = [];
    function observe(caseId, work) {
      try {
        const receipt = work();
        if (receipt?.scope !== 'local-approval-receipt-only') throw new Error('INVALID_STUDY_RECEIPT');
        rows.push({ caseId, outcome: 'RECEIPT_ISSUED', receiptIssued: true });
      } catch (error) {
        if (!(error instanceof HubError)) throw error;
        rows.push({ caseId, outcome: error.code, receiptIssued: false });
      }
    }
    const prepared = id => {
      const reference = store.submit(proposal(id), author);
      return { reference, approval: store.approve(reference, reviewer) };
    };
    const consume = item => store.consumeApproval(item.reference, item.approval.approvalId, executor);

    const valid = prepared('unchanged');
    observe('unchanged-evidence', () => consume(valid));
    for (const [id, change] of [
      ['changed-content', { body: BODY + '-changed' }],
      ['changed-origin', { origin: { ...ORIGIN, revision: 'fixture-revision-2' } }],
      ['changed-scope', { network: true }],
    ]) {
      const item = prepared(id);
      // A trusted caller must recompute from the exact candidate. The store
      // receives only a reference; it cannot detect a caller that reuses old hashes.
      const candidate = { ...item.reference, hash: proposalHash(proposal(id, change)) };
      observe(id, () => store.consumeApproval(candidate, item.approval.approvalId, executor));
    }
    const stale = prepared('stale-version');
    store.submit(proposal('stale-version', { version: 2 }), author);
    observe('stale-version', () => consume(stale));

    const forged = store.submit(proposal('model-authority'), author);
    const modelResult = JSON.parse('{"approved":true,"kind":"human-session","roles":["reviewer"],"subject":"fixture-model","tenantId":"vulnclaw-study","expiresAt":1800000060000}');
    observe('model-claims-human-approval', () => store.approve(forged, modelResult));
    observe('service-claims-human-approval', () => store.approve(forged, serviceReviewer));
    observe('self-approval', () => store.approve(forged, author));

    const crossTenant = prepared('cross-tenant');
    observe('cross-tenant', () => store.consumeApproval(crossTenant.reference, crossTenant.approval.approvalId, otherTenant));
    const unreviewed = store.submit(proposal('unreviewed'), author);
    observe('missing-human-approval', () => store.consumeApproval(unreviewed, undefined, executor));
    const expired = prepared('expired');
    now += 300001;
    observe('expired-approval', () => consume(expired));

    // An uncertain observer never retries an external action. The persisted
    // receipt prevents a second consumption even after closing and reopening.
    const uncertain = prepared('unknown-after-receipt');
    consume(uncertain);
    store.close(); store = undefined;
    store = new GovernanceStore(path, options);
    observe('replay-after-reopen', () => consume(uncertain));
    const events = store.events('vulnclaw-study', auditor);
    if (events.some(event => !EVENT_TYPES.includes(event.type))) throw new Error('UNEXPECTED_STUDY_EVENT');
    const publicEventCounts = Object.fromEntries(EVENT_TYPES.map(type =>
      [type, events.filter(event => event.type === type).length]));
    return {
      schema: 'radar.vulnclaw.approval-evidence.study.v1', scope: 'synthetic-local-sqlite',
      referenceSource: { ...REFERENCE_SOURCE }, hubBaseline: 'd7084bdf63fcea9cf13ad1c5b3254c828b2cb6e2',
      bindingComparison: bindingComparison(), cases: rows, publicEventCounts,
      executionEnabled: false, providerCalled: false, paidCallsEnabled: store.readiness().paidCallsEnabled,
      humanIdentityVerified: false, productionVerified: false,
    };
  } finally {
    try { store?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { console.log(JSON.stringify(await runApprovalEvidenceStudy(), null, 2)); }
  catch { console.error('STUDY_FAILED'); process.exitCode = 1; }
}
