import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { GovernanceStore, createPrincipalResolver, proposalHash } from '../src/governance.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'radar-governance-'));
  const path = join(directory, 'state.sqlite');
  let now = Date.now();
  let store = new GovernanceStore(path, { ...options, clock: () => now });
  t.after(async () => { try { store.close(); } catch {} await rm(directory, { recursive: true, force: true }); });
  const identity = async (subject, roles, kind = 'human-session', tenantId = 'tenant') =>
    createPrincipalResolver(async () => ({ subject, roles, kind, tenantId, expiresAt: now + 3600000 }), { clock: () => now })('synthetic-fixture');
  const submitter = await identity('author', ['submitter']);
  const reviewer = await identity('reviewer', ['reviewer']);
  const executor = await identity('executor', ['executor'], 'service');
  const auditor = await identity('auditor', ['auditor']);
  const submit = (id = 'draft', version = 1, paid = false, maximumCostMicros = 100) => store.submit({
    tenantId: 'tenant', proposalId: id, version,
    action: paid ? 'ai.draft.preview' : 'draft.public-sources.review',
    payload: paid ? { currency: 'BRL', maximumCostMicros, text: 'synthetic' } : { text: 'synthetic-private-body' }
  }, submitter);
  const approved = (id = 'draft', paid = false) => {
    const reference = submit(id, 1, paid); return { reference, approval: store.approve(reference, reviewer) };
  };
  return { path, directory, identity, submitter, reviewer, executor, auditor, submit, approved,
    get store() { return store; }, advance(ms) { now += ms; },
    reopen(newOptions = options) { store.close(); store = new GovernanceStore(path, { ...newOptions, clock: () => now }); } };
}
function processResult(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('../fixtures/governance-worker.mjs', import.meta.url).pathname, JSON.stringify(input)],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', x => { output += x; }); child.stderr.on('data', x => { errors += x; });
    child.on('error', reject); child.on('exit', code => {
      if (code !== 0) return reject(new Error('worker failed: ' + errors));
      try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
  });
}
test('hash vincula tenant, versão, ação e conteúdo; ordem de chaves não muda identidade', () => {
  const base = { tenantId: 'tenant', proposalId: 'draft', version: 1, action: 'draft.public-sources.review', payload: { b: 2, a: 1 } };
  assert.equal(proposalHash(base), proposalHash({ ...base, payload: { a: 1, b: 2 } }));
  for (const change of [{ tenantId: 'other' }, { version: 2 }, { payload: { a: 9, b: 2 } }, { action: 'ai.draft.preview' }]) {
    assert.notEqual(proposalHash(base), proposalHash({ ...base, ...change }));
  }
  for (const payload of [undefined, { value: Infinity }, { run() {} }, JSON.parse('{"__proto__":1}')]) {
    assert.throws(() => proposalHash({ ...base, payload }), { code: 'INVALID_PROPOSAL' });
  }
  assert.throws(() => proposalHash({ ...base, payload: 'x'.repeat(16384) }), { code: 'PROPOSAL_TOO_LARGE' });
});
test('identidade fabricada no corpo, serviço e autoaprovação não autenticam revisor', async t => {
  const f = await fixture(t), reference = f.submit();
  assert.throws(() => f.store.approve(reference, { tenantId: 'tenant', subject: 'attacker', kind: 'human-session', roles: ['reviewer'], expiresAt: Date.now() + 60000 }), { code: 'IDENTITY_DENIED' });
  const service = await f.identity('service', ['reviewer'], 'service');
  assert.throws(() => f.store.approve(reference, service), { code: 'IDENTITY_DENIED' });
  const self = await f.identity('author', ['reviewer']);
  assert.throws(() => f.store.approve(reference, self), { code: 'SELF_APPROVAL_DENIED' });
  const other = await f.identity('reviewer', ['reviewer'], 'human-session', 'other');
  assert.throws(() => f.store.approve(reference, other), { code: 'IDENTITY_DENIED' });
});
test('resolver exige claims verificados e sessão limitada; não aceita ausência de subject', async () => {
  for (const claims of [null, {}, { tenantId: 'tenant', kind: 'human-session', roles: ['reviewer'], expiresAt: Date.now() + 60000 },
    { tenantId: 'tenant', subject: 'x', kind: 'human-session', roles: ['admin'], expiresAt: Date.now() + 60000 },
    { tenantId: 'tenant', subject: 'x', kind: 'human-session', roles: ['reviewer'], expiresAt: Date.now() - 1 }]) {
    await assert.rejects(createPrincipalResolver(async () => claims)('not-a-session'), { code: 'IDENTITY_DENIED' });
  }
});
test('revisão persiste, expira e exige hash e versão atuais', async t => {
  const f = await fixture(t), { reference, approval } = f.approved();
  f.reopen();
  assert.throws(() => f.store.consumeApproval({ ...reference, hash: '0'.repeat(64) }, approval.approvalId, f.executor), { code: 'PROPOSAL_CHANGED' });
  f.submit('draft', 2);
  assert.throws(() => f.store.consumeApproval(reference, approval.approvalId, f.executor), { code: 'PROPOSAL_CHANGED' });
  const newer = f.submit('later', 1), shorter = f.store.approve(newer, f.reviewer, { ttlMs: 1000 });
  f.advance(1001);
  assert.throws(() => f.store.consumeApproval(newer, shorter.approvalId, f.executor), { code: 'APPROVAL_EXPIRED' });
  f.advance(3600000);
  assert.throws(() => f.store.consumeApproval(newer, shorter.approvalId, f.executor), { code: 'IDENTITY_DENIED' });
});
test('duas instâncias e dois executores não consomem aprovação duas vezes', async t => {
  const f = await fixture(t), { reference, approval } = f.approved();
  const other = new GovernanceStore(f.path); t.after(() => other.close());
  const second = await f.identity('executor-two', ['executor'], 'service');
  const receipt = f.store.consumeApproval(reference, approval.approvalId, f.executor);
  assert.equal(receipt.scope, 'local-approval-receipt-only');
  assert.throws(() => other.consumeApproval(reference, approval.approvalId, second), { code: 'APPROVAL_REPLAY' });
  f.reopen();
  assert.throws(() => f.store.consumeApproval(reference, approval.approvalId, f.executor), { code: 'APPROVAL_REPLAY' });
});
test('aprovações diferentes da mesma versão também não repetem consumo', async t => {
  const f = await fixture(t), { reference, approval } = f.approved();
  const reviewer = await f.identity('reviewer-two', ['reviewer']);
  const second = f.store.approve(reference, reviewer);
  f.store.consumeApproval(reference, approval.approvalId, f.executor);
  assert.throws(() => f.store.consumeApproval(reference, second.approvalId, f.executor), { code: 'PROPOSAL_ALREADY_CONSUMED' });
});
test('race entre processos resulta em um recibo; nenhum reenvio automático', async t => {
  const f = await fixture(t), { reference, approval } = f.approved();
  const results = await Promise.all(['worker-one', 'worker-two', 'worker-three'].map(subject =>
    processResult({ path: f.path, mode: 'approval', reference, approvalId: approval.approvalId, subject })));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.code === 'APPROVAL_REPLAY').length, 2);
});
test('pago desabilitado e orçamento zero recusam sem consumir aprovação', async t => {
  const f = await fixture(t), { reference, approval } = f.approved('paid', true);
  assert.throws(() => f.store.consumeApproval(reference, approval.approvalId, f.executor), { code: 'PAID_RESERVATION_REQUIRED' });
  assert.throws(() => f.store.reservePaid(reference, approval.approvalId, 'one', 100, f.executor), { code: 'PAID_CALLS_DISABLED' });
  f.reopen({ paidEnabled: true });
  assert.throws(() => f.store.reservePaid(reference, approval.approvalId, 'one', 100, f.executor), { code: 'BUDGET_EXCEEDED' });
  f.reopen({ paidEnabled: true, dailyLimitsMicros: { tenant: 100 } });
  assert.equal(f.store.reservePaid(reference, approval.approvalId, 'one', 100, f.executor).providerCalled, false);
});
test('reserva não pode aumentar custo aprovado ou financiar ação diferente', async t => {
  const f = await fixture(t, { paidEnabled: true, dailyLimitsMicros: { tenant: 1000 } });
  const { reference, approval } = f.approved('paid', true);
  assert.throws(() => f.store.reservePaid(reference, approval.approvalId, 'one', 101, f.executor), { code: 'APPROVED_COST_EXCEEDED' });
  const plain = f.approved('plain');
  assert.throws(() => f.store.reservePaid(plain.reference, plain.approval.approvalId, 'two', 10, f.executor), { code: 'PAID_ACTION_DENIED' });
});
test('race de orçamento entre processos não ultrapassa limite; negativas não consomem aprovação', async t => {
  const f = await fixture(t, { paidEnabled: true, dailyLimitsMicros: { tenant: 100 } });
  const drafts = [0, 1, 2, 3].map(i => ({ ...f.approved('paid' + i, true), i }));
  const results = await Promise.all(drafts.map(({ reference, approval, i }) =>
    processResult({ path: f.path, mode: 'budget', reference, approvalId: approval.approvalId, reservationId: 'r' + i, subject: 'worker-' + i })));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.code === 'BUDGET_EXCEEDED').length, 3);
  const deniedIndex = results.findIndex(result => !result.ok);
  const denied = drafts[deniedIndex];
  f.reopen({ paidEnabled: true, dailyLimitsMicros: { tenant: 200 } });
  assert.equal(f.store.reservePaid(denied.reference, denied.approval.approvalId, 'retry', 100, f.executor).state, 'held');
});
test('falha após consumir aprovação e inserir reserva reverte ambos na mesma transação', async t => {
  const f = await fixture(t, { paidEnabled: true, dailyLimitsMicros: { tenant: 100 } });
  const { reference, approval } = f.approved('paid', true);
  const fault = new DatabaseSync(f.path); t.after(() => fault.close());
  fault.exec(`CREATE TRIGGER synthetic_disk_failure BEFORE INSERT ON events
    WHEN NEW.type='budget.reserved' BEGIN SELECT RAISE(ABORT,'synthetic-private-error'); END;`);
  assert.throws(() => f.store.reservePaid(reference, approval.approvalId, 'r1', 100, f.executor),
    error => error.code === 'GOVERNANCE_UNAVAILABLE' && !error.message.includes('synthetic-private-error'));
  assert.equal(fault.prepare('SELECT COUNT(*) AS count FROM reservations').get().count, 0);
  assert.equal(fault.prepare('SELECT consumed FROM approvals WHERE id=?').get(approval.approvalId).consumed, null);
  assert.equal(fault.prepare('SELECT COUNT(*) AS count FROM receipts').get().count, 0);
  fault.exec('DROP TRIGGER synthetic_disk_failure');
  assert.equal(f.store.reservePaid(reference, approval.approvalId, 'r1', 100, f.executor).state, 'held');
});
test('reinício e mudança de dia conservam reservas incertas; custo não é liberado por timeout', async t => {
  const options = { paidEnabled: true, dailyLimitsMicros: { tenant: 100 } }, f = await fixture(t, options);
  const first = f.approved('first', true);
  f.store.reservePaid(first.reference, first.approval.approvalId, 'r1', 100, f.executor);
  f.store.markStarted('tenant', 'r1', f.executor);
  f.advance(86400000); f.reopen();
  const executor = await f.identity('executor', ['executor'], 'service');
  const submitter = await f.identity('newauthor', ['submitter']);
  const reviewer = await f.identity('newreviewer', ['reviewer']);
  const next = f.store.submit({ tenantId: 'tenant', proposalId: 'second', version: 1, action: 'ai.draft.preview', payload: { currency: 'BRL', maximumCostMicros: 100 } }, submitter);
  const approval = f.store.approve(next, reviewer);
  assert.throws(() => f.store.reservePaid(next, approval.approvalId, 'r2', 100, executor), { code: 'BUDGET_EXCEEDED' });
  assert.throws(() => f.store.cancelBeforeStart('tenant', 'r1', executor), { code: 'RESERVATION_STATE_DENIED' });
});
test('cancelamento só antes de início; reconciliação persiste saldo e bloqueia replay', async t => {
  const f = await fixture(t, { paidEnabled: true, dailyLimitsMicros: { tenant: 100 } });
  const first = f.approved('first', true);
  f.store.reservePaid(first.reference, first.approval.approvalId, 'r1', 100, f.executor);
  f.store.cancelBeforeStart('tenant', 'r1', f.executor);
  assert.throws(() => f.store.markStarted('tenant', 'r1', f.executor), { code: 'RESERVATION_STATE_DENIED' });
  const second = f.approved('second', true);
  f.store.reservePaid(second.reference, second.approval.approvalId, 'r2', 100, f.executor);
  f.store.markStarted('tenant', 'r2', f.executor); f.reopen();
  const other = await f.identity('other-executor', ['executor'], 'service');
  assert.throws(() => f.store.reconcile('tenant', 'r2', 40, other), { code: 'RESERVATION_DENIED' });
  assert.equal(f.store.reconcile('tenant', 'r2', 40, f.executor).state, 'settled');
  assert.throws(() => f.store.reconcile('tenant', 'r2', 40, f.executor), { code: 'RESERVATION_STATE_DENIED' });
  const third = f.approved('third', true);
  f.store.reservePaid(third.reference, third.approval.approvalId, 'r3', 60, f.executor);
  const fourth = f.approved('fourth', true);
  assert.throws(() => f.store.reservePaid(fourth.reference, fourth.approval.approvalId, 'r4', 1, f.executor), { code: 'BUDGET_EXCEEDED' });
});
test('fronteira de início revalida expiração e revisão depois de reservar; reserva fica retida', async t => {
  const f = await fixture(t, { paidEnabled: true, dailyLimitsMicros: { tenant: 1000 } });
  const reference = f.submit('expiring', 1, true), approval = f.store.approve(reference, f.reviewer, { ttlMs: 1000 });
  f.store.reservePaid(reference, approval.approvalId, 'expiring', 100, f.executor);
  f.advance(1001);
  assert.throws(() => f.store.markStarted('tenant', 'expiring', f.executor), { code: 'APPROVAL_EXPIRED' });
  assert.equal(f.store.cancelBeforeStart('tenant', 'expiring', f.executor).state, 'cancelled');
  const changed = f.approved('changed', true);
  f.store.reservePaid(changed.reference, changed.approval.approvalId, 'changed', 100, f.executor);
  f.submit('changed', 2, true);
  assert.throws(() => f.store.markStarted('tenant', 'changed', f.executor), { code: 'PROPOSAL_CHANGED' });
  assert.equal(f.store.cancelBeforeStart('tenant', 'changed', f.executor).state, 'cancelled');
});
test('reinício com pago desabilitado ou limite reduzido impede iniciar reserva existente', async t => {
  const enabled = { paidEnabled: true, dailyLimitsMicros: { tenant: 100 } };
  const f = await fixture(t, enabled), { reference, approval } = f.approved('paid', true);
  f.store.reservePaid(reference, approval.approvalId, 'held', 100, f.executor);
  f.reopen({ paidEnabled: false, dailyLimitsMicros: { tenant: 100 } });
  assert.throws(() => f.store.markStarted('tenant', 'held', f.executor), { code: 'PAID_CALLS_DISABLED' });
  for (const limit of [0, 99]) {
    f.reopen({ paidEnabled: true, dailyLimitsMicros: { tenant: limit } });
    assert.throws(() => f.store.markStarted('tenant', 'held', f.executor), { code: 'BUDGET_EXCEEDED' });
  }
  f.reopen(enabled);
  assert.equal(f.store.markStarted('tenant', 'held', f.executor).state, 'started');
});
test('overrun de uma chamada bloqueia início de outra reserva já existente', async t => {
  const f = await fixture(t, { paidEnabled: true, dailyLimitsMicros: { tenant: 1000 } });
  const first = f.approved('first', true), second = f.approved('second', true);
  f.store.reservePaid(first.reference, first.approval.approvalId, 'first', 100, f.executor);
  f.store.markStarted('tenant', 'first', f.executor);
  f.store.reservePaid(second.reference, second.approval.approvalId, 'second', 100, f.executor);
  f.store.reconcile('tenant', 'first', 101, f.executor);
  f.reopen();
  assert.throws(() => f.store.markStarted('tenant', 'second', f.executor), { code: 'BUDGET_BLOCKED' });
  assert.equal(f.store.cancelBeforeStart('tenant', 'second', f.executor).state, 'cancelled');
});
test('custo real acima da reserva é registrado e bloqueia novas chamadas, mesmo após reinício', async t => {
  const f = await fixture(t, { paidEnabled: true, dailyLimitsMicros: { tenant: 1000 } });
  const first = f.approved('first', true);
  f.store.reservePaid(first.reference, first.approval.approvalId, 'r1', 50, f.executor);
  f.store.markStarted('tenant', 'r1', f.executor);
  assert.deepEqual(f.store.reconcile('tenant', 'r1', 51, f.executor), { reservationId: 'r1', state: 'overrun', actualMicros: 51, tenantBlocked: true });
  f.reopen();
  const second = f.approved('second', true);
  assert.throws(() => f.store.reservePaid(second.reference, second.approval.approvalId, 'r2', 1, f.executor), { code: 'BUDGET_BLOCKED' });
});
test('transação interrompida por SIGKILL reverte consumo; SQLite solta lock do processo morto', async t => {
  const f = await fixture(t), { reference, approval } = f.approved();
  const script = `import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE'); db.prepare('UPDATE approvals SET consumed=1 WHERE id=?').run(process.argv[2]);
    process.stdout.write('transaction-open\\n'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, f.path, approval.approvalId], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  const finished = once(child, 'exit'); child.kill('SIGKILL'); await finished;
  f.reopen();
  assert.equal(f.store.consumeApproval(reference, approval.approvalId, f.executor).hash, reference.hash);
});
test('eventos transacionais não persistem corpo/identidade bruta; acesso pertence ao tenant', async t => {
  const f = await fixture(t), { reference, approval } = f.approved();
  f.store.consumeApproval(reference, approval.approvalId, f.executor);
  const events = f.store.events('tenant', f.auditor);
  assert.deepEqual(events.map(x => x.type), ['approval.consumed', 'proposal.approved', 'proposal.submitted']);
  assert.ok(events.every(x => /^[a-f0-9]{64}$/.test(x.actorHash)));
  assert.throws(() => f.store.events('other', f.auditor), { code: 'IDENTITY_DENIED' });
  f.reopen();
  assert.equal((await readFile(f.path)).includes(Buffer.from('synthetic-private-body')), false);
  assert.equal(f.store.readiness().humanIdentityConfigured, false);
});
test('armazenamento inválido, público ou symlink falha fechado; readiness não faz chamada externa', async t => {
  const f = await fixture(t);
  assert.throws(() => new GovernanceStore(':memory:'), { code: 'INVALID_GOVERNANCE_CONFIG' });
  const corrupt = join(f.directory, 'broken.sqlite'); await writeFile(corrupt, 'not-a-database');
  assert.throws(() => new GovernanceStore(corrupt), { code: 'GOVERNANCE_UNAVAILABLE' });
  const link = join(f.directory, 'link.sqlite'); await symlink(f.path, link);
  assert.throws(() => new GovernanceStore(link), { code: 'GOVERNANCE_UNAVAILABLE' });
  await chmod(f.directory, 0o755);
  assert.throws(() => new GovernanceStore(join(f.directory, 'wide.sqlite')), { code: 'GOVERNANCE_UNAVAILABLE' });
  await chmod(f.directory, 0o700);
  f.store.close(); assert.equal(f.store.readiness().localStoreReady, false);
});
