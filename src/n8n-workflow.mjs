// Copyright (c) 2026 Carlos Felipe. MIT. Original Radar implementation.
// Export only. No n8n runtime, upstream code, credentials or network calls.
export const HUB_PREVIEW_ENDPOINT = 'http://127.0.0.1:8787/v1/crm/deals/preview';

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

export function createN8nRequestId(executionId) {
  if (typeof executionId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(executionId)) {
    throw new Error('INVALID_N8N_EXECUTION_ID');
  }
  return 'n8n_' + executionId;
}

export function validateN8nPreviewResponse(value) {
  const fail = () => { throw new Error('INVALID_HUB_PREVIEW_RESPONSE'); };
  if (!hasExactKeys(value, ['tenantId', 'action', 'sampleCount', 'stages', 'hasMore', 'scope'])
    || typeof value.tenantId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.tenantId)
    || value.action !== 'crm.deals.preview' || value.scope !== 'sample-only'
    || !Number.isInteger(value.sampleCount) || value.sampleCount < 0 || value.sampleCount > 10
    || typeof value.hasMore !== 'boolean'
    || !value.stages || typeof value.stages !== 'object' || Array.isArray(value.stages)) fail();
  const entries = Object.entries(value.stages);
  if (entries.length > 10 || entries.some(([stage, count]) =>
    !/^[A-Za-z0-9_-]{1,80}$/.test(stage)
    || ['__proto__', 'constructor', 'prototype'].includes(stage)
    || !Number.isInteger(count) || count < 1 || count > 10)
    || entries.reduce((total, [, count]) => total + count, 0) !== value.sampleCount) fail();
  // Project aggregate data only. Do not pass tenant identifiers or raw response through.
  return {
    scope: 'sample-only',
    sampleCount: value.sampleCount,
    stages: Object.fromEntries(entries),
    hasMore: value.hasMore,
    note: 'Amostra de até 10 negócios; não representa o funil completo nem receita.'
  };
}

export function buildN8nPreviewWorkflow() {
  const prepareCode = createN8nRequestId.toString()
    + '\nreturn [{ json: { requestId: createN8nRequestId($execution.id) } }];';
  const validateCode = hasExactKeys.toString() + '\n' + createN8nRequestId.toString()
    + '\n' + validateN8nPreviewResponse.toString()
    + '\nconst items = $input.all();'
    + '\nif (items.length !== 1) throw new Error("INVALID_HUB_PREVIEW_RESPONSE");'
    + '\nconst requestId = createN8nRequestId($execution.id);'
    + '\nconst preview = validateN8nPreviewResponse(items[0].json);'
    + '\nreturn [{ json: { requestId, source: "radar-integration-hub", status: "validated", ...preview } }];';
  return {
    name: 'Radar Hub — consulta CRM interna somente leitura',
    active: false,
    nodes: [
      { id: 'radar-manual', name: 'Iniciar consulta local', type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1, position: [0, 0], parameters: {} },
      { id: 'radar-request', name: 'Preparar consulta', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [240, 0],
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareCode } },
      { id: 'radar-http', name: 'Consultar Hub interno', type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.4, position: [480, 0], retryOnFail: false, continueOnFail: false,
        parameters: {
          method: 'POST', url: HUB_PREVIEW_ENDPOINT,
          authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
          sendBody: true, contentType: 'json', specifyBody: 'json',
          jsonBody: '={{ JSON.stringify({ requestId: $json.requestId }) }}',
          options: {
            timeout: 6000,
            redirect: { redirect: { followRedirects: false } },
            sendCredentialsOnCrossOriginRedirect: false,
            response: { response: { responseFormat: 'json', fullResponse: false, neverError: false } }
          }
        } },
      { id: 'radar-evidence', name: 'Validar e exibir evidência', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [720, 0],
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: validateCode } }
    ],
    connections: {
      'Iniciar consulta local': { main: [[{ node: 'Preparar consulta', type: 'main', index: 0 }]] },
      'Preparar consulta': { main: [[{ node: 'Consultar Hub interno', type: 'main', index: 0 }]] },
      'Consultar Hub interno': { main: [[{ node: 'Validar e exibir evidência', type: 'main', index: 0 }]] }
    },
    settings: { executionOrder: 'v1', executionTimeout: 15 },
    pinData: {},
    tags: []
  };
}
