import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { encodeRtdbRecord, decodeRtdbRecord, encodeWorkspace, decodeWorkspace } from '../lib/rtdbJson.js';
import { renderActionTemplate } from '../lib/flowData.js';
import { applyActionRun } from '../lib/flowOrchestrator.js';
import { normalizeFlowRun } from '../lib/flowRunStore.js';
import { createFlowRun, materializeFlowRunProject, updateFlowRunFromProject } from '../lib/flowRun.js';
import { durableActionExecutor, type DispatchStore } from '../lib/actionDispatch.js';
import { action, project } from './helpers.js';
import { NodeType } from '../types.js';

// Exercise the installed Firebase SDK's real serializer, not a JSON-only mock.
const require = createRequire(import.meta.url);
const sdkPath = require.resolve('@firebase/database');
const sdk = { exports: {} as any };
new Function('exports','require','module','__filename','__dirname',readFileSync(sdkPath,'utf8')+'\nmodule.exports.roundTripForTest = value => nodeFromJSON(value).val();')(sdk.exports,createRequire(sdkPath),sdk,sdkPath,dirname(sdkPath));
const firebaseRoundTrip: (value:any)=>any = sdk.exports.roundTripForTest;
const persist = <T>(value:T):T => decodeRtdbRecord(firebaseRoundTrip(encodeRtdbRecord(value)));

test('Firebase actually erases empty values; codec preserves arbitrary JSON shape',()=>{
 const input={empty:[],object:{},nothing:null,rows:[[],[null],{},null], sparse:[null,null,{questions:[]}], zero:0,no:false,text:'',nested:{__hyperflowJsonShapeV1:'user value'}};
 assert.equal(firebaseRoundTrip(input).empty,undefined);
 assert.equal(firebaseRoundTrip(input).nothing,undefined);
 assert.deepEqual(persist(input),input);
 assert.deepEqual(persist(persist(input)),input);
});
test('missing legacy inputs remain missing; removed outputs are never restored',()=>{
 const legacy={projectData:{triage_output:{triage_processed_count:0}}};
 assert.deepEqual(decodeRtdbRecord(legacy),legacy);
 assert.throws(()=>renderActionTemplate('{"messages":"{{triage_output.triage_items}}"}',legacy.projectData),/Missing flow input/);
 const next=persist({projectData:{triage_output:{triage_items:[]}}});
 delete (next.projectData as any).triage_output;
 assert.deepEqual(persist(next).projectData,{});
});
test('Sharehouse empty intake and Sheet results survive workspace save, run reload and planning',()=>{
 let p=project([action('triage',NodeType.EMAIL_TRIAGE,{actionConfig:{template:'{}',resultVariable:'cairns_triage'}}),action('sheet',NodeType.GOOGLE_SHEET_READ,{actionConfig:{template:'{}',resultVariable:'cairns_enquiries'}})]);
 p=applyActionRun(p,'triage',{status:'success',at:1,output:{triage_items:[],triage_processed_count:0}});
 p=applyActionRun(p,'sheet',{status:'success',at:2,output:{google_sheet_values:[]}});
 const workspace=decodeWorkspace(firebaseRoundTrip(encodeWorkspace({projects:[p]})));
 const run=createFlowRun({orgId:'org',project:workspace.projects[0],occurrenceId:'empty',trigger:'manual'});
 const saved=updateFlowRunFromProject(run,workspace.projects[0],3);
 const reloaded=normalizeFlowRun(firebaseRoundTrip(encodeRtdbRecord(saved)));
 const restored=materializeFlowRunProject(workspace.projects[0],reloaded);
 const data=renderActionTemplate('{"messages":"{{cairns_triage_output.triage_items}}","rows":"{{cairns_enquiries_output.google_sheet_values}}"}',restored.projectData).templateData;
 assert.deepEqual(data,{messages:[],rows:[]});
 assert.deepEqual(restored.milestones[0].actionConfig?.lastRun?.output?.triage_items,[]);
});
test('durable dispatch replay retains empty outputs without rerunning an effect',async()=>{
 let raw:any=null;let calls=0;
 const store:DispatchStore={async transact(_org,_id,update){raw=firebaseRoundTrip(encodeRtdbRecord(update(decodeRtdbRecord(raw))));return decodeRtdbRecord(raw);}};
 const execute=durableActionExecutor(async()=>{calls++;return {status:'success',output:{structured_output:{tasks:[],drafts:[],open_questions:[]}}};},store);
 const context={orgId:'org',projectId:'p',nodeId:'plan',runId:'op:run:plan:1',flowRunId:'run',attempt:1};
 const first=await execute('write_report','{}',{},context);
 const second=await execute('write_report','{}',{},context);
 assert.deepEqual(second,first);assert.deepEqual(second.output?.structured_output,{tasks:[],drafts:[],open_questions:[]});assert.equal(calls,1);
});
test('untrusted shape paths cannot modify prototypes',()=>{
 const input=JSON.parse('{"projectData":{"__proto__":{"polluted":[]}}}');
 assert.deepEqual(persist(input),input);
 assert.equal(({} as any).polluted,undefined);
 assert.throws(()=>decodeRtdbRecord({__hyperflowJsonShapeV1:'[[["x"],"array",1000000000]]'}),/array length/);
});

