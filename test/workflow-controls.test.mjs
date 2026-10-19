import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedMap,projectEvent,createSafeEventWriter} from '../src/workflow-controls.mjs';

test('bounded map limits active jobs and preserves order',async()=>{
  let active=0,peak=0;
  const result=await boundedMap([1,2,3,4,5],async n=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,6-n));active--;return n*2;});
  assert.equal(peak,2);assert.deepEqual(result.map(x=>x.value),[2,4,6,8,10]);
});
test('failure differs from a successful null without leaking exception',async()=>{
  assert.deepEqual(await boundedMap([0,1],n=>{if(!n)throw new Error('SYNTHETIC_PRIVATE');return null;}),[{ok:false,code:'TASK_FAILED'},{ok:true,value:null}]);
});
test('oversized batches start zero jobs',async()=>{
  let started=0;await assert.rejects(boundedMap(Array(21),()=>started++),/INVALID_BATCH/);assert.equal(started,0);
});
test('invalid concurrency rejects before execution',async()=>{
  for(const concurrency of [0,5,1.5,NaN])await assert.rejects(boundedMap([1],()=>1,{concurrency}),/INVALID_BATCH/);
});
test('invalid item limit rejects before execution',async()=>{
  for(const maxItems of [0,101,Infinity])await assert.rejects(boundedMap([1],()=>1,{maxItems}),/INVALID_BATCH/);
});
test('already aborted signal starts zero jobs',async()=>{
  const c=new AbortController();c.abort();let started=0;
  await assert.rejects(boundedMap([1],()=>started++,{signal:c.signal}));assert.equal(started,0);
});
test('abort stops queued work but awaits tasks already started',async()=>{
  const c=new AbortController();const seen=[];
  const out=await boundedMap([1,2,3],async n=>{seen.push(n);c.abort();return n;},{concurrency:1,signal:c.signal});
  assert.deepEqual(seen,[1]);assert.deepEqual(out,[{ok:true,value:1},{ok:false,code:'NOT_STARTED'},{ok:false,code:'NOT_STARTED'}]);
});
test('empty batch returns no results',async()=>assert.deepEqual(await boundedMap([],()=>null),[]));
test('projection removes free text, malicious ID, metadata and stack',()=>{
  const v=projectEvent({type:'workflow:error',sequence:2,id:'SYNTHETIC_PRIVATE',scriptPath:'/private',error:{message:'SYNTHETIC_PRIVATE',stack:'private'},meta:{exampleArgs:{token:'synthetic'}},durationMs:3});
  assert.deepEqual(v,{type:'workflow:error',sequence:2,durationMs:3,code:'WORKFLOW_FAILED'});assert.ok(Object.isFrozen(v));
});
test('invalid events cannot reach writer',async()=>{
  let calls=0;const writer=createSafeEventWriter(()=>calls++);
  for(const e of [null,{type:'unknown',sequence:1},{type:'log',sequence:0}])await assert.rejects(writer(e),/INVALID_EVENT/);
  assert.equal(calls,0);
});
test('writer emits sanitized JSON only',async()=>{
  const lines=[];await createSafeEventWriter(x=>lines.push(x))({type:'log',sequence:1,message:'synthetic-private'});
  assert.deepEqual(lines,['{"type":"log","sequence":1}']);
});
test('sink errors propagate with fixed public code',async()=>{
  const writer=createSafeEventWriter(()=>{throw new Error('SYNTHETIC_PRIVATE');});
  await assert.rejects(writer({type:'workflow:start',sequence:1}),/^Error: AUDIT_SINK_UNAVAILABLE$/);
});

test('asynchronous sink failures also propagate without private text',async()=>{
  const writer=createSafeEventWriter(async()=>{throw new Error('SYNTHETIC_PRIVATE');});
  await assert.rejects(writer({type:'workflow:start',sequence:1}),/^Error: AUDIT_SINK_UNAVAILABLE$/);
});
