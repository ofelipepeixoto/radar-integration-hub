import { HubError } from './errors.mjs';

export function createHub({ bindings, adapter, ledger }) {
  return {
    async execute(request, authenticatedTenantId) {
      if (!request || typeof request !== 'object' || Array.isArray(request)
        || Object.keys(request).length !== 3
        || Object.keys(request).some(k => !['tenantId', 'action', 'requestId'].includes(k))) throw new HubError('INVALID_REQUEST');
      const { tenantId, action, requestId } = request;
      if (typeof tenantId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(tenantId)
        || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)) throw new HubError('INVALID_REQUEST');
      if (typeof authenticatedTenantId !== 'string' || tenantId !== authenticatedTenantId) throw new HubError('TENANT_DENIED');
      if (action !== 'crm.deals.preview') throw new HubError('ACTION_DENIED');
      if (!Object.hasOwn(bindings, tenantId)) throw new HubError('BINDING_NOT_FOUND');
      await ledger.reserve(tenantId, requestId);
      const data = await adapter.listDeals(bindings[tenantId]);
      if (!Array.isArray(data?.results) || data.results.length > 10) throw new HubError('INVALID_UPSTREAM_RESULTS');
      const stages = Object.create(null);
      for (const deal of data.results) {
        const stage = deal?.properties?.dealstage;
        if (typeof stage !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(stage)) throw new HubError('INVALID_UPSTREAM_RESULTS');
        stages[stage] = (stages[stage] || 0) + 1;
      }
      return { tenantId, action, sampleCount: data.results.length, stages: { ...stages },
        hasMore: Boolean(data.paging?.next), scope: 'sample-only' };
    }
  };
}
