// Copyright (c) 2026 Carlos Felipe. MIT. Original local governance; no provider calls.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, lstatSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { HubError } from './errors.mjs';

const principals = new WeakSet();
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TENANT = /^[a-z0-9-]{1,64}$/;
const HASH = /^[a-f0-9]{64}$/;
const ACTIONS = new Set(['draft.public-sources.review', 'ai.draft.preview']);
const ROLES = new Set(['submitter', 'reviewer', 'executor', 'auditor']);
const fail = code => { throw new HubError(code); };
const money = value => Number.isSafeInteger(value) && value >= 0;
const actorHash = principal => createHash('sha256').update(principal.subject).digest('hex');

// authenticate is supplied by trusted backend startup. It must verify a session/token,
// issuer, membership and roles. Never implement it as a projection of a request body.
// This library does not contain a production authenticator. A service token is not human identity.
export function createPrincipalResolver(authenticate, { clock = () => Date.now() } = {}) {
  if (typeof authenticate !== 'function') fail('AUTHENTICATOR_REQUIRED');
  return async credentials => {
    const claims = await authenticate(credentials);
    const now = clock();
    if (!claims || typeof claims.tenantId !== 'string' || !TENANT.test(claims.tenantId)
      || typeof claims.subject !== 'string' || !ID.test(claims.subject)
      || !['human-session', 'service'].includes(claims.kind)
      || !Array.isArray(claims.roles) || !claims.roles.length
      || claims.roles.some(role => !ROLES.has(role))
      || !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= now
      || claims.expiresAt > now + 3600000) fail('IDENTITY_DENIED');
    const principal = Object.freeze({ tenantId: claims.tenantId, subject: claims.subject,
      kind: claims.kind, roles: Object.freeze([...new Set(claims.roles)]), expiresAt: claims.expiresAt });
    principals.add(principal);
    return principal;
  };
}

function canonical(value, depth = 0) {
  if (depth > 16) fail('INVALID_PROPOSAL');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value) && value.length <= 1000) return '[' + value.map(x => canonical(x, depth + 1)).join(',') + ']';
  if (!value || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_PROPOSAL');
  const keys = Object.keys(value).sort();
  if (keys.length > 128 || keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) fail('INVALID_PROPOSAL');
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
}

export function proposalHash({ tenantId, proposalId, version, action, payload }) {
  if (typeof tenantId !== 'string' || !TENANT.test(tenantId)
    || typeof proposalId !== 'string' || !ID.test(proposalId)
    || !Number.isSafeInteger(version) || version < 1
    || !ACTIONS.has(action)) fail('INVALID_PROPOSAL');
  const encoded = canonical({ tenantId, proposalId, version, action, payload });
  if (Buffer.byteLength(encoded) > 16384) fail('PROPOSAL_TOO_LARGE');
  return createHash('sha256').update(encoded).digest('hex');
}

