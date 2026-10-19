// Copyright (c) 2026 Carlos Felipe. SPDX-License-Identifier: MIT
// Original Radar controls for trusted, bounded tasks; no Deer runtime.
const TYPES = new Set(['workflow:start','workflow:meta','workflow:end','workflow:error','workflow:phase:start','workflow:phase:end','log']);

/** Project events to fixed fields; never export free text, paths, stacks or metadata. */
export function projectEvent(event) {
  if (!event || !TYPES.has(event.type) || !Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error('INVALID_EVENT');
  const value = {type:event.type, sequence:event.sequence};
  if (Number.isFinite(event.durationMs) && event.durationMs >= 0) value.durationMs=event.durationMs;
  if(event.type==='workflow:error')value.code='WORKFLOW_FAILED';
  return Object.freeze(value);
}

/** Sanitize before storage. A sink failure remains fail-closed and is not silently ignored. */
export function createSafeEventWriter(sink) {
  if(typeof sink !== 'function')throw new Error('INVALID_SINK');
  return async event => {
    const line=JSON.stringify(projectEvent(event));
    try {await sink(line);} catch {throw new Error('AUDIT_SINK_UNAVAILABLE');}
  };
}

/** Bounded lazy scheduling for trusted tasks. Does not sandbox or kill running work. */
export async function boundedMap(items, task, {concurrency=2,maxItems=20,signal}={}) {
  if(!Array.isArray(items)||!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>100||items.length>maxItems
    ||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>4||typeof task!=='function')throw new Error('INVALID_BATCH');
  signal?.throwIfAborted();
  const results=new Array(items.length);let next=0;
  const workers=Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(next<items.length){
      if(signal?.aborted)break;
      const index=next++;
      try {results[index]={ok:true,value:await task(items[index],index,signal)};}
      catch {results[index]={ok:false,code:'TASK_FAILED'};}
    }
  });
  await Promise.all(workers);
  for(let index=0;index<results.length;index++)if(results[index]===undefined)results[index]={ok:false,code:'NOT_STARTED'};
  return results;
}
