// Copyright (c) 2026 Carlos Felipe. SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const files = ['src/workflow-controls.mjs','src/workflow-study.mjs'];
const code = files.map(file => readFileSync(new URL(file,root),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n')
  + '\nconst plan = {schemaVersion:1,action:"radar.fixture.batch",concurrency:2,cases:["success","null","failure"]};'
  + '\nreturn [{json: await runStudyPlan(plan)}];\n';
const workflow = {
  name: 'Radar — estudo de workflow com controles locais', active: false,
  nodes: [
    {id:'study-manual',name:'Iniciar estudo manual',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},
    {id:'study-preview',name:'Executar simulação limitada',type:'n8n-nodes-base.code',typeVersion:2,position:[260,0],
      parameters:{mode:'runOnceForAllItems',language:'javaScript',jsCode:code}}
  ],
  connections:{'Iniciar estudo manual':{main:[[{node:'Executar simulação limitada',type:'main',index:0}]]}},
  settings:{executionOrder:'v1',executionTimeout:15,saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false},tags:[]
};
writeFileSync(new URL('workflows/n8n/workflow-study.json',root),JSON.stringify(workflow,null,2)+'\n');
