// Copyright (c) 2026 Carlos Felipe. MIT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { createHub } from '../src/hub.mjs';
import { FileLedger } from '../src/ledger.mjs';
import { createReadOnlyServer, listenLocal } from '../src/service.mjs';
import { HUB_PREVIEW_ENDPOINT, buildN8nPreviewWorkflow,
  createN8nRequestId, validateN8nPreviewResponse } from '../src/n8n-workflow.mjs';

const workflow = buildN8nPreviewWorkflow();
const requestNode = workflow.nodes.find(node => node.id === 'radar-request');
const httpNode = workflow.nodes.find(node => node.id === 'radar-http');
const evidenceNode = workflow.nodes.find(node => node.id === 'radar-evidence');
const valid = { tenantId: 'camaleao-demo', action: 'crm.deals.preview', sampleCount: 3,
  stages: { appointmentscheduled: 1, qualifiedtobuy: 2 }, hasMore: false, scope: 'sample-only' };
const normalize = value => JSON.parse(JSON.stringify(value));
function executeCode(node, context) {
  // Execute the exact exported JavaScript in a bounded test context. This is NOT n8n E2E.
  const script = new Script('(function () {\n' + node.parameters.jsCode + '\n})()');
  return normalize(script.runInNewContext(context, { timeout: 1000 }));
}

