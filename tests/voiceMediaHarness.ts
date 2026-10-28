import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import WebSocket,{WebSocketServer} from 'ws';

/** Runs the actual Communications media handler; only provider transports are simulated. */
export async function createVoiceMediaHarness(checkout:string,base:string,context:any){
  const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
  const accepted=once(wss,'connection');
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
  const callSid='CA'+'4'.repeat(32),streamSid='MZ'+'5'.repeat(32),token='isolated-media-harness';
  const service=`http://127.0.0.1:${port}`;
  let logs='',sequence=0,continuations=0,marks=0;
  const child=spawn(process.execPath,['--import',pathToFileURL(path.join(checkout,'test/fixtures/voiceHarnessBoot.js')).href,'index.js'],{
    cwd:checkout,env:{PATH:process.env.PATH,NODE_ENV:'test',DOTENV_CONFIG_PATH:'no-dotenv',PORT:String(port),PERSISTENCE_PROVIDER:'none',OPENAI_API_KEY:'test-no-provider-access',TWILIO_AUTH_TOKEN:token,TWILIO_VALIDATE_SIGNATURES:'off',PUBLIC_URL:service,HYPERFLOW_SCHEDULER_DISABLED:'true',HYPERFLOW_EVENT_URL:base+'/api/events',COMMUNICATIONS_WEBHOOK_SECRET:'fixture-briefing-secret',VOICE_HARNESS_REALTIME:`ws://127.0.0.1:${(wss.address() as any).port}`,VOICE_HARNESS_CALL_SID:callSid,VOICE_HARNESS_CONTEXT:JSON.stringify(context)},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>{logs+=x;});child.stderr.on('data',x=>{logs+=x;});
  const wait=async(check:()=>boolean,label:string)=>{for(let n=0;n<1000;n++){if(check())return;if(child.exitCode!==null)throw new Error('Media child exited: '+logs.slice(-1500));await new Promise(r=>setTimeout(r,20));}throw new Error('Timed out: '+label+' '+logs.slice(-1000));};
  try{
    let ready=false;for(let n=0;n<650;n++){if(child.exitCode!==null)throw new Error('Media child exited during startup: '+logs.slice(-3000));try{ready=(await fetch(service+'/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,30));}assert.ok(ready,'Media child starts: '+logs.slice(-3000));
    const twilio=createRequire(path.join(checkout,'package.json'))('twilio');
    const media=new WebSocket(service.replace('http:','ws:')+'/media-stream',{headers:{'x-twilio-signature':twilio.getExpectedTwilioSignature(token,service+'/media-stream',{})}});await once(media,'open');
    media.on('message',raw=>{const event=JSON.parse(String(raw));if(event.event==='mark'){marks++;media.send(JSON.stringify({event:'mark',mark:event.mark}));}});
    media.send(JSON.stringify({event:'start',start:{callSid,streamSid}}));
    const [ai]=await accepted as [WebSocket];
    const send=(event:any)=>ai.send(JSON.stringify(event));
    const results=new Map<string,any>(),notices:any[]=[];
    ai.on('message',raw=>{
      const event=JSON.parse(String(raw));
      if(event.type==='session.update')send({type:'session.updated',session:event.session});
      if(event.type==='conversation.item.create'){
        if(event.item.type==='function_call_output'){results.set(event.item.call_id,JSON.parse(event.item.output));send({type:'conversation.item.created',item:{...event.item,id:'ack_'+event.item.call_id}});}
        else if(event.item.role==='system')notices.push(event.item);
      }
      if(event.type==='response.create'){continuations++;const id='continuation_'+continuations;send({type:'response.created',response:{id}});send({type:'response.done',response:{id,status:'completed',output:[]}});}
    });
    send({type:'session.created'});await wait(()=>logs.includes('session.updated'),'session handshake');
    return {
      async pendingCaller(){send({type:'input_audio_buffer.speech_started'});send({type:'input_audio_buffer.speech_stopped'});send({type:'input_audio_buffer.committed',item_id:'pending_'+(++sequence)});await new Promise(r=>setTimeout(r,10));},
      async invoke(args:any){const id='tool_'+(++sequence);send({type:'response.created',response:{id}});send({type:'response.done',response:{id,status:'completed',output:[{type:'function_call',name:'hyperflow_briefing',call_id:id,arguments:JSON.stringify(args)}]}});await wait(()=>results.has(id),'tool result '+args.operation);const result=results.get(id);if(result.error&&!['confirmation_rejected','decision_required','note_required','input_pending'].includes(result.status))throw new Error(result.error);return result;},
      async interruptVerification(){send({type:'input_audio_buffer.speech_started'});send({type:'input_audio_buffer.speech_stopped'});send({type:'response.created',response:{id:'caller_waiting'}});send({type:'response.done',response:{id:'caller_waiting',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'audio',transcript:'Still processing'}]}]}});await new Promise(r=>setTimeout(r,50));},
      async interruptReadback(text:string){const item='interrupted_readback_'+(++sequence);send({type:'response.output_audio.delta',item_id:item,delta:'AAAA'});send({type:'response.output_audio_transcript.done',item_id:item,transcript:text});send({type:'input_audio_buffer.speech_started'});send({type:'response.output_audio.done',item_id:item});send({type:'input_audio_buffer.speech_stopped'});send({type:'input_audio_buffer.committed',item_id:'human_'+sequence});send({type:'conversation.item.input_audio_transcription.completed',item_id:'human_'+sequence,transcript:'confirm'});await new Promise(r=>setTimeout(r,10));},
      async confirmReadback(text:string,confirmation='confirm'){
        const item='readback_'+(++sequence),prior=marks;
        send({type:'response.output_audio.delta',item_id:item,delta:'AAAA'});
        send({type:'response.output_audio.done',item_id:item});
        await wait(()=>marks>prior,'Twilio playback mark');await new Promise(r=>setTimeout(r,5));
        send({type:'input_audio_buffer.speech_started'});send({type:'input_audio_buffer.speech_stopped'});
        send({type:'input_audio_buffer.committed',item_id:'human_'+sequence});
        send({type:'conversation.item.input_audio_transcription.completed',item_id:'human_'+sequence,transcript:confirmation});
        // Reproduce late readback transcription and the real intervening acknowledgement.
        send({type:'response.output_audio_transcript.done',item_id:item,transcript:text});
        await new Promise(r=>setTimeout(r,5));const ack='acknowledgement_'+sequence;
        send({type:'response.output_audio.delta',item_id:ack,delta:'AAAA'});send({type:'response.output_audio.done',item_id:ack});
        send({type:'response.output_audio_transcript.done',item_id:ack,transcript:'Thanks, I am saving that change now. One moment.'});
        await wait(()=>marks>prior+1,'acknowledgement playback');await new Promise(r=>setTimeout(r,5));
      },
      async assertVerificationHandoff(before:number){await wait(()=>notices.some(x=>JSON.stringify(x).includes('verification SUCCEEDED'))&&continuations>before&&logs.includes('deferred_tool_continuation'),'verification continuation');assert.match(logs,/Voice tool result acknowledged/);},
      get continuations(){return continuations;},
      async close(){media.terminate();ai.terminate();child.kill();if(child.exitCode===null)await once(child,'exit');await new Promise<void>(r=>wss.close(()=>r()));},
    };
  }catch(error){child.kill();wss.close();throw error;}
}
