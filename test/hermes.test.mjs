import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createHermesWorker, validHermesJob } from '../src/hermes-worker.mjs';
import { createHermesServer } from '../src/hermes-service.mjs';
import { buildHermesWorkflow } from '../src/hermes-n8n.mjs';
import { listenLocal,createReadOnlyServer } from '../src/service.mjs';
import { createHub } from '../src/hub.mjs';
import { FileLedger } from '../src/ledger.mjs';
const job={version:'radar.hermes.job.v1',id:'test-id',tool:'radar_crm_preview',arguments:{}};
const token=randomBytes(32).toString('base64url');
async function close(server) { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
test('contract rejects model-provided authority, writes and paid enablement',async()=>{
  const worker=createHermesWorker({python:'/missing/python',source:'/missing/source'});
  for(const bad of [{...job,tenantId:'other'},{...job,paidCallsEnabled:true},{...job,tool:'terminal'},
    {...job,arguments:{url:'http://example.com'}},{...job,id:'../invalid'},null,[]]) {
    assert.ok(!validHermesJob(bad)); assert.equal((await worker(bad)).error,'INVALID_WORKER_JOB');
  }
});
test('missing runtime fails closed without detailed error or retry',async()=>{
  const result=await createHermesWorker({python:'/missing/python',source:'/missing/source'})(job);
  assert.deepEqual(result,{ok:false,error:'WORKER_UNAVAILABLE',paidCallsEnabled:false});
});
test('authenticated HTTP endpoint rejects unauthorized caller before worker',async()=>{
  let calls=0;
  const server=createHermesServer({token,worker:async()=>{calls++;return {ok:true};}});
  const addr=await listenLocal(server,0);
  try {
    const url=`http://127.0.0.1:${addr.port}/v1/hermes/preview`;
    const send=(body,headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'})=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await send(job,{'Content-Type':'application/json'})).status,401);
    assert.equal((await send({...job,tenantId:'other'})).status,400);
    assert.equal(calls,0);
    assert.equal((await send(job)).status,200);assert.equal(calls,1);
  } finally {await close(server);}
});
test('n8n exported Code nodes emit exact job and stop on bad correlation',()=>{
  const flow=buildHermesWorkflow();assert.equal(flow.active,false);
  const run=(code,items=[])=>vm.runInNewContext(`(function(){${code}})()`,{$execution:{id:'fixture'},$input:{all:()=>items}});
  const input=JSON.parse(JSON.stringify(run(flow.nodes[1].parameters.jsCode)[0].json));assert.ok(validHermesJob(input));
  const result={version:'radar.hermes.result.v1',id:input.id,ok:true,paidCallsEnabled:false,result:{scope:'sample-only',sampleCount:1,stages:{qualified:1},hasMore:false}};
  assert.equal(run(flow.nodes[3].parameters.jsCode,[{json:result}])[0].json.status,'review-required');
  assert.throws(()=>run(flow.nodes[3].parameters.jsCode,[{json:{...result,id:'other'}}]));
  assert.throws(()=>run(flow.nodes[3].parameters.jsCode,[{json:{...result,paidCallsEnabled:true}}]));
  assert.equal(flow.nodes[2].retryOnFail,false);
});
test('real Hermes PluginContext -> registry dispatch -> HTTP Hub; replay and projection',{
  skip:!process.env.RADAR_HERMES_TEST_PYTHON || !process.env.RADAR_HERMES_TEST_SOURCE
},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'radar-hermes-test-'));let calls=0;
  const hub=createHub({bindings:{internal:{connectionId:'trusted'}},ledger:new FileLedger(dir),adapter:{async listDeals(){calls++;return {results:[{id:'PRIVATE_ID',properties:{name:'PRIVATE_NAME',dealstage:'qualified'}}]};}}});
  const hubServer=createReadOnlyServer({hub,token,tenantId:'internal'});
  const hubAddr=await listenLocal(hubServer,0);
  const worker=createHermesWorker({python:process.env.RADAR_HERMES_TEST_PYTHON,source:process.env.RADAR_HERMES_TEST_SOURCE,
    endpoint:`http://127.0.0.1:${hubAddr.port}/v1/crm/deals/preview`,token});
  const service=createHermesServer({worker,token});const addr=await listenLocal(service,0);
  try {
    const send=body=>fetch(`http://127.0.0.1:${addr.port}/v1/hermes/preview`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await send({...job,arguments:{tenantId:'other'}})).status,400);assert.equal(calls,0);
    const response=await send(job); const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    assert.deepEqual(result.result,{scope:'sample-only',sampleCount:1,stages:{qualified:1},hasMore:false});
    assert.equal(result.paidCallsEnabled,false);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal(calls,1);
    assert.equal((await send(job)).status,503);assert.equal(calls,1);
  } finally {await close(service);await close(hubServer);await rm(dir,{recursive:true,force:true});}
});
