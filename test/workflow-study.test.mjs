import test from 'node:test';
import assert from 'node:assert/strict';
import { runStudyPlan, validateStudyPlan } from '../src/workflow-study.mjs';
const plan = () => ({schemaVersion: 1, action: 'radar.fixture.batch', concurrency: 2, cases: ['success','null','failure']});
test('fixture contract distinguishes failure, success and null; never claims production', async () => {
  const out = await runStudyPlan(plan());
  assert.deepEqual(out.results, [{ok:true,value:{fixture:true}},{ok:true,value:null},{ok:false,code:'TASK_FAILED'}]);
  assert.equal(out.status,'STUDY_ONLY');
  for (const flag of ['paidCallsEnabled','externalEffects','durableRecovery','sandboxed']) assert.equal(out[flag],false);
  assert.equal(out.events.length,2);
});
test('rejects executable inputs, unknown fields, malformed cases and bounds before writing', async () => {
  let writes=0;
  for(const value of [null, {...plan(),source:'code'}, {...plan(),path:'/tmp/private'}, {...plan(),env:{}},
    {...plan(),action:'shell'}, {...plan(),cases:['private-text']}, {...plan(),cases:[]},
    {...plan(),cases:Array(3)}, {...plan(),cases:Array(21).fill('success')}, {...plan(),concurrency:5}]) {
    await assert.rejects(runStudyPlan(value,{sink:()=>writes++}),/INVALID_STUDY_PLAN/);
  }
  assert.equal(writes,0);
});
test('plan snapshot does not change after validation', () => {
  const input=plan(), checked=validateStudyPlan(input); input.cases[0]='failure';
  assert.equal(checked.cases[0],'success'); assert.ok(Object.isFrozen(checked.cases));
});
test('start and final audit sink failures are surfaced', async () => {
  for(const failAt of [1,2]) {let n=0;await assert.rejects(runStudyPlan(plan(),{sink:async()=>{
    if(++n===failAt)throw new Error('SYNTHETIC_PRIVATE');
  }}),/^Error: AUDIT_SINK_UNAVAILABLE$/);}
});
