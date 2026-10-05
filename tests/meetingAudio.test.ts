import test from 'node:test';
import assert from 'node:assert/strict';
import { audioDependencies, handleMeetingAudio, AUDIO_SOURCE } from '../lib/communications/meetingAudio';
import { publicFile, type ManagedFile } from '../lib/files/model';
import { HttpCommunicationsClient } from '../lib/communications/clientCore';
const member={orgId:'tenant-a',uid:'owner-a'};
function fixture(){
  let file:ManagedFile={id:'audio-12345678',actor:member.uid,name:'meeting.m4a',mime:'audio/mp4',bytes:100,crc32c:'AAAAAA==',visibility:'private',path:'managed/a/file',createdAt:10,state:'ready',offset:100,generation:'123'};
  let row:any=null,enabled=true,now=100,dispatches=0,lost=false,active=true;
  const bodies:any[]=[];
  const deps:typeof audioDependencies={...audioDependencies,now:()=>now,files:{...audioDependencies.files,
    enabled:()=>enabled,lifecycle:async()=>({state:active?'active':'paused'}) as any,
    read:async org=>org===member.orgId?file:null,list:async()=>[file,{...file,id:'foreign-123',actor:'another'}],
    transact:async(_org,_id,fn)=>file=fn(file),
  },sign:async()=>({url:'https://storage.example/private?secret=hidden',expiresAt:1000}),client:()=>({
    findRecording:async()=>row,queueRecording:async(_org,input)=>{
      dispatches++;bodies.push(input);row={id:'recording-1',source:AUDIO_SOURCE,external_id:input.externalId,status:'pending',metadata:input.metadata,media_url:input.mediaUrl};
      if(lost)throw new Error('Provider lost response https://storage.example/?secret=hidden');
      return {id:row.id};
    }
  })};
  return {deps,bodies,run:(method='POST',query:any={},body:any={operation:'audio_start',fileId:file.id},who=member):Promise<any>=>handleMeetingAudio({method,query,body},who,deps),
    get file(){return file;},get dispatches(){return dispatches;},get row(){return row;},
    patch:(v:Partial<ManagedFile>)=>Object.assign(file,v),setRow:(v:any)=>row=v,setLost:()=>lost=true,disable:()=>enabled=false,expire:()=>now=1001,pause:()=>active=false};
}
test('audio intake freezes one private source and never imports meeting evidence',async()=>{
  const f=fixture();const receipt=await f.run();
  assert.equal(receipt.status,'pending');assert.equal(f.dispatches,1);
  assert.equal(f.bodies[0].source,AUDIO_SOURCE);assert.equal(f.bodies[0].externalId,'file-audio-12345678');
  assert.deepEqual(f.bodies[0].metadata,{private:true,visibility:'private',intake_pending:true,memory_eligible:false,audio_filename:'meeting.m4a'});
  assert.equal(f.bodies[0].projectId,undefined);assert.equal(f.bodies[0].participants,undefined);
  assert.ok(!JSON.stringify(receipt).includes('secret'));assert.ok(!JSON.stringify(publicFile(f.file)).includes('secret'));
  await f.run();assert.equal(f.dispatches,1);
});
test('lost response is reconciled without a second dispatch or raw error leakage',async()=>{
  const f=fixture();f.setLost();await assert.rejects(f.run(),e=>!String(e).includes('hidden')&&/same upload/.test(String(e)));
  const receipt=await f.run('GET',{fileId:f.file.id});assert.equal(receipt.status,'pending');
  await f.run();assert.equal(f.dispatches,1);
});
test('private audio cannot be read or dispatched by another user or tenant',async()=>{
  for(const who of [{...member,uid:'other'},{...member,orgId:'other'}]){
    const f=fixture();await assert.rejects(f.run('POST',{},undefined,who),/not available/);assert.equal(f.dispatches,0);
  }
  const f=fixture();f.patch({visibility:'organization'});await assert.rejects(f.run(),/not available/);
});
test('audio limits, lifecycle and storage readiness fail before providers',async()=>{
  for(const change of [{bytes:25*1024*1024+1},{name:'notes.txt'},{mime:'text/plain'},{state:'uploading'}]){
    const f=fixture();f.patch(change as any);await assert.rejects(f.run());assert.equal(f.dispatches,0);
  }
  const f=fixture();f.disable();await assert.rejects(f.run(),/Pasted notes/);
  const p=fixture();p.pause();await assert.rejects(p.run(),/paused/);
});
test('resume list is owner-only and GET never starts a transcription',async()=>{
  const f=fixture();const page:any=await f.run('GET');assert.equal(page.data.length,1);
  assert.equal((await f.run('GET',{fileId:f.file.id})).status,'not_queued');assert.equal(f.dispatches,0);
});
test('completed transcript has unverified speakers and an allowlisted response',async()=>{
  const f=fixture();await f.run();f.setRow({...f.row,status:'done',error:'SECRET',transcript:{segments:[{speaker:'A',personId:'asserted',text:'I can help.',startMs:100,endMs:400}]}});
  const result:any=await f.run('GET',{fileId:f.file.id});assert.equal(result.segments[0].speakerId,null);assert.equal(result.segments[0].speaker,'A');
  assert.equal(result.segments[0].personId,undefined);assert.equal(result.media_url,undefined);assert.equal(result.error,undefined);
});
test('failed or changed recordings are held and expired handoffs are not reissued',async()=>{
  const f=fixture();await f.run();f.setRow({...f.row,status:'failed',error:'secret'});assert.equal((await f.run()).status,'failed');assert.equal(f.dispatches,1);
  f.setRow(null);f.expire();await assert.rejects(f.run(),/expired/);assert.equal(f.dispatches,1);
  f.patch({generation:'999'});await assert.rejects(f.run(),/generation changed/);
});
test('recording lookup verifies stable identity and rejects incompatible service results',async()=>{
  let urls:string[]=[];let wrong=false;
  const client=new HttpCommunicationsClient({baseUrl:'https://service.example',apiKey:'fixture',fetchImpl:async(url,init)=>{
    urls.push(String(url));assert.equal((init?.headers as any)['X-Tenant-Id'],'tenant');
    return Response.json(String(url).includes('?')?{capabilities:{privateIntakeReview:true},data:[{id:'one',source:AUDIO_SOURCE,external_id:wrong?'other':'file-one'}]}:{id:'one',source:AUDIO_SOURCE,external_id:'file-one'});
  }});
  assert.equal((await client.findRecording('tenant',AUDIO_SOURCE,'file-one')).id,'one');assert.match(urls[0],/externalId=file-one/);
  wrong=true;await assert.rejects(client.findRecording('tenant',AUDIO_SOURCE,'file-one'),/compatible/);
  const legacy=new HttpCommunicationsClient({baseUrl:'https://service.example',apiKey:'fixture',fetchImpl:async()=>Response.json({data:[]})});
  await assert.rejects(legacy.findRecording('tenant',AUDIO_SOURCE,'file-one'),/compatible/);
});
