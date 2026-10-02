// Copyright (c) 2026 Carlos Felipe. MIT. Original Radar implementation.
import { createHash } from 'node:crypto';

function fail(code) { throw new Error(code); }

export function createRadarTool({ endpoint, token, fetchImpl = fetch }) {
  let url;
  try { url = new URL(endpoint); } catch { fail('INVALID_HUB_ENDPOINT'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || url.pathname !== '/v1/crm/deals/preview' || url.username || url.password
    || url.search || url.hash) fail('INVALID_HUB_ENDPOINT');
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) fail('INVALID_SERVICE_TOKEN');
  return {
    name: 'radar_crm_preview',
    label: 'Radar CRM: amostra por etapa',
    description: 'Consulta somente leitura de até 10 negócios. Retorna contagens por etapa; não representa o funil completo.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(callId, params, signal) {
      if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).length !== 0) fail('INVALID_TOOL_ARGUMENTS');
      if (typeof callId !== 'string' || callId.length < 1 || callId.length > 1024) fail('INVALID_CALL_ID');
      // Replays of one tool call keep the same reservation key, even across processes.
      const requestId = createHash('sha256').update(callId).digest('hex');
      let response;
      try {
        response = await fetchImpl(url.href, { method: 'POST', redirect: 'error',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId }) });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json') || !response.body) {
          await response.body?.cancel(); fail('HUB_REQUEST_REJECTED');
        }
        const chunks = []; let size = 0;
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 16384) { await reader.cancel(); fail('INVALID_HUB_RESPONSE'); }
          chunks.push(value);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (data?.action !== 'crm.deals.preview' || data.scope !== 'sample-only'
          || !Number.isInteger(data.sampleCount) || data.sampleCount < 0 || data.sampleCount > 10
          || typeof data.hasMore !== 'boolean' || !data.stages || typeof data.stages !== 'object'
          || Array.isArray(data.stages)) fail('INVALID_HUB_RESPONSE');
        const entries = Object.entries(data.stages);
        if (entries.length > 10 || entries.some(([stage, count]) => !/^[A-Za-z0-9_-]{1,80}$/.test(stage)
          || !Number.isInteger(count) || count < 1 || count > 10)
          || entries.reduce((sum, [, count]) => sum + count, 0) !== data.sampleCount) fail('INVALID_HUB_RESPONSE');
        // Project only the public aggregate; tenant and any unexpected fields stay out of model context.
        const details = { scope: 'sample-only', sampleCount: data.sampleCount,
          stages: Object.fromEntries(entries), hasMore: data.hasMore };
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
      } catch { fail('HUB_REQUEST_FAILED'); }
    }
  };
}

export function registerRadarTool(api, env = process.env) {
  api.registerTool(createRadarTool({ endpoint: env.RADAR_HUB_ENDPOINT
    ?? 'http://127.0.0.1:8787/v1/crm/deals/preview', token: env.RADAR_SERVICE_TOKEN }), { optional: true });
}
