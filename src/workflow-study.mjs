// Copyright (c) 2026 Carlos Felipe. SPDX-License-Identifier: MIT
// Declarative fixture contract, not a code executor or sandbox.
import { boundedMap, createSafeEventWriter } from './workflow-controls.mjs';

export function validateStudyPlan(plan) {
  const keys = ['schemaVersion', 'action', 'concurrency', 'cases'];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(plan))
    || Object.keys(plan).length !== keys.length || keys.some(k => !Object.hasOwn(plan, k))
    || plan.schemaVersion !== 1 || plan.action !== 'radar.fixture.batch'
    || !Number.isSafeInteger(plan.concurrency) || plan.concurrency < 1 || plan.concurrency > 4
    || !Array.isArray(plan.cases) || plan.cases.length < 1 || plan.cases.length > 20) {
    throw new Error('INVALID_STUDY_PLAN');
  }
  // Array.from also rejects sparse arrays. Copy before any asynchronous work.
  const cases = Array.from(plan.cases);
  if (cases.some(value => !['success', 'null', 'failure'].includes(value))) throw new Error('INVALID_STUDY_PLAN');
  return Object.freeze({schemaVersion: 1, action: 'radar.fixture.batch',
    concurrency: plan.concurrency, cases: Object.freeze(cases)});
}

export async function runStudyPlan(input, {signal, sink = () => {}} = {}) {
  const plan = validateStudyPlan(input);
  signal?.throwIfAborted();
  const events = [];
  const write = createSafeEventWriter(async line => { await sink(line); events.push(JSON.parse(line)); });
  await write({type: 'workflow:start', sequence: 1});
  const results = await boundedMap(plan.cases, async value => {
    if (value === 'failure') throw new Error('FIXTURE_FAILURE');
    return value === 'null' ? null : {fixture: true};
  }, {concurrency: plan.concurrency, maxItems: 20, signal});
  await write({type: 'workflow:end', sequence: 2});
  return {schemaVersion: 1, status: 'STUDY_ONLY', fixture: true,
    action: plan.action, concurrency: plan.concurrency, results, events,
    paidCallsEnabled: false, externalEffects: false, durableRecovery: false, sandboxed: false};
}