export class GovernanceStore {
  #db; #clock; #paidEnabled; #limits;
  constructor(path, { clock = () => Date.now(), paidEnabled = false, dailyLimitsMicros = {} } = {}) {
    if (typeof path !== 'string' || !path || path === ':memory:'
      || typeof clock !== 'function' || typeof paidEnabled !== 'boolean'
      || !dailyLimitsMicros || typeof dailyLimitsMicros !== 'object' || Array.isArray(dailyLimitsMicros)
      || Object.entries(dailyLimitsMicros).some(([tenant, limit]) => !TENANT.test(tenant) || !money(limit))) fail('INVALID_GOVERNANCE_CONFIG');
    this.#clock = clock; this.#paidEnabled = paidEnabled;
    this.#limits = Object.freeze({ ...dailyLimitsMicros });
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const directory = lstatSync(dirname(path));
      if (directory.isSymbolicLink() || !directory.isDirectory() || (directory.mode & 0o077) !== 0) fail('GOVERNANCE_UNAVAILABLE');
      try { if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) fail('GOVERNANCE_UNAVAILABLE'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.#db = new DatabaseSync(path);
      chmodSync(path, 0o600);
      const schemaVersion = this.#db.prepare('PRAGMA user_version').get().user_version;
      if (schemaVersion !== 0 && schemaVersion !== 1) fail('GOVERNANCE_SCHEMA_UNSUPPORTED');
      this.#db.exec(`PRAGMA busy_timeout = 2000; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;
        PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS proposals (
          tenant TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL,
          action TEXT NOT NULL, submitter TEXT NOT NULL, cost_limit INTEGER NOT NULL CHECK(cost_limit>=0), created INTEGER NOT NULL,
          PRIMARY KEY (tenant,id,version));
        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY, tenant TEXT NOT NULL, proposal TEXT NOT NULL, version INTEGER NOT NULL,
          hash TEXT NOT NULL, reviewer TEXT NOT NULL, expires INTEGER NOT NULL, consumed INTEGER,
          FOREIGN KEY (tenant,proposal,version) REFERENCES proposals(tenant,id,version));
        CREATE TABLE IF NOT EXISTS receipts (
          id TEXT PRIMARY KEY, approval TEXT NOT NULL UNIQUE, tenant TEXT NOT NULL,
          hash TEXT NOT NULL, executor TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(tenant,hash),
          FOREIGN KEY (approval) REFERENCES approvals(id));
        CREATE TABLE IF NOT EXISTS reservations (
          id TEXT PRIMARY KEY, tenant TEXT NOT NULL, approval TEXT NOT NULL UNIQUE,
          executor TEXT NOT NULL, day TEXT NOT NULL, maximum INTEGER NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('held','started','settled','cancelled','overrun')),
          actual INTEGER, created INTEGER NOT NULL,
          FOREIGN KEY (approval) REFERENCES approvals(id));
        CREATE TABLE IF NOT EXISTS blocks (tenant TEXT PRIMARY KEY, reason TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY, tenant TEXT NOT NULL, type TEXT NOT NULL, reference TEXT NOT NULL,
          actor_hash TEXT NOT NULL, at INTEGER NOT NULL); PRAGMA user_version = 1;
      `);
      if (this.#db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('GOVERNANCE_CORRUPT');
    } catch (error) {
      try { this.#db?.close(); } catch {}
      if (error instanceof HubError) throw error;
      fail('GOVERNANCE_UNAVAILABLE');
    }
  }
  close() { this.#db.close(); }
  #identity(principal, tenant, role, human = false) {
    if (!principals.has(principal) || principal.tenantId !== tenant || !principal.roles.includes(role)
      || principal.expiresAt <= this.#clock()
      || (human && principal.kind !== 'human-session')) fail('IDENTITY_DENIED');
  }
  #transaction(work) {
    try {
      this.#db.exec('BEGIN IMMEDIATE');
      const value = work();
      this.#db.exec('COMMIT');
      return value;
    } catch (error) {
      try { this.#db.exec('ROLLBACK'); } catch {}
      if (error instanceof HubError) throw error;
      fail('GOVERNANCE_UNAVAILABLE');
    }
  }
  #event(tenant, type, reference, principal) {
    this.#db.prepare('INSERT INTO events(tenant,type,reference,actor_hash,at) VALUES(?,?,?,?,?)')
      .run(tenant, type, reference, actorHash(principal), this.#clock());
  }
  submit(proposal, principal) {
    const hash = proposalHash(proposal);
    const { tenantId, proposalId, version, action } = proposal;
    this.#identity(principal, tenantId, 'submitter');
    const costLimit = action === 'ai.draft.preview' ? proposal.payload?.maximumCostMicros : 0;
    if (!money(costLimit) || (action === 'ai.draft.preview'
      && (costLimit < 1 || proposal.payload?.currency !== 'BRL'))) fail('INVALID_APPROVED_COST');
    return this.#transaction(() => {
      const current = this.#db.prepare('SELECT MAX(version) AS version FROM proposals WHERE tenant=? AND id=?').get(tenantId, proposalId).version;
      if (current !== null && version <= current) fail('PROPOSAL_VERSION_CONFLICT');
      this.#db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?,?,?,?)')
        .run(tenantId, proposalId, version, hash, action, actorHash(principal), costLimit, this.#clock());
      this.#event(tenantId, 'proposal.submitted', hash, principal);
      return { tenantId, proposalId, version, hash, action };
    });
  }
  #proposal(reference) {
    if (!reference || typeof reference !== 'object' || typeof reference.tenantId !== 'string'
      || !TENANT.test(reference.tenantId) || typeof reference.proposalId !== 'string'
      || !ID.test(reference.proposalId) || !Number.isSafeInteger(reference.version)
      || reference.version < 1 || typeof reference.hash !== 'string' || !HASH.test(reference.hash)) fail('INVALID_REFERENCE');
    const { tenantId, proposalId, version, hash } = reference;
    const row = this.#db.prepare(`SELECT * FROM proposals WHERE tenant=? AND id=? AND version=?
      AND version=(SELECT MAX(version) FROM proposals WHERE tenant=? AND id=?)`)
      .get(tenantId, proposalId, version, tenantId, proposalId);
    if (!row || row.hash !== hash) fail('PROPOSAL_CHANGED');
    return row;
  }
  approve(reference, principal, { ttlMs = 300000 } = {}) {
    this.#identity(principal, reference?.tenantId, 'reviewer', true);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900000) fail('INVALID_APPROVAL_TTL');
    return this.#transaction(() => {
      const proposal = this.#proposal(reference);
      if (proposal.submitter === actorHash(principal)) fail('SELF_APPROVAL_DENIED');
      const approvalId = randomUUID(), expiresAt = Math.min(this.#clock() + ttlMs, principal.expiresAt);
      this.#db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,NULL)')
        .run(approvalId, proposal.tenant, proposal.id, proposal.version, proposal.hash, actorHash(principal), expiresAt);
      this.#event(proposal.tenant, 'proposal.approved', approvalId, principal);
      return { approvalId, expiresAt, tenantId: proposal.tenant, proposalId: proposal.id,
        version: proposal.version, hash: proposal.hash, action: proposal.action };
    });
  }
  #consume(reference, approvalId, principal) {
    const proposal = this.#proposal(reference);
    if (typeof approvalId !== 'string' || !/^[a-f0-9-]{36}$/.test(approvalId)) fail('INVALID_APPROVAL');
    const approval = this.#db.prepare('SELECT * FROM approvals WHERE id=?').get(approvalId);
    if (!approval || approval.tenant !== proposal.tenant || approval.proposal !== proposal.id
      || approval.version !== proposal.version || approval.hash !== proposal.hash) fail('APPROVAL_MISMATCH');
    if (approval.consumed !== null) fail('APPROVAL_REPLAY');
    if (approval.expires <= this.#clock()) fail('APPROVAL_EXPIRED');
    if (this.#db.prepare('SELECT id FROM receipts WHERE tenant=? AND hash=?').get(proposal.tenant, proposal.hash)) fail('PROPOSAL_ALREADY_CONSUMED');
    this.#db.prepare('UPDATE approvals SET consumed=? WHERE id=? AND consumed IS NULL').run(this.#clock(), approvalId);
    const receiptId = randomUUID();
    this.#db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?)')
      .run(receiptId, approvalId, proposal.tenant, proposal.hash, actorHash(principal), this.#clock());
    this.#event(proposal.tenant, 'approval.consumed', receiptId, principal);
    return { receiptId, approvalId, hash: proposal.hash, tenantId: proposal.tenant,
      proposalId: proposal.id, version: proposal.version, expiresAt: approval.expires,
      action: proposal.action, scope: 'local-approval-receipt-only' };
  }
  consumeApproval(reference, approvalId, principal) {
    this.#identity(principal, reference?.tenantId, 'executor');
    return this.#transaction(() => {
      if (this.#proposal(reference).action !== 'draft.public-sources.review') fail('PAID_RESERVATION_REQUIRED');
      return this.#consume(reference, approvalId, principal);
    });
  }
  reservePaid(reference, approvalId, reservationId, maximumMicros, principal) {
    this.#identity(principal, reference?.tenantId, 'executor');
    if (!this.#paidEnabled) fail('PAID_CALLS_DISABLED');
    if (typeof reservationId !== 'string' || !ID.test(reservationId)
      || !money(maximumMicros) || maximumMicros < 1) fail('INVALID_RESERVATION');
    return this.#transaction(() => {
      const proposal = this.#proposal(reference);
      if (proposal.action !== 'ai.draft.preview') fail('PAID_ACTION_DENIED');
      if (maximumMicros > proposal.cost_limit) fail('APPROVED_COST_EXCEEDED');
      if (this.#db.prepare('SELECT tenant FROM blocks WHERE tenant=?').get(reference.tenantId)) fail('BUDGET_BLOCKED');
      if (this.#db.prepare('SELECT id FROM reservations WHERE id=?').get(reservationId)) fail('RESERVATION_REPLAY');
      const day = new Date(this.#clock()).toISOString().slice(0, 10);
      // Started/held reservations remain charged until reconciliation, even after a restart.
      // An unresolved request from a previous day also holds today's capacity.
      const used = this.#db.prepare(`SELECT COALESCE(SUM(CASE WHEN state IN ('held','started') THEN maximum
        ELSE actual END),0) AS amount FROM reservations WHERE tenant=? AND
        (state IN ('held','started') OR (day=? AND state IN ('settled','overrun')))`)
        .get(reference.tenantId, day).amount;
      const limit = this.#limits[reference.tenantId] ?? 0;
      if (!money(used) || maximumMicros > limit || used > limit - maximumMicros) fail('BUDGET_EXCEEDED');
      const receipt = this.#consume(reference, approvalId, principal);
      this.#db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,NULL,?)')
        .run(reservationId, reference.tenantId, approvalId, actorHash(principal), day, maximumMicros, 'held', this.#clock());
      this.#event(reference.tenantId, 'budget.reserved', reservationId, principal);
      return { ...receipt, reservationId, maximumMicros, day, state: 'held', providerCalled: false };
    });
  }
  #reservation(tenantId, reservationId, principal) {
    this.#identity(principal, tenantId, 'executor');
    if (typeof reservationId !== 'string' || !ID.test(reservationId)) fail('INVALID_RESERVATION');
    const row = this.#db.prepare('SELECT * FROM reservations WHERE tenant=? AND id=?').get(tenantId, reservationId);
    if (!row || row.executor !== actorHash(principal)) fail('RESERVATION_DENIED');
    return row;
  }
  markStarted(tenantId, reservationId, principal) {
    return this.#transaction(() => {
      const row = this.#reservation(tenantId, reservationId, principal);
      if (row.state !== 'held') fail('RESERVATION_STATE_DENIED');
      const approval = this.#db.prepare('SELECT * FROM approvals WHERE id=?').get(row.approval);
      if (!approval || approval.expires <= this.#clock()) fail('APPROVAL_EXPIRED');
      this.#proposal({ tenantId, proposalId: approval.proposal, version: approval.version, hash: approval.hash });
      this.#db.prepare("UPDATE reservations SET state='started' WHERE id=?").run(reservationId);
      this.#event(tenantId, 'budget.started', reservationId, principal);
      return { state: 'started', reservationId };
    });
  }
  cancelBeforeStart(tenantId, reservationId, principal) {
    return this.#transaction(() => {
      const row = this.#reservation(tenantId, reservationId, principal);
      if (row.state !== 'held') fail('RESERVATION_STATE_DENIED');
      this.#db.prepare("UPDATE reservations SET state='cancelled',actual=0 WHERE id=?").run(reservationId);
      this.#event(tenantId, 'budget.cancelled', reservationId, principal);
      return { state: 'cancelled', reservationId };
    });
  }
  reconcile(tenantId, reservationId, actualMicros, principal) {
    if (!money(actualMicros)) fail('INVALID_COST');
    return this.#transaction(() => {
      const row = this.#reservation(tenantId, reservationId, principal);
      if (row.state !== 'started') fail('RESERVATION_STATE_DENIED');
      const overrun = actualMicros > row.maximum, state = overrun ? 'overrun' : 'settled';
      this.#db.prepare('UPDATE reservations SET state=?,actual=? WHERE id=?').run(state, actualMicros, reservationId);
      if (overrun) this.#db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?)').run(tenantId, 'RESERVATION_OVERRUN');
      this.#event(tenantId, overrun ? 'budget.overrun' : 'budget.reconciled', reservationId, principal);
      return { state, reservationId, actualMicros, tenantBlocked: overrun };
    });
  }
  events(tenantId, principal) {
    this.#identity(principal, tenantId, 'auditor');
    try { return this.#db.prepare('SELECT type,reference,actor_hash AS actorHash,at FROM events WHERE tenant=? ORDER BY id DESC LIMIT 100').all(tenantId); }
    catch { fail('GOVERNANCE_UNAVAILABLE'); }
  }
  readiness() {
    try {
      const healthy = this.#db.prepare('PRAGMA quick_check').get().quick_check === 'ok';
      return { localStoreReady: healthy, paidCallsEnabled: this.#paidEnabled,
        humanIdentityConfigured: false, scope: 'local-library-only' };
    } catch { return { localStoreReady: false, paidCallsEnabled: false,
      humanIdentityConfigured: false, scope: 'local-library-only' }; }
  }
}
