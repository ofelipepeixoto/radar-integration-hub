// Copyright (c) 2026 Carlos Felipe. MIT. Generic internal JSONL bridge, not a native Hermes plugin.
import { createRadarTool } from '../plugins/openclaw-radar/tool.mjs';
import { createRuntimeBridge, describeRuntime, runJsonLines } from './runtime-bridge.mjs';
import { HubError } from './errors.mjs';

function argumentsForOperator(argv) {
  if (argv.length === 1 && argv[0] === '--describe') return { describe: true };
  const names = new Map([['--max-calls', 'maxCalls'], ['--timeout-ms', 'timeoutMs'],
    ['--session-timeout-ms', 'sessionTimeoutMs']]);
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = names.get(argv[i]), value = argv[i + 1];
    if (!name || Object.hasOwn(parsed, name) || !/^[0-9]{1,6}$/.test(value ?? '')) {
      throw new HubError('INVALID_ARGUMENTS');
    }
    parsed[name] = Number(value);
  }
  return parsed;
}
try {
  const options = argumentsForOperator(process.argv.slice(2));
  if (options.describe) {
    process.stdout.write(JSON.stringify(describeRuntime()) + '\n');
  } else {
    const tool = createRadarTool({ endpoint: process.env.RADAR_HUB_ENDPOINT
      ?? 'http://127.0.0.1:8787/v1/crm/deals/preview', token: process.env.RADAR_SERVICE_TOKEN });
    const bridge = createRuntimeBridge({ tool, maxCalls: options.maxCalls, timeoutMs: options.timeoutMs });
    await runJsonLines({ input: process.stdin, output: process.stdout, bridge,
      sessionTimeoutMs: options.sessionTimeoutMs });
  }
} catch {
  // No endpoint, token, provider body or untrusted input in startup diagnostics.
  process.stderr.write('RUNTIME_START_FAILED: confira configuração e limites locais.\n');
  process.exitCode = 1;
}
