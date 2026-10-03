// Synthetic process fixture. Never load real credentials or call a network provider.
import { GovernanceStore, createPrincipalResolver } from '../src/governance.mjs';
const input = JSON.parse(process.argv[2]);
const store = new GovernanceStore(input.path, { paidEnabled: true,
  dailyLimitsMicros: { tenant: 100 } });
try {
  const resolve = createPrincipalResolver(async () => ({ tenantId: 'tenant', subject: input.subject,
    kind: 'service', roles: ['executor'], expiresAt: Date.now() + 600000 }));
  const principal = await resolve('synthetic-test-only');
  const result = input.mode === 'budget'
    ? store.reservePaid(input.reference, input.approvalId, input.reservationId, 100, principal)
    : store.consumeApproval(input.reference, input.approvalId, principal);
  process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error.code ?? 'UNKNOWN' }) + '\n');
} finally { store.close(); }
