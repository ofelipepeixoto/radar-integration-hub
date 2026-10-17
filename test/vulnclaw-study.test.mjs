// Copyright (c) 2026 Carlos Felipe. MIT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runApprovalEvidenceStudy } from '../studies/vulnclaw/approval-evidence.mjs';

const report = await runApprovalEvidenceStudy();
const outcomes = new Map(report.cases.map(row => [row.caseId, row]));
test('content and origin are distinguished only when bound to the proposal', () => {
  assert.deepEqual(report.bindingComparison, { unboundContentChangeDetected: false,
    boundContentChangeDetected: true, boundOriginChangeDetected: true });
});
test('unchanged evidence yields only a local receipt', () => {
  assert.deepEqual(outcomes.get('unchanged-evidence'), {
    caseId: 'unchanged-evidence', outcome: 'RECEIPT_ISSUED', receiptIssued: true });
});
for (const caseId of ['changed-content', 'changed-origin', 'changed-scope', 'stale-version']) {
  test(`${caseId} cannot reuse an approval`, () => {
    assert.equal(outcomes.get(caseId).outcome, 'PROPOSAL_CHANGED');
    assert.equal(outcomes.get(caseId).receiptIssued, false);
  });
}
for (const caseId of ['model-claims-human-approval', 'service-claims-human-approval', 'cross-tenant']) {
  test(`${caseId} cannot acquire authority`, () => {
    assert.equal(outcomes.get(caseId).outcome, 'IDENTITY_DENIED');
    assert.equal(outcomes.get(caseId).receiptIssued, false);
  });
}
test('a submitter cannot approve its own evidence', () => {
  assert.equal(outcomes.get('self-approval').outcome, 'SELF_APPROVAL_DENIED');
});
test('expired evidence approval fails closed', () => {
  assert.equal(outcomes.get('expired-approval').outcome, 'APPROVAL_EXPIRED');
});
test('a proposal with no human approval abstains without a receipt', () => {
  assert.equal(outcomes.get('missing-human-approval').outcome, 'INVALID_APPROVAL');
  assert.equal(outcomes.get('missing-human-approval').receiptIssued, false);
});
test('an uncertain observer cannot consume the same approval after reopening', () => {
  assert.equal(outcomes.get('replay-after-reopen').outcome, 'APPROVAL_REPLAY');
  assert.equal(report.publicEventCounts['approval.consumed'], 2);
});
test('public evidence summary exports an exact allowlist without raw bodies or identities', () => {
  assert.deepEqual(Object.keys(report).sort(), ['schema', 'scope', 'referenceSource', 'hubBaseline',
    'bindingComparison', 'cases', 'publicEventCounts', 'executionEnabled', 'providerCalled',
    'paidCallsEnabled', 'humanIdentityVerified', 'productionVerified'].sort());
  for (const row of report.cases) assert.deepEqual(Object.keys(row).sort(), ['caseId', 'outcome', 'receiptIssued']);
  assert.deepEqual(Object.keys(report.publicEventCounts).sort(), ['approval.consumed', 'proposal.approved', 'proposal.submitted']);
  const encoded = JSON.stringify(report);
  for (const value of ['synthetic-private-evidence', 'fixture-author', 'fixture-reviewer', 'fixture-model',
    'approvalId', 'receiptId', 'actorHash', 'expiresAt', 'approved":true']) assert.ok(!encoded.includes(value));
});
test('study exposes no paid, provider, identity or production validation claim', () => {
  for (const key of ['executionEnabled', 'providerCalled', 'paidCallsEnabled', 'humanIdentityVerified', 'productionVerified']) {
    assert.equal(report[key], false);
  }
  assert.equal(report.scope, 'synthetic-local-sqlite');
  assert.equal(report.referenceSource.revision, '0b34878f84b089b21fcf85ecd445315f14df0672');
});
test('repeated runs use fresh stores and yield the same sanitized report', async () => {
  assert.deepEqual(await runApprovalEvidenceStudy(), report);
  assert.equal(outcomes.size, 12);
  assert.equal(report.cases.filter(row => row.receiptIssued).length, 1);
});
