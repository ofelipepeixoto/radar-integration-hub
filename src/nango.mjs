import { HubError } from './errors.mjs';

const ENDPOINT = 'https://api.nango.dev/proxy/crm/v3/objects/deals?limit=10&properties=dealstage&archived=false';
export class NangoCrmAdapter {
  constructor({ secretKey, fetchImpl = fetch }) {
    if (typeof secretKey !== 'string' || !secretKey || /[\r\n]/.test(secretKey)) throw new HubError('INVALID_BACKEND_KEY');
    this.secretKey = secretKey; this.fetchImpl = fetchImpl;
  }
  async listDeals({ connectionId, providerConfigKey }) {
    for (const value of [connectionId, providerConfigKey]) {
      if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new HubError('INVALID_BINDING');
    }
    try {
      const response = await this.fetchImpl(ENDPOINT, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Connection-Id': connectionId,
          'Provider-Config-Key': providerConfigKey, Retries: '0', Accept: 'application/json' }
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new HubError(response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_REJECTED');
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        await response.body?.cancel(); throw new HubError('INVALID_UPSTREAM_FORMAT');
      }
      if (!response.body) throw new HubError('INVALID_UPSTREAM_FORMAT');
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 65536) { await reader.cancel(); throw new HubError('UPSTREAM_BODY_TOO_LARGE'); }
        chunks.push(value);
      }
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new HubError('INVALID_UPSTREAM_FORMAT'); }
      return parsed;
    } catch (error) {
      if (error instanceof HubError) throw error;
      // Não propagar mensagens do provedor, URLs nem credenciais.
      throw new HubError('UPSTREAM_UNAVAILABLE');
    }
  }
}
