import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable, PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeBridge, describeRuntime, runJsonLines } from '../src/runtime-bridge.mjs';
import { createHub } from '../src/hub.mjs';
import { FileLedger } from '../src/ledger.mjs';
import { createReadOnlyServer, listenLocal } from '../src/service.mjs';

const aggregate = { sampleCount: 1, stages: { qualified: 1 }, hasMore: false, scope: 'sample-only' };
const request = { id: 'call-1', tool: 'radar_crm_preview', arguments: {} };
function setup(options = {}) {
  let calls = 0;
  const tool = { name: 'radar_crm_preview', async execute(id, args, signal) {
    calls++; assert.equal(typeof id, 'string'); assert.deepEqual(args, {});
    assert.ok(signal instanceof AbortSignal);
    if (options.execute) return options.execute(id, args, signal);
    return { details: aggregate };
  } };
  return { bridge: createRuntimeBridge({ tool, ...options }), calls: () => calls };
}
async function run(chunks, bridge = setup().bridge, extra = {}) {
  let text = '';
  const output = new Writable({ write(chunk, encoding, callback) { text += chunk.toString(); callback(); } });
  await runJsonLines({ input: Readable.from(chunks), output, bridge, ...extra });
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function cli(argv = [], input = '', env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/runtime-cli.mjs', ...argv], {
      cwd: new URL('../', import.meta.url),
      env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

test('bridge publica somente ferramenta e schema sem autoridade ou credenciais', () => {
  const descriptor = describeRuntime();
  assert.equal(descriptor.protocol, 'radar-jsonl-v1');
  assert.deepEqual(descriptor.tools.map(tool => tool.name), ['radar_crm_preview']);
  assert.deepEqual(descriptor.tools[0].arguments, { type: 'object', properties: {}, additionalProperties: false });
  assert.equal(descriptor.request.additionalProperties, false);
  for (const field of ['token', 'tenantId', 'endpoint', 'providerConfigKey']) {
    assert.ok(!Object.hasOwn(descriptor.request.properties, field));
  }
});
test('bridge reutiliza tool read-only e retorna somente aggregate', async () => {
  const { bridge, calls } = setup();
  assert.deepEqual(await bridge.handle(request), { id: 'call-1', ok: true, result: aggregate });
  assert.equal(calls(), 1);
});
for (const [label, input, code] of [
  ['tool desconhecida', { ...request, tool: 'execute_shell' }, 'TOOL_DENIED'],
  ['tenant no envelope', { ...request, tenantId: 'other' }, 'INVALID_RUNTIME_REQUEST'],
  ['contexto autenticado no envelope', { ...request, authenticatedTenantId: 'other' }, 'INVALID_RUNTIME_REQUEST'],
  ['tenant nos argumentos', { ...request, arguments: { tenantId: 'other' } }, 'INVALID_TOOL_ARGUMENTS'],
  ['url nos argumentos', { ...request, arguments: { url: 'https://evil.test' } }, 'INVALID_TOOL_ARGUMENTS'],
  ['binding nos argumentos', { ...request, arguments: { connectionId: 'other' } }, 'INVALID_TOOL_ARGUMENTS'],
  ['escrita', { ...request, arguments: { action: 'crm.deals.create' } }, 'INVALID_TOOL_ARGUMENTS'],
  ['id grande', { ...request, id: 'x'.repeat(65) }, 'INVALID_RUNTIME_REQUEST'],
  ['id com path', { ...request, id: '../key' }, 'INVALID_RUNTIME_REQUEST'],
  ['lista de argumentos', { ...request, arguments: [] }, 'INVALID_TOOL_ARGUMENTS'],
  ['args ausentes', { id: request.id, tool: request.tool }, 'INVALID_RUNTIME_REQUEST'],
  ['array', [], 'INVALID_RUNTIME_REQUEST'],
  ['null', null, 'INVALID_RUNTIME_REQUEST']
]) test('bridge bloqueia ' + label + ' antes da rede', async () => {
  const { bridge, calls } = setup();
  const response = await bridge.handle(input);
  assert.equal(response.ok, false); assert.equal(response.error.code, code); assert.equal(calls(), 0);
});
test('tentativas inválidas consomem limite da sessão e encerram sem executar', async () => {
  const { bridge, calls } = setup({ maxCalls: 1 });
  assert.equal((await bridge.handleLine(Buffer.from('{'))).error.code, 'INVALID_JSON');
  assert.equal((await bridge.handle(request)).error.code, 'RUNTIME_CALL_LIMIT');
  assert.equal((await bridge.handle(request)).error.code, 'RUNTIME_CLOSED'); assert.equal(calls(), 0);
});
test('bridge não executa chamadas em paralelo', async () => {
  let complete;
  const { bridge, calls } = setup({ execute: () => new Promise(resolve => { complete = resolve; }) });
  const first = bridge.handle(request);
  assert.equal((await bridge.handle({ ...request, id: 'second' })).error.code, 'RUNTIME_BUSY');
  complete({ details: aggregate });
  assert.equal((await first).ok, true); assert.equal(calls(), 1);
});
test('timeout aborta transporte e sela sessão mesmo se adapter ignorar cancelamento', async () => {
  let signal;
  const { bridge, calls } = setup({ timeoutMs: 25,
    execute: (id, args, value) => { signal = value; return new Promise(() => {}); } });
  const response = await bridge.handle(request);
  assert.equal(response.error.code, 'RUNTIME_TIMEOUT'); assert.equal(signal.aborted, true);
  assert.equal((await bridge.handle({ ...request, id: 'second' })).error.code, 'RUNTIME_CLOSED');
  assert.equal(calls(), 1);
});
test('erro upstream é reduzido sem mensagem sensível e sem retry', async () => {
  const { bridge, calls } = setup({ execute: () => { throw new Error('operator-secret-token'); } });
  assert.deepEqual(await bridge.handle(request), { id: 'call-1', ok: false, error: { code: 'HUB_REQUEST_FAILED' } });
  assert.equal(calls(), 1);
});
test('framing suporta chunks divididos, CRLF e último frame em EOF', async () => {
  const { bridge, calls } = setup();
  const bytes = Buffer.from(JSON.stringify(request) + '\r\n' + JSON.stringify({ ...request, id: 'second' }));
  const responses = await run([bytes.subarray(0, 5), bytes.subarray(5, 31), bytes.subarray(31)], bridge);
  assert.deepEqual(responses.map(response => [response.id, response.ok]), [['call-1', true], ['second', true]]);
  assert.equal(calls(), 2);
});
test('linha excessiva encerra sem interpretar JSON ou chamar a tool', async () => {
  const { bridge, calls } = setup({ maxInputBytes: 128 });
  assert.deepEqual(await run([Buffer.from('x'.repeat(129) + '\n' + JSON.stringify(request))], bridge),
    [{ id: null, ok: false, error: { code: 'INPUT_TOO_LARGE' } }]);
  assert.equal(calls(), 0); assert.equal(bridge.closed, true);
});
test('UTF8 inválido falha fechado', async () => {
  const { bridge, calls } = setup();
  assert.deepEqual(await run([Buffer.from([0xff, 0x0a])], bridge),
    [{ id: null, ok: false, error: { code: 'INVALID_UTF8' } }]);
  assert.equal(calls(), 0);
});
test('sessão ociosa encerra em deadline limitado', async () => {
  const input = new PassThrough(); let text = '';
  const output = new Writable({ write(chunk, encoding, callback) { text += chunk; callback(); } });
  const { bridge, calls } = setup();
  await runJsonLines({ input, output, bridge, sessionTimeoutMs: 25 });
  assert.deepEqual(JSON.parse(text), { id: null, ok: false, error: { code: 'RUNTIME_SESSION_TIMEOUT' } });
  assert.equal(calls(), 0); assert.equal(input.destroyed, true);
});
test('deadline da sessão cancela chamada ativa sem emitir resultado tardio', async () => {
  const { bridge, calls } = setup({ execute: () => new Promise(() => {}) });
  assert.deepEqual(await run([Buffer.from(JSON.stringify(request) + '\n')], bridge, { sessionTimeoutMs: 25 }),
    [{ id: null, ok: false, error: { code: 'RUNTIME_SESSION_TIMEOUT' } }]);
  assert.equal(calls(), 1); assert.equal(bridge.closed, true);
});
test('limites fora do intervalo são recusados no startup', () => {
  for (const options of [{ maxCalls: 0 }, { maxCalls: 11 }, { timeoutMs: 0 }, { timeoutMs: 6001 },
    { maxInputBytes: 4097 }]) assert.throws(() => setup(options), { code: 'INVALID_RUNTIME_LIMIT' });
});
test('CLI descreve contrato sem token e falha fechado sem credencial', async () => {
  const describe = await cli(['--describe']);
  assert.equal(describe.code, 0); assert.equal(JSON.parse(describe.stdout).protocol, 'radar-jsonl-v1');
  const missing = await cli([], JSON.stringify(request) + '\n');
  assert.equal(missing.code, 1); assert.equal(missing.stdout, '');
  assert.ok(missing.stderr.includes('RUNTIME_START_FAILED'));
});
test('CLI recusa flags desconhecidas, duplicadas e --live', async () => {
  for (const argv of [['--live'], ['--describe', '--max-calls', '1'],
    ['--max-calls', '1', '--max-calls', '2'], ['--timeout-ms', '1.5']]) {
    const result = await cli(argv); assert.equal(result.code, 1); assert.equal(result.stdout, '');
  }
});
test('CLI real -> transporte existente -> HTTP loopback -> Hub; identidade e replay governados', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'radar-runtime-test-'));
  const token = randomBytes(32).toString('base64url');
  let calls = 0; const identities = [];
  const hub = createHub({ ledger: new FileLedger(directory),
    bindings: { 'operator-tenant': { connectionId: 'trusted-binding' } },
    adapter: { async listDeals(binding) {
      calls++; identities.push(binding.connectionId);
      return { results: [{ id: 'private-id', properties: { name: 'private-name', dealstage: 'qualified' } }] };
    } } });
  const server = createReadOnlyServer({ hub, token, tenantId: 'operator-tenant' });
  try {
    const address = await listenLocal(server, 0);
    const env = { RADAR_SERVICE_TOKEN: token,
      RADAR_HUB_ENDPOINT: 'http://127.0.0.1:' + address.port + '/v1/crm/deals/preview' };
    const frames = [request, { ...request, tenantId: 'victim' }, { ...request, id: 'one', tool: 'shell' }, request];
    const result = await cli([], frames.map(value => JSON.stringify(value)).join('\n') + '\n', env);
    assert.equal(result.code, 0); assert.equal(result.stderr, '');
    const responses = result.stdout.trim().split('\n').map(value => JSON.parse(value));
    assert.deepEqual(responses[0], { id: 'call-1', ok: true, result: aggregate });
    assert.deepEqual(responses.slice(1).map(value => value.error.code),
      ['INVALID_RUNTIME_REQUEST', 'TOOL_DENIED', 'HUB_REQUEST_FAILED']);
    assert.equal(calls, 1); assert.deepEqual(identities, ['trusted-binding']);
    for (const forbidden of [token, 'operator-tenant', 'private-id', 'private-name', 'trusted-binding']) {
      assert.ok(!result.stdout.includes(forbidden));
    }
    // Restarting the bridge preserves the same call-id hash in the server ledger.
    const replay = await cli([], JSON.stringify(request) + '\n', env);
    assert.equal(JSON.parse(replay.stdout).error.code, 'HUB_REQUEST_FAILED'); assert.equal(calls, 1);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
