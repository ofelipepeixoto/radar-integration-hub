// Copyright (c) 2026 Carlos Felipe. MIT. Export only; live n8n not assumed.
import { buildN8nPreviewWorkflow, createN8nRequestId, validateN8nPreviewResponse } from './n8n-workflow.mjs';
export function validateHermesResponse(value) {
  if (!value || value.version !== 'radar.hermes.result.v1' || value.ok !== true || value.paidCallsEnabled !== false
    || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) throw new Error('INVALID_WORKER_RESULT');
  const result = validateN8nPreviewResponse({ tenantId:'internal', action:'crm.deals.preview', ...value.result });
  return { id: value.id, status:'review-required', paidCallsEnabled:false, result };
}
export function buildHermesWorkflow() {
  const flow = buildN8nPreviewWorkflow();
  flow.name = 'Radar Hermes — worker interno somente leitura';
  flow.settings.executionTimeout = 20;
  flow.nodes[1].parameters.jsCode = createN8nRequestId.toString()
    + '\nreturn [{json:{version:"radar.hermes.job.v1",id:createN8nRequestId($execution.id),tool:"radar_crm_preview",arguments:{}}}];';
  flow.nodes[2].parameters.url = 'http://127.0.0.1:8788/v1/hermes/preview';
  flow.nodes[2].parameters.jsonBody = '={{ JSON.stringify($json) }}';
  flow.nodes[2].parameters.options.timeout = 12000;
  // Response normalizer dependency is embedded in exported Code node.
  const exact = `function hasExactKeys(value, keys) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key)); }`;
  flow.nodes[3].parameters.jsCode = exact + '\n' + createN8nRequestId.toString() + '\n' + validateN8nPreviewResponse.toString()
    + '\n' + validateHermesResponse.toString() + '\nconst items=$input.all();'
    + '\nif(items.length!==1 || items[0].json.id!==createN8nRequestId($execution.id)) throw new Error("INVALID_WORKER_RESULT");'
    + '\nreturn [{json:validateHermesResponse(items[0].json)}];';
  return flow;
}
