import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applySubmissionAction} from '../lib/asks/submissionAction';
import {buildResponse} from '../lib/askResponses';
import {recordAskResponse} from '../lib/humanAsk';

const question:any = {id:'q',kind:'question',status:'open',fields:[],responses:[]};
const prose = () => buildResponse(question,{via:'web',actor:'owner',text:'I checked the result.'});

test('explicit signed-in prose answers complete questions; ordinary prose stays open',()=>{
 assert.equal(recordAskResponse(question,prose()).status,'open');
 assert.equal(recordAskResponse(question,applySubmissionAction(question,prose(),'answer',true)).status,'answered');
 assert.throws(()=>applySubmissionAction(question,prose(),'answer',false),/Sign in/);
 assert.throws(()=>applySubmissionAction(question,{...prose(),via:'sms'},'answer',true),/Sign in/);
 assert.throws(()=>applySubmissionAction(question,{...prose(),text:' '},'answer',true),/Enter an answer/);
});
test('comments cannot carry an approval or field answer and never close questions',()=>{
 const comment=applySubmissionAction(question,{...prose(),decision:'approved',values:{time:'16:00'}},'comment',true);
 assert.equal(comment.decision,undefined);assert.equal(comment.values,undefined);
 assert.equal(recordAskResponse(question,comment).status,'open');
});
test('explicit answers do not bypass required fields',()=>{
 const structured={...question,fields:[{name:'time',type:'string',required:true}]};
 assert.equal(recordAskResponse(structured,applySubmissionAction(structured,prose(),'answer',true)).status,'open');
});
