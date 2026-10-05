import { fileDependencies } from '../files/api.js';
import { transcriptionDownload } from '../files/provider.js';
import { FileError, fileKey, type ManagedFile } from '../files/model.js';
import { HttpCommunicationsClient } from './client.js';
import { MeetingRequestError } from './meetings.js';

export const AUDIO_SOURCE = 'hyperflow_audio_intake';
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIO_EXTENSIONS = /\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)$/i;
type Member = { orgId:string; uid:string };
export const audioDependencies = {
  files: fileDependencies,
  sign: transcriptionDownload,
  client: () => new HttpCommunicationsClient() as Pick<HttpCommunicationsClient,'findRecording'|'queueRecording'>,
  now: () => Date.now(),
};
function owned(file:ManagedFile|null, member:Member): asserts file is ManagedFile {
  if (!file || file.actor!==member.uid || file.visibility!=='private' || file.state!=='ready' || !file.generation)
    throw new MeetingRequestError(404,'Private recording is not available to this user.');
}
function summary(file:ManagedFile) {
  return {fileId:file.id,name:file.name,createdAt:file.createdAt};
}
function safeRecording(row:any, file:ManagedFile) {
  if (row.source!==AUDIO_SOURCE || row.external_id!==file.audioIntake?.externalId || row.metadata?.intake_pending!==true)
    throw new MeetingRequestError(409,'Recording receipt does not match this intake.');
  const status = ['pending','transcribing','done','failed'].includes(row.status)?row.status:'pending';
  // Explicit allowlist: media URLs, raw provider errors and other recording metadata never leave the server.
  return {...summary(file),status,recordingId:row.id,
    ...(status==='failed'?{message:'Transcription failed. Ask an administrator to inspect the provider before retrying this recording.'}:{}),
    ...(status==='done'?{segments:(row.transcript?.segments||[]).map((s:any,i:number)=>({
      id:`audio-${i+1}`,speakerId:null,speaker:typeof s.speaker==='string'?s.speaker:'Unknown speaker',
      text:typeof s.text==='string'?s.text:'',
      ...(Number.isFinite(s.startMs)?{startMs:s.startMs}:{}),...(Number.isFinite(s.endMs)?{endMs:s.endMs}:{})
    })),text:typeof row.transcript_text==='string'?row.transcript_text:''}:{}),
  };
}
export async function handleMeetingAudio(req:{method?:string;query?:any;body?:any}, member:Member, deps=audioDependencies) {
  try {
    if (!deps.files.enabled()) throw new MeetingRequestError(503,'Private file storage is not enabled. An administrator must provision storage before audio intake. Pasted notes remain available.');
    if ((await deps.files.lifecycle(member.orgId)).state!=='active') throw new MeetingRequestError(409,'Account file activity is paused.');
    if(req.method==='GET' && !req.query?.fileId) {
      const after=req.query?.after?fileKey(req.query.after):undefined;
      const files=await deps.files.list(member.orgId,after||'',100) as ManagedFile[];
      return {data:files.filter(f=>f.actor===member.uid && f.visibility==='private' && f.state==='ready' && AUDIO_EXTENSIONS.test(f.name) && f.bytes<=AUDIO_MAX_BYTES).map(summary),next:files.length===100?files[99].id:null};
    }
    if(req.method!=='GET' && !(req.method==='POST' && req.body?.operation==='audio_start')) throw new MeetingRequestError(405,'Unsupported audio intake operation.');
    const id=fileKey(req.method==='GET'?req.query.fileId:req.body.fileId);
    let file=await deps.files.read(member.orgId,id);
    owned(file,member);
    if(file.bytes>AUDIO_MAX_BYTES || !AUDIO_EXTENSIONS.test(file.name) || !/^(audio\/|video\/(mp4|webm)$|application\/octet-stream$)/.test(file.mime))
      throw new MeetingRequestError(422,'Choose MP3, MP4, M4A, MPEG, MPGA, WAV or WebM audio up to 25 MB.');
    if(req.method==='POST' && !file.audioIntake) {
      const signed=await deps.sign(file);
      const intake={generation:file.generation!,externalId:`file-${file.id}`,mediaSecret:signed.url,expiresAt:signed.expiresAt,createdAt:deps.now()};
      const generation=file.generation;
      file=await deps.files.transact(member.orgId,id,current=>{
        owned(current,member);
        if(current.generation!==generation) throw new MeetingRequestError(409,'Recording changed. Reload before transcribing.');
        return current.audioIntake?current:{...current,audioIntake:intake};
      });
      owned(file,member);
    }
    const intake=file.audioIntake;
    if(!intake) return {...summary(file),status:'not_queued'};
    if(intake.generation!==file.generation) throw new MeetingRequestError(409,'Recording generation changed; operator review required.');
    const client=deps.client();
    let row=await client.findRecording(member.orgId,AUDIO_SOURCE,intake.externalId);
    if(row) return safeRecording(row,file);
    if(req.method==='GET') return {...summary(file),status:'not_queued',message:'No recording receipt yet. Resume transcription using this same upload.'};
    if(intake.expiresAt<=deps.now()) throw new MeetingRequestError(409,'The private audio handoff expired. No new transcription was dispatched; an administrator must reconcile this recording.');
    await client.queueRecording(member.orgId,{
      source:AUDIO_SOURCE,externalId:intake.externalId,mediaUrl:intake.mediaSecret,
      recordedAt:new Date(file.createdAt).toISOString(),title:file.name,
      metadata:{private:true,visibility:'private',intake_pending:true,memory_eligible:false,audio_filename:file.name},
    });
    row=await client.findRecording(member.orgId,AUDIO_SOURCE,intake.externalId);
    return row?safeRecording(row,file):{...summary(file),status:'pending',message:'Transcription requested. Refresh to reconcile the receipt.'};
  } catch(error) {
    if(error instanceof MeetingRequestError) throw error;
    if(error instanceof FileError) throw new MeetingRequestError(error.status,error.message);
    // Provider exceptions may contain signed URLs. Do not echo or log them.
    throw new MeetingRequestError(503,'Audio intake is temporarily unavailable. Refresh this same upload to reconcile its status; do not create another upload.');
  }
}
