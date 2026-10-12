// Copyright (c) 2026 Carlos Felipe. MIT. Original implementation; no upstream code copied.
import { HubError } from './errors.mjs';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 16384;
const fail = code => { throw new HubError(code); };

// Evidence IDs are supplied by the trusted application, never discovered from model output.
export function validateDraftProposal(raw, evidenceIds) {
  if (!Array.isArray(evidenceIds) || evidenceIds.length < 1 || evidenceIds.length > 100
    || evidenceIds.some(id => typeof id !== 'string' || !ID.test(id))
    || new Set(evidenceIds).size !== evidenceIds.length) fail('INVALID_EVIDENCE_SCOPE');
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES) return { ok: false, reason: 'INVALID_JSON' };
  let value;
  try { value = JSON.parse(raw); } catch { return { ok: false, reason: 'INVALID_JSON' }; }
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'text') || !Object.hasOwn(value, 'evidenceIds')
    || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 4000
    || !Array.isArray(value.evidenceIds) || value.evidenceIds.length < 1 || value.evidenceIds.length > 20
    || value.evidenceIds.some(id => typeof id !== 'string' || !ID.test(id))
    || new Set(value.evidenceIds).size !== value.evidenceIds.length) return { ok: false, reason: 'INVALID_SCHEMA' };
  const allowed = new Set(evidenceIds);
  if (value.evidenceIds.some(id => !allowed.has(id))) return { ok: false, reason: 'UNKNOWN_EVIDENCE' };
  return { ok: true, payload: Object.freeze({ text: value.text.trim(), evidenceIds: Object.freeze([...value.evidenceIds]) }) };
}

// A local proposal builder. No transport, credentials, authorization, approval or execution.
// A trusted caller supplies a producer; attempts may only produce text, never execute actions.
export async function buildDraftProposal({ produce, evidenceIds }) {
  if (typeof produce !== 'function') fail('INVALID_PRODUCER');
  // Validate scope before invoking even the first attempt.
  validateDraftProposal('{}', evidenceIds);
  const scope = Object.freeze([...evidenceIds]);
  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw;
    try { raw = await produce(Object.freeze({ attempt, repair: attempt === 2,
      evidenceIds: scope })); }
    catch { return { ok: false, attempts: attempt, reason: 'PRODUCER_FAILED' }; }
    const checked = validateDraftProposal(raw, scope);
    if (checked.ok) return { ...checked, attempts: attempt, scope: 'unapproved-local-draft' };
    if (attempt === 2) return { ok: false, attempts: attempt, reason: checked.reason };
  }
}
