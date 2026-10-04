// Copyright (c) 2026 Carlos Felipe. MIT.
import { createHermesWorker } from './hermes-worker.mjs';
import { createHermesServer } from './hermes-service.mjs';
import { listenLocal } from './service.mjs';
try {
  const worker = createHermesWorker({ python: process.env.RADAR_HERMES_PYTHON,
    source: process.env.RADAR_HERMES_SOURCE, endpoint: process.env.RADAR_HUB_ENDPOINT,
    token: process.env.RADAR_SERVICE_TOKEN });
  const server = createHermesServer({ worker, token: process.env.RADAR_WORKER_SERVICE_TOKEN });
  await listenLocal(server, 8788);
  console.log('Radar Hermes readonly: 127.0.0.1:8788; paid calls disabled.');
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close());
} catch { console.error('WORKER_SERVICE_UNAVAILABLE'); process.exitCode = 1; }
