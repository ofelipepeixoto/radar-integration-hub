import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {execFileSync} from 'node:child_process';
test('generated workflow is reproducible and runs only fixtures without host capabilities',async()=>{
 const path='workflows/n8n/workflow-study.json',before=readFileSync(path,'utf8');
 execFileSync(process.execPath,['scripts/export-workflow-study.mjs']);
 assert.equal(readFileSync(path,'utf8'),before);
 const workflow=JSON.parse(before);assert.equal(workflow.active,false);assert.equal(workflow.pinData,undefined);
 assert.deepEqual(workflow.nodes.map(n=>n.type),['n8n-nodes-base.manualTrigger','n8n-nodes-base.code']);
 assert.ok(workflow.nodes.every(n=>!n.credentials));
 const code=workflow.nodes[1].parameters.jsCode;
 const out=await runInNewContext('(async()=>{'+code+'})()',{}, {timeout:1000});
 assert.equal(out[0].json.status,'STUDY_ONLY');assert.equal(out[0].json.results.length,3);
 assert.equal(out[0].json.results[2].code,'TASK_FAILED');
});
