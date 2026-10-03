// Copyright (c) 2026 Carlos Felipe. MIT. Allowlisted events; no body/header logging.
import { createHash } from 'node:crypto';
const OUTCOMES = new Set(['SUCCESS', 'SERVICE_UNAVAILABLE', 'UNAUTHORIZED', 'NOT_FOUND',
  'METHOD_DENIED', 'JSON_REQUIRED', 'BODY_TOO_LARGE', 'INVALID_REQUEST', 'NOT_READY',
  'DUPLICATE_REQUEST', 'DAILY_QUOTA_EXCEEDED', 'LEDGER_BUSY', 'LEDGER_UNAVAILABLE',
  'LEDGER_CORRUPT', 'UPSTREAM_RATE_LIMIT', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_REJECTED',
  'INVALID_UPSTREAM_RESULTS', 'INVALID_UPSTREAM_FORMAT', 'UPSTREAM_BODY_TOO_LARGE']);

export function serviceEvent({ action, outcome, status, requestId, durationMs }) {
  return {
    schemaVersion: 1, component: 'radar-hub-readonly',
    action: ['crm.deals.preview', 'health.check', 'readiness.check'].includes(action) ? action : 'crm.deals.preview',
    outcome: OUTCOMES.has(outcome) ? outcome : 'SERVICE_UNAVAILABLE',
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 503,
    durationMs: Number.isSafeInteger(durationMs) && durationMs >= 0 ? durationMs : 0,
    // Even a schema-valid request ID may contain a pasted secret. Correlate by digest.
    ...(typeof requestId === 'string' ? { requestIdHash: createHash('sha256').update(requestId).digest('hex') } : {})
  };
}
