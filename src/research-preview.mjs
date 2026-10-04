// Copyright (c) 2026 Carlos Felipe. SPDX-License-Identifier: MIT
// Original offline consumer; no Odysseus code or external action adapter.
import { createHash } from 'node:crypto';
import { HubError } from './errors.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = code => { throw new HubError(code); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function fields(value, names) {
  return plain(value) && Object.keys(value).length === names.length
    && names.every(name => Object.hasOwn(value, name));
}
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000;
const identifier = value => typeof value === 'string' && value.trim().length > 0
  && [...value].length <= 256 && Buffer.from(value, 'utf8').toString('utf8') === value;

export function validateResearchPreview(result, tenantId, projectId) {
  const denied = () => fail('EVIDENCE_PREVIEW_DENIED');
  if (!fields(result, ['schema', 'tenantId', 'projectId', 'groups', 'includedOccurrences',
    'excludedRecords', 'duplicateRecords', 'decision', 'paidCallsEnabled',
    'externalActionsEnabled', 'issuerVerified', 'scope'])
    || result.schema !== 'radar-research-preview-v1' || result.tenantId !== tenantId
    || result.projectId !== projectId || result.paidCallsEnabled !== false
    || result.externalActionsEnabled !== false || result.issuerVerified !== false
    || result.scope !== 'offline-evidence-preview' || !Array.isArray(result.groups)
    || result.groups.length > 1000 || !count(result.includedOccurrences)
    || !count(result.excludedRecords) || !count(result.duplicateRecords)
    || result.includedOccurrences + result.excludedRecords + result.duplicateRecords > 1000
    || result.decision !== (result.groups.length ? 'needs_review' : 'abstained')) denied();
  let total = 0;
  const contentIds = new Set(), occurrenceIds = new Set();
  for (const group of result.groups) {
    if (!fields(group, ['contentId', 'textSha256', 'text', 'occurrences'])
      || typeof group.text !== 'string' || Buffer.byteLength(group.text) > 16384
      || Buffer.from(group.text, 'utf8').toString('utf8') !== group.text
      || group.textSha256 !== digest(group.text)
      || group.contentId !== digest(JSON.stringify(['radar-content-v1', tenantId, projectId, group.textSha256]))
      || contentIds.has(group.contentId) || !Array.isArray(group.occurrences)
      || !group.occurrences.length || group.occurrences.length > 1000) denied();
    contentIds.add(group.contentId);
    const characters = [...group.text];
    for (const item of group.occurrences) {
      if (!fields(item, ['occurrenceId', 'evidenceId', 'documentId', 'revision',
        'page', 'start', 'end', 'sourceSha256', 'quote']) || !identifier(item.documentId)
        || typeof item.evidenceId !== 'string' || !HASH.test(item.evidenceId)
        || typeof item.sourceSha256 !== 'string' || !HASH.test(item.sourceSha256)
        || !Number.isSafeInteger(item.revision) || item.revision < 1
        || !Number.isSafeInteger(item.page) || item.page < 1
        || !Number.isSafeInteger(item.start) || item.start < 0
        || !Number.isSafeInteger(item.end) || item.end <= item.start || item.end > characters.length
        || item.quote !== characters.slice(item.start, item.end).join('')
        || item.occurrenceId !== digest(JSON.stringify(['radar-occurrence-v1', tenantId,
          projectId, item.documentId, item.revision, item.page, item.start, item.end,
          item.sourceSha256, group.textSha256])) || occurrenceIds.has(item.occurrenceId)) denied();
      occurrenceIds.add(item.occurrenceId);
      if (++total > 1000) denied();
    }
  }
  if (total !== result.includedOccurrences) denied();
  // Structural integrity does not authenticate the source/reviewer or verify truth.
  return structuredClone(result);
}

export function createResearchPreview({ tenantId, projectId, ledger, readEvidence }) {
  if (typeof tenantId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(tenantId)
    || !identifier(projectId) || typeof ledger?.reserve !== 'function'
    || typeof readEvidence !== 'function') fail('INVALID_RESEARCH_CONFIG');
  return {
    async execute(request, authenticatedTenantId) {
      if (authenticatedTenantId !== tenantId) fail('TENANT_DENIED');
      // Request cannot choose identity, action, source, URL, model or budget.
      if (!fields(request, ['requestId']) || typeof request.requestId !== 'string'
        || !ID.test(request.requestId)) fail('RESEARCH_REQUEST_DENIED');
      await ledger.reserve(tenantId, request.requestId);
      let result;
      try { result = await readEvidence(); }
      catch { fail('EVIDENCE_PREVIEW_DENIED'); }
      return { requestId: request.requestId,
        ...validateResearchPreview(result, tenantId, projectId) };
    }
  };
}
