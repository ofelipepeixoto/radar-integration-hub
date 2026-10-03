// Copyright (c) 2026 Carlos Felipe. MIT. Original protocol adapter; not MCP.
import { HubError } from './errors.mjs';

const TOOL_NAME = 'radar_crm_preview';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ERROR_CODES = new Set(['INVALID_RUNTIME_REQUEST', 'INVALID_TOOL_ARGUMENTS',
  'TOOL_DENIED', 'INVALID_JSON', 'INVALID_UTF8', 'INPUT_TOO_LARGE', 'RUNTIME_BUSY',
  'RUNTIME_CALL_LIMIT', 'RUNTIME_TIMEOUT', 'RUNTIME_SESSION_TIMEOUT',
  'RUNTIME_CLOSED', 'HUB_REQUEST_FAILED', 'INPUT_UNAVAILABLE']);

function limit(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new HubError('INVALID_RUNTIME_LIMIT');
  return value;
}
function failure(id, code) { return { id, ok: false, error: { code } }; }
function publicId(request) { return typeof request?.id === 'string' && ID.test(request.id) ? request.id : null; }

export function describeRuntime() {
  return {
    protocol: 'radar-jsonl-v1',
    tools: [{ name: TOOL_NAME, description: 'Contagens CRM amostrais, somente leitura.',
      arguments: { type: 'object', properties: {}, additionalProperties: false } }],
    request: { type: 'object', required: ['id', 'tool', 'arguments'], additionalProperties: false,
      properties: { id: { type: 'string', pattern: ID.source },
        tool: { const: TOOL_NAME }, arguments: { type: 'object', properties: {}, additionalProperties: false } } },
    limits: { maxInputBytes: 4096, maxCalls: 10, requestTimeoutMs: 6000, sessionTimeoutMs: 60000 }
  };
}

// The tool instance and limits come from trusted operator startup, never stdin.
export function createRuntimeBridge({ tool, maxCalls = 10, timeoutMs = 6000, maxInputBytes = 4096 }) {
  if (tool?.name !== TOOL_NAME || typeof tool.execute !== 'function') throw new HubError('INVALID_RUNTIME_TOOL');
  limit(maxCalls, 1, 10); limit(timeoutMs, 25, 6000); limit(maxInputBytes, 128, 4096);
  let attempts = 0, closed = false, busy = false, activeController;
  const close = () => { closed = true; activeController?.abort(); };
  function reserve(id) {
    if (closed) return failure(id, 'RUNTIME_CLOSED');
    if (attempts >= maxCalls) { close(); return failure(id, 'RUNTIME_CALL_LIMIT'); }
    attempts++;
    return null;
  }
  async function handle(request) {
    const id = publicId(request);
    const denied = reserve(id);
    if (denied) return denied;
    if (busy) return failure(id, 'RUNTIME_BUSY');
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).length !== 3
      || Object.keys(request).some(key => !['id', 'tool', 'arguments'].includes(key)) || id === null) {
      return failure(id, 'INVALID_RUNTIME_REQUEST');
    }
    if (request.tool !== TOOL_NAME) return failure(id, 'TOOL_DENIED');
    const args = request.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 0) {
      return failure(id, 'INVALID_TOOL_ARGUMENTS');
    }
    busy = true;
    const controller = new AbortController(); activeController = controller;
    let timer, timedOut = false;
    const abort = new Promise((_, reject) => controller.signal.addEventListener('abort', () => {
      reject(new HubError(timedOut ? 'RUNTIME_TIMEOUT' : 'RUNTIME_CLOSED'));
    }, { once: true }));
    timer = setTimeout(() => { timedOut = true; closed = true; controller.abort(); }, timeoutMs);
    try {
      const result = await Promise.race([tool.execute(id, {}, controller.signal), abort]);
      if (closed) return failure(id, 'RUNTIME_CLOSED');
      // createRadarTool validates and projects aggregates; never forward model content or private fields.
      return { id, ok: true, result: result.details };
    } catch (error) {
      if (timedOut) return failure(id, 'RUNTIME_TIMEOUT');
      if (closed) return failure(id, 'RUNTIME_CLOSED');
      // The transport has no retry. Unknown failures are reduced to a fixed public code.
      return failure(id, 'HUB_REQUEST_FAILED');
    } finally {
      clearTimeout(timer); busy = false;
      if (activeController === controller) activeController = undefined;
    }
  }
  async function handleLine(bytes) {
    if (Buffer.byteLength(bytes) > maxInputBytes) {
      close(); return failure(null, 'INPUT_TOO_LARGE');
    }
    let text, request;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { const denied = reserve(null); close(); return denied ?? failure(null, 'INVALID_UTF8'); }
    try { request = JSON.parse(text); }
    catch { return reserve(null) ?? failure(null, 'INVALID_JSON'); }
    return handle(request);
  }
  return { handle, handleLine, close, maxInputBytes, get closed() { return closed; } };
}

export async function runJsonLines({ input, output, bridge, sessionTimeoutMs = 60000 }) {
  limit(sessionTimeoutMs, 25, 60000);
  let parts = [], size = 0, stopped = false, timer, sessionExpired = false;
  const write = value => output.write(JSON.stringify(value) + '\n');
  const consume = async () => {
    const bytes = Buffer.concat(parts, size); parts = []; size = 0;
    const response = await bridge.handleLine(bytes);
    if (!stopped) write(response);
  };
  const work = (async () => {
    for await (const raw of input) {
      if (stopped) return;
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start), end = newline < 0 ? chunk.length : newline;
        const length = end - start;
        if (size + length > bridge.maxInputBytes) {
          write(failure(null, 'INPUT_TOO_LARGE')); stopped = true; bridge.close(); return;
        }
        if (length) { parts.push(chunk.subarray(start, end)); size += length; }
        if (newline < 0) break;
        await consume();
        if (stopped || bridge.closed) return;
        start = newline + 1;
      }
    }
    if (size && !stopped) await consume(); // EOF can terminate the last frame.
  })();
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => {
      sessionExpired = true; stopped = true; bridge.close(); input.destroy?.();
      reject(new HubError('RUNTIME_SESSION_TIMEOUT'));
    }, sessionTimeoutMs);
  });
  try { await Promise.race([work, expiry]); }
  catch (error) {
    const code = sessionExpired ? 'RUNTIME_SESSION_TIMEOUT'
      : error instanceof HubError && ERROR_CODES.has(error.code) ? error.code : 'INPUT_UNAVAILABLE';
    write(failure(null, code));
  } finally {
    stopped = true; clearTimeout(timer); bridge.close(); input.destroy?.();
  }
}
