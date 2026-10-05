import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceCancellationText, cancelledVoiceAskRun, recordedVoiceCancellation } from '../lib/asks/cancelVoiceAsk.js';
import { updateFlowRunFromProject } from '../lib/flowRun.js';

const transcript = (text: string, role = 'user', speaker = 'caller') => ({segments: [{role, speaker, text}]});
test('the actual Sharehouse cancellation is recognized without a model', () => {
  const text = "No, no, no. You can cancel all the rest of it. That's fine. Thank you. Goodbye.";
  assert.equal(voiceCancellationText(transcript(text)), text);
});
test('recovery accepts only stored voice evidence belonging to the delivered call and person', () => {
  const response = {via:'voice',actor:'person',communicationId:'c',raw:{source:'communications',payload:{transcript:transcript('Cancel the rest.')}}};
  const ask = {id:'a',status:'open',responses:[response],deliveries:[{communicationId:'c',personId:'person'}]};
  const run:any = {state:{milestones:[{asks:[ask]}]}};
  assert.equal(recordedVoiceCancellation(run)?.ask.id,'a');
  for (const overrides of [{via:'web'}, {actor:'stranger'}, {communicationId:'other'}, {raw:{source:'browser'}}]) {
    assert.equal(recordedVoiceCancellation({state:{milestones:[{asks:[{...ask,responses:[{...response,...overrides}]}]}]}} as any),undefined);
  }
  assert.equal(recordedVoiceCancellation({state:{milestones:[{asks:[{...ask,status:'answered'}]}]}} as any),undefined);
});
test('only explicit caller cancellation, never negations, quotations, assistant or unlabelled text', () => {
  for (const text of ['Do not cancel the rest.', 'Should I cancel the rest?', 'Carol said cancel the rest.', 'I am on holiday.', 'No availability.', 'Cancel the booking.', '"Cancel the rest."']) {
    assert.equal(voiceCancellationText(transcript(text)), undefined, text);
  }
  assert.equal(voiceCancellationText(transcript('Cancel the rest.', 'assistant', 'assistant')), undefined);
  assert.equal(voiceCancellationText('Cancel the rest.'), undefined);
  assert.equal(voiceCancellationText({segments: [{role:'user',text:'Cancel the rest.'}]}), undefined);
  assert.equal(voiceCancellationText({segments: [...transcript('Cancel the rest.').segments, ...transcript('Actually keep going.').segments]}), undefined);
});
test('cancellation keeps evidence, cancels open questions and cannot release or revive the run', () => {
  const ask: any = {id:'a',nodeId:'n',projectId:'p',status:'open',responses:[{text:'partial answer'}],escalationState:{nextAt:123},deliveries:[{communicationId:'c',personId:'person'}]};
  const run: any = {id:'r',projectId:'p',status:'waiting',revision:4,nodeRuns:{},state:{projectData:{},milestones:[{id:'n',asks:[ask],holdConfig:{kind:'human',holdId:'h'}},{id:'other',asks:[{id:'b',status:'open',responses:[]}]}]}};
  const next = cancelledVoiceAskRun(run,ask,'Cancel the rest.','c',100);
  assert.equal(next.status,'cancelled');
  assert.equal(next.cancelledAt,100);
  assert.equal(next.state.milestones[0].asks![0].responses.length,2);
  assert.equal(next.state.milestones[0].asks![0].escalationState,undefined);
  assert.ok(next.state.milestones.every(n=>n.asks!.every(a=>a.status==='cancelled')));
  assert.deepEqual(next.state.projectData,{});
  assert.equal((next.state.milestones[0] as any).holdConfig.resolution,undefined);
  assert.equal(updateFlowRunFromProject(next,{} as any),next);
  assert.equal(cancelledVoiceAskRun(next,ask,'Cancel the rest.','c',101),next);
  assert.equal(run.status,'waiting');
  assert.throws(()=>cancelledVoiceAskRun(run,{...ask,projectId:'other'},'Cancel the rest.','c',100));
});
