// Copyright (c) 2026 Carlos Felipe. MIT. Single trusted internal caller; not multi-tenant auth.
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { validateServiceToken } from './service.mjs';
import { validHermesJob } from './hermes-worker.mjs';
export function createHermesServer({ worker, token }) {
  validateServiceToken(token);
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  if (typeof worker !== 'function') throw new Error('INVALID_WORKER_CONFIG');
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const reply = (status, body) => { if (!res.destroyed) { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store', Connection:'close'}); res.end(JSON.stringify(body)); } };
    const presented = createHash('sha256').update(req.headers.authorization ?? '').digest();
    if (!timingSafeEqual(expected, presented)) return reply(401,{error:'UNAUTHORIZED'});
    if (req.url !== '/v1/hermes/preview') return reply(404,{error:'NOT_FOUND'});
    if (req.method !== 'POST') return reply(405,{error:'METHOD_DENIED'});
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(415,{error:'JSON_REQUIRED'});
    let bytes = 0, chunks = [];
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4096) { reply(413,{error:'BODY_TOO_LARGE'}); req.destroy(); return; }
        chunks.push(chunk);
      }
      const job = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      if (!validHermesJob(job)) return reply(400,{error:'INVALID_WORKER_JOB'});
      const value = await worker(job);
      reply(value.ok === true ? 200 : 503, value);
    } catch { reply(400,{error:'INVALID_REQUEST'}); }
  });
  server.requestTimeout = 8000; server.headersTimeout = 5000; server.timeout = 15000; server.maxConnections = 8;
  return server;
}