test('export versionado é idêntico ao gerador; não contém credenciais ou pinData', async () => {
  const checkedIn = JSON.parse(await readFile(
    new URL('../workflows/n8n/crm-preview-internal.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkedIn, workflow);
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  assert.equal(workflow.nodes.length, 4);
  assert.deepEqual(workflow.nodes.map(node => node.type), [
    'n8n-nodes-base.manualTrigger', 'n8n-nodes-base.code',
    'n8n-nodes-base.httpRequest', 'n8n-nodes-base.code'
  ]);
  assert.ok(workflow.nodes.every(node => !Object.hasOwn(node, 'credentials')));
});

test('destino/ação/headers não derivam de entrada; sem redirects, retries ou bypass de falha', () => {
  assert.equal(httpNode.parameters.url, HUB_PREVIEW_ENDPOINT);
  assert.equal(httpNode.parameters.url, 'http://127.0.0.1:8787/v1/crm/deals/preview');
  assert.equal(httpNode.parameters.method, 'POST');
  assert.equal(httpNode.parameters.authentication, 'genericCredentialType');
  assert.equal(httpNode.parameters.genericAuthType, 'httpHeaderAuth');
  assert.equal(httpNode.parameters.options.redirect.redirect.followRedirects, false);
  assert.equal(httpNode.parameters.options.sendCredentialsOnCrossOriginRedirect, false);
  assert.equal(httpNode.parameters.options.timeout, 6000);
  assert.equal(httpNode.parameters.options.response.response.neverError, false);
  assert.equal(httpNode.retryOnFail, false);
  assert.equal(httpNode.continueOnFail, false);
  assert.equal(workflow.settings.executionTimeout, 15);
  assert.ok(!Object.hasOwn(httpNode.parameters, 'headerParameters'));
});

test('JavaScript exportado ignora entrada não confiável e corpo contém só requestId', () => {
  const prepared = executeCode(requestNode, { $execution: { id: 'exec_123' },
    $input: { all: () => [{ json: { tenantId: 'other', url: 'https://untrusted.invalid' } }] } });
  assert.deepEqual(prepared, [{ json: { requestId: 'n8n_exec_123' } }]);
  const expression = httpNode.parameters.jsonBody.slice(3, -2);
  const body = new Script(expression).runInNewContext({ $json: {
    ...prepared[0].json, tenantId: 'other', action: 'crm.deals.create', token: 'private-value'
  } }, { timeout: 1000 });
  assert.deepEqual(JSON.parse(body), { requestId: 'n8n_exec_123' });
});

test('requestId preserva identidade da execução e limite; replay conserva a mesma chave', () => {
  assert.equal(createN8nRequestId('42'), createN8nRequestId('42'));
  assert.notEqual(createN8nRequestId('42'), createN8nRequestId('43'));
  assert.equal(createN8nRequestId('a'.repeat(60)).length, 64);
  for (const id of ['', 'a'.repeat(61), '../other', '$(command)', {}, 12]) {
    assert.throws(() => createN8nRequestId(id), /INVALID_N8N_EXECUTION_ID/);
  }
  for (const id of [undefined, null, 12]) {
    assert.throws(() => executeCode(requestNode, { $execution: { id } }),
      /INVALID_N8N_EXECUTION_ID/);
  }
});

test('saída exportada valida contagens e remove tenant/raw response do contexto final', () => {
  const result = executeCode(evidenceNode, {
    $execution: { id: 'exec_123' }, $input: { all: () => [{ json: valid }] }
  });
  assert.equal(result[0].json.sampleCount, 3);
  assert.equal(result[0].json.requestId, 'n8n_exec_123');
  assert.equal(result[0].json.status, 'validated');
  assert.equal(result[0].json.scope, 'sample-only');
  assert.ok(!Object.hasOwn(result[0].json, 'tenantId'));
  assert.ok(!Object.hasOwn(result[0].json, 'action'));
  assert.deepEqual(result[0].json.stages, valid.stages);
});

const invalidCases = [
  ['campo pessoal inesperado', { ...valid, customerName: 'private-customer' }],
  ['tenant extra em formato inválido', { ...valid, tenantId: '../tenant' }],
  ['ação de escrita', { ...valid, action: 'crm.deals.create' }],
  ['funil completo alegado', { ...valid, scope: 'complete' }],
  ['volume acima da amostra', { ...valid, sampleCount: 11 }],
  ['contagem fracionária', { ...valid, sampleCount: 1.5 }],
  ['soma inconsistente', { ...valid, stages: { qualifiedtobuy: 2 } }],
  ['contagem negativa', { ...valid, stages: { qualifiedtobuy: -3 } }],
  ['estágios array', { ...valid, stages: [] }],
  ['estágio HTML', { ...valid, stages: { '<script>': 3 } }],
  ['chave de protótipo', { ...valid, stages: JSON.parse('{"__proto__":3}') }],
  ['paginação de tipo incorreto', { ...valid, hasMore: 'false' }],
  ['resposta de erro', { error: 'private-provider-value' }],
  ['lista como raiz', [valid]],
  ['raiz ausente', null]
];
for (const [label, value] of invalidCases) {
  test('falha fechada: ' + label + '; não devolve conteúdo recebido no erro', () => {
    assert.throws(() => validateN8nPreviewResponse(value),
      error => error.message === 'INVALID_HUB_PREVIEW_RESPONSE');
    assert.throws(() => executeCode(evidenceNode, { $execution: { id: 'exec_123' },
      $input: { all: () => [{ json: value }] } }), /INVALID_HUB_PREVIEW_RESPONSE/);
  });
}

test('resposta vazia válida é aceita; lote de respostas é bloqueado', () => {
  assert.equal(validateN8nPreviewResponse({ ...valid, sampleCount: 0, stages: {} }).sampleCount, 0);
  for (const items of [[], [{ json: valid }, { json: valid }]]) {
    assert.throws(() => executeCode(evidenceNode, { $execution: { id: '42' },
      $input: { all: () => items } }), /INVALID_HUB_PREVIEW_RESPONSE/);
  }
});

test('contrato HTTP real com Hub existente usa fixture, tenant do servidor, cota/replay e autenticação', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'radar-n8n-contract-'));
  const token = randomBytes(32).toString('base64url');
  let calls = 0;
  const fixture = JSON.parse(await readFile(new URL('../fixtures/deals.json', import.meta.url), 'utf8'));
  const hub = createHub({ bindings: { 'camaleao-demo': {} }, ledger: new FileLedger(directory),
    adapter: { async listDeals() { calls++; return fixture; } } });
  const server = createReadOnlyServer({ hub, token, tenantId: 'camaleao-demo' });
  try {
    const address = await listenLocal(server, 0);
    // Ephemeral port avoids occupying the operator's production port. Route/options match export.
    const endpoint = 'http://127.0.0.1:' + address.port + new URL(httpNode.parameters.url).pathname;
    const prepared = executeCode(requestNode, { $execution: { id: 'http_contract' } });
    const body = JSON.stringify(prepared[0].json);
    const send = (payload, auth = token) => fetch(endpoint, {
      method: httpNode.parameters.method, redirect: 'error',
      signal: AbortSignal.timeout(httpNode.parameters.options.timeout),
      headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
      body: payload
    });
    const first = await send(body);
    assert.equal(first.status, 200);
    const response = await first.json();
    const evidence = executeCode(evidenceNode, { $execution: { id: 'http_contract' },
      $input: { all: () => [{ json: response }] } });
    assert.equal(evidence[0].json.sampleCount, 3);
    assert.equal(evidence[0].json.requestId, 'n8n_http_contract');
    assert.equal((await send(body)).status, 409);
    assert.equal((await send(JSON.stringify({ ...prepared[0].json, tenantId: 'other' }))).status, 400);
    assert.equal((await send(JSON.stringify({ requestId: 'second' }), 'wrong-token')).status, 401);
    assert.equal(calls, 1);
    const ledger = JSON.parse(await readFile(join(directory, 'attempts.json'), 'utf8'));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].tenantId, 'camaleao-demo');
    assert.equal(ledger[0].requestId, 'n8n_http_contract');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
