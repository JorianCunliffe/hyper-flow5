import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachingChangeEvidence } from '../lib/coachingChangeEvidence.js';

test('spoken approval with no completed receipt cannot become tracker success', () => {
  const result = coachingChangeEvidence('Okay, I did all of that. Can you just set it as approved, please?', 'call', []);
  assert.equal(result.requiresReview, true);
  assert.match(result.summary!, /do not confirm/);
  assert.deepEqual(result.completed, []);
});
test('only completed receipts for this call prove changes; pending and unavailable receipts hold review', () => {
  const completed = {callId:'call',status:'completed',id:'saved',action:'approve',item:{title:'Report'}};
  assert.equal(coachingChangeEvidence('Approve it', 'call', [completed]).requiresReview, false);
  assert.equal(coachingChangeEvidence('Approve it', 'call', [{...completed,callId:'other'}]).requiresReview, true);
  assert.equal(coachingChangeEvidence('Approve it', 'call', [{...completed,status:'prepared'}]).requiresReview, true);
  assert.equal(coachingChangeEvidence('Approve it', 'call', [completed,{...completed,status:'uncertain'}]).requiresReview, true);
  assert.equal(coachingChangeEvidence('Approve it', 'call', [completed], false).requiresReview, true);
  assert.equal(coachingChangeEvidence('I will finish the test tomorrow', 'call', [], false).requiresReview, false);
});
