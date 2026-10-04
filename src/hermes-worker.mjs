// Copyright (c) 2026 Carlos Felipe. MIT. Trusted one-shot launcher, no provider calls.
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
export const HERMES_PIN = 'c225c4a04e8b517a357804ebb27367b0c961fd0e';
export function validHermesJob(job) {
  return job && typeof job === 'object' && !Array.isArray(job)
    && Object.keys(job).length === 4 && ['version', 'id', 'tool', 'arguments'].every(k => Object.hasOwn(job, k))
    && job.version === 'radar.hermes.job.v1' && typeof job.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(job.id)
    && job.tool === 'radar_crm_preview' && job.arguments && typeof job.arguments === 'object'
    && !Array.isArray(job.arguments) && Object.keys(job.arguments).length === 0;
}
export function createHermesWorker({ python, source, endpoint, token, timeoutMs = 10000 }) {
  if (![python, source].every(x => typeof x === 'string' && isAbsolute(x))
    || !Number.isInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > 10000) throw new Error('INVALID_WORKER_CONFIG');
  let busy = false;
  return async job => {
    if (!validHermesJob(job)) return { ok: false, error: 'INVALID_WORKER_JOB', paidCallsEnabled: false };
    if (busy) return { ok: false, error: 'WORKER_BUSY', paidCallsEnabled: false };
    busy = true;
    try {
      return await new Promise(resolve => {
        // Deliberately do not inherit process.env, shell, prompts or model credentials.
        const child = spawn(python, [new URL('../integrations/hermes/worker.py', import.meta.url).pathname], {
          env: { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1',
            RADAR_HERMES_SOURCE: source, RADAR_HUB_ENDPOINT: endpoint ?? '', RADAR_SERVICE_TOKEN: token ?? '' },
          stdio: ['pipe', 'pipe', 'pipe'], shell: false
        });
        let stdout = '', exceeded = false, timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
        child.stdout.on('data', chunk => {
          if (Buffer.byteLength(stdout) + chunk.length > 16384) { exceeded = true; child.kill('SIGKILL'); }
          else stdout += chunk.toString();
        });
        // Drain, never relay possibly sensitive diagnostics.
        child.stderr.resume(); child.stdin.on('error', () => {});
        child.once('error', () => { clearTimeout(timer); resolve({ ok: false, error: 'WORKER_UNAVAILABLE', paidCallsEnabled: false }); });
        child.once('close', code => {
          clearTimeout(timer);
          const fail = error => resolve({ ok: false, error, paidCallsEnabled: false });
          if (timedOut || exceeded) return fail('WORKER_RESULT_UNKNOWN');
          try {
            const value = JSON.parse(stdout);
            if (value.paidCallsEnabled !== false || value.id !== job.id || value.version !== 'radar.hermes.result.v1') return fail('WORKER_UNAVAILABLE');
            if (code !== 0 || value.ok !== true) return fail('HUB_REQUEST_FAILED');
            const r = value.result;
            if (!r || r.scope !== 'sample-only' || typeof r.hasMore !== 'boolean' || !Number.isInteger(r.sampleCount)
              || r.sampleCount < 0 || r.sampleCount > 10 || !r.stages || typeof r.stages !== 'object' || Array.isArray(r.stages)) return fail('INVALID_WORKER_RESULT');
            const entries = Object.entries(r.stages);
            if (entries.length > 10 || entries.some(([k,v]) => !/^[A-Za-z0-9_-]{1,80}$/.test(k)
              || ['__proto__','constructor','prototype'].includes(k) || !Number.isInteger(v) || v < 1 || v > 10)
              || entries.reduce((s,[,v])=>s+v,0) !== r.sampleCount) return fail('INVALID_WORKER_RESULT');
            resolve({ version: value.version, id: job.id, ok: true, paidCallsEnabled: false,
              result: { scope: r.scope, sampleCount: r.sampleCount, stages: r.stages, hasMore: r.hasMore } });
          } catch { fail('WORKER_UNAVAILABLE'); }
        });
        child.stdin.end(JSON.stringify(job));
      });
    } finally { busy = false; }
  };
}
