// Copyright (c) 2026 Carlos Felipe. MIT. Original Radar implementation.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { HubError } from './errors.mjs';

const ROUTE = '/v1/crm/deals/preview';
const MAX_BODY = 2048;
const CODES = new Map([
  ['DUPLICATE_REQUEST', 409], ['DAILY_QUOTA_EXCEEDED', 429], ['LEDGER_BUSY', 503],
  ['LEDGER_UNAVAILABLE', 503], ['LEDGER_CORRUPT', 503], ['UPSTREAM_RATE_LIMIT', 503],
  ['UPSTREAM_UNAVAILABLE', 502], ['UPSTREAM_REJECTED', 502],
  ['INVALID_UPSTREAM_RESULTS', 502], ['INVALID_UPSTREAM_FORMAT', 502],
  ['UPSTREAM_BODY_TOO_LARGE', 502]
]);

export function validateServiceToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
    throw new HubError('INVALID_SERVICE_TOKEN');
  }
  return token;
}

export function createReadOnlyServer({ hub, token, tenantId, audit = () => {} }) {
  validateServiceToken(token);
  if (typeof tenantId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(tenantId)) {
    throw new HubError('INVALID_SERVICE_TENANT');
  }
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const start = Date.now();
    let requestId;
    const reply = (status, payload, outcome) => {
      if (!res.destroyed) {
        res.writeHead(status, { 'Content-Type': 'application/json',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
        res.end(JSON.stringify(payload));
      }
      // Callback is operator-owned; never log headers, body, provider errors or credentials.
      try { audit({ action: 'crm.deals.preview', outcome, status,
        ...(requestId ? { requestId } : {}), durationMs: Date.now() - start }); } catch {}
    };
    const authorization = req.headers.authorization;
    const presented = createHash('sha256').update(typeof authorization === 'string' ? authorization : '').digest();
    if (!timingSafeEqual(expected, presented)) return reply(401, { error: 'UNAUTHORIZED' }, 'UNAUTHORIZED');
    if (req.url !== ROUTE) return reply(404, { error: 'NOT_FOUND' }, 'NOT_FOUND');
    if (req.method !== 'POST') return reply(405, { error: 'METHOD_DENIED' }, 'METHOD_DENIED');
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(415, { error: 'JSON_REQUIRED' }, 'JSON_REQUIRED');
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY) return reply(413, { error: 'BODY_TOO_LARGE' }, 'BODY_TOO_LARGE');
    let chunks = [], size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) {
          reply(413, { error: 'BODY_TOO_LARGE' }, 'BODY_TOO_LARGE');
          req.destroy();
          return;
        }
        chunks.push(chunk);
      }
    } catch { return reply(400, { error: 'INVALID_REQUEST' }, 'INVALID_REQUEST'); }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return reply(400, { error: 'INVALID_REQUEST' }, 'INVALID_REQUEST'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'requestId')
      || typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.requestId)) {
      return reply(400, { error: 'INVALID_REQUEST' }, 'INVALID_REQUEST');
    }
    requestId = input.requestId;
    try {
      // Identity and action are built from server configuration, never model input.
      const result = await hub.execute({ tenantId, action: 'crm.deals.preview', requestId }, tenantId);
      reply(200, result, 'SUCCESS');
    } catch (error) {
      const code = error instanceof HubError && CODES.has(error.code) ? error.code : 'SERVICE_UNAVAILABLE';
      reply(CODES.get(code) ?? 503, { error: code }, code);
    }
  });
  server.requestTimeout = 8000;
  server.headersTimeout = 5000;
  server.timeout = 10000;
  server.maxConnections = 16;
  return server;
}

export function listenLocal(server, port = 8787) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new HubError('INVALID_SERVICE_PORT');
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address()); });
  });
}
