/**
 * Singleton WebSocket server — bridges Twilio Media Streams ↔ OpenAI Realtime API.
 *
 * Per-call configuration (prompt, voice, tools) is driven by phone_configs rows
 * looked up at call start. The voice webhook passes phoneConfigId as a custom
 * stream parameter; the stream handler loads the config and wires everything up.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'net';
import { supabase } from './supabase';
import { buildContextForNumber, buildSystemPrompt } from './prompts';
import { OPENAI_REALTIME_WS_URL, generateCallSummary } from './ai-provider';
import { REALTIME_TOOL_SCHEMAS, executeTool, type ToolName } from './tools';
import type { TranscriptEntry, PhoneConfig } from '@/types';

declare global {
  // eslint-disable-next-line no-var
  var __wss: WebSocketServer | undefined;
}

const STREAM_PATH = '/api/twilio/stream';

/* ─── Twilio Media Streams message types ─── */

interface TwilioStartPayload {
  streamSid: string;
  callSid: string;
  accountSid: string;
  tracks: string[];
  mediaFormat: { encoding: string; sampleRate: number; channels: number };
  customParameters?: Record<string, string>;
}

type TwilioMessage =
  | { event: 'connected' }
  | { event: 'start'; sequenceNumber: string; start: TwilioStartPayload; streamSid: string }
  | { event: 'media'; sequenceNumber: string; media: { payload: string }; streamSid: string }
  | { event: 'stop'; sequenceNumber: string; stop: { callSid: string }; streamSid: string }
  | { event: 'mark'; mark: { name: string }; streamSid: string };

/* ─── Per-call state ─── */

interface SessionState {
  callSid: string;
  streamSid: string;
  direction: 'inbound' | 'outbound';
  phoneNumber: string;
  twilioNumber: string;
  openAiWs: WebSocket | null;
  transcript: TranscriptEntry[];
  callDbId: string | null;
  ready: boolean;
  pendingAudio: string[];
}

/* ─── OpenAI session configuration ─── */

function makeSessionUpdate(
  systemPrompt: string,
  voice: string,
  enabledTools: string[],
): object {
  const tools = enabledTools
    .filter((n): n is ToolName => n in REALTIME_TOOL_SCHEMAS)
    .map((n) => REALTIME_TOOL_SCHEMAS[n]);

  return {
    type: 'session.update',
    session: {
      turn_detection: { type: 'server_vad' },
      input_audio_format: 'g711_ulaw',
      output_audio_format: 'g711_ulaw',
      voice,
      instructions: systemPrompt,
      modalities: ['text', 'audio'],
      temperature: 0.8,
      input_audio_transcription: { model: 'whisper-1' },
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    },
  };
}

/* ─── Per-call handler ─── */

async function handleTwilioConnection(twilioWs: WebSocket) {
  const state: SessionState = {
    callSid: '',
    streamSid: '',
    direction: 'inbound',
    phoneNumber: '',
    twilioNumber: '',
    openAiWs: null,
    transcript: [],
    callDbId: null,
    ready: false,
    pendingAudio: [],
  };

  function connectOpenAI(systemPrompt: string, voice: string, enabledTools: string[]) {
    const oaiWs = new WebSocket(OPENAI_REALTIME_WS_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });
    state.openAiWs = oaiWs;

    oaiWs.on('open', () => {
      oaiWs.send(JSON.stringify(makeSessionUpdate(systemPrompt, voice, enabledTools)));
      state.ready = true;

      // Flush buffered audio
      for (const audio of state.pendingAudio) {
        oaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
      }
      state.pendingAudio = [];

      // Outbound: AI speaks first
      if (state.direction === 'outbound') {
        oaiWs.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
        }));
        oaiWs.send(JSON.stringify({ type: 'response.create' }));
      }
    });

    oaiWs.on('message', async (raw: Buffer) => {
      try {
        const event = JSON.parse(raw.toString());

        // Forward audio to Twilio
        if (event.type === 'response.audio.delta' && event.delta) {
          if (twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({
              event: 'media',
              streamSid: state.streamSid,
              media: { payload: event.delta },
            }));
          }
        }

        // User interruption — clear Twilio's audio buffer
        if (event.type === 'input_audio_buffer.speech_started') {
          if (twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid: state.streamSid }));
          }
        }

        // AI transcript
        if (event.type === 'response.audio_transcript.done' && event.transcript) {
          state.transcript.push({ role: 'assistant', content: event.transcript, timestamp: new Date().toISOString() });
        }

        // User transcript (requires input_audio_transcription in session)
        if (
          event.type === 'conversation.item.created' &&
          event.item?.role === 'user' &&
          event.item?.content?.[0]?.transcript
        ) {
          state.transcript.push({ role: 'user', content: event.item.content[0].transcript, timestamp: new Date().toISOString() });
        }

        // Tool call from AI
        if (event.type === 'response.function_call_arguments.done') {
          const { name, call_id, arguments: argsStr } = event;
          let result: Record<string, unknown>;
          try {
            result = await executeTool(name, JSON.parse(argsStr), {
              phoneNumber: state.phoneNumber,
              twilioNumber: state.twilioNumber,
            });
          } catch (err) {
            result = { error: String(err) };
          }
          if (oaiWs.readyState === WebSocket.OPEN) {
            oaiWs.send(JSON.stringify({
              type: 'conversation.item.create',
              item: { type: 'function_call_output', call_id, output: JSON.stringify(result) },
            }));
            oaiWs.send(JSON.stringify({ type: 'response.create' }));
          }
        }
      } catch {
        // Non-fatal
      }
    });

    oaiWs.on('error', (err) => console.error('[OpenAI] error', err.message));
    oaiWs.on('close', () => console.log('[OpenAI] closed'));
  }

  /* Handle Twilio messages */
  twilioWs.on('message', async (raw: Buffer) => {
    let msg: TwilioMessage;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.event) {
      case 'start': {
        const { callSid, streamSid, customParameters } = msg.start;
        state.callSid = callSid;
        state.streamSid = streamSid;
        state.direction = (customParameters?.direction as 'inbound' | 'outbound') ?? 'inbound';
        state.phoneNumber = customParameters?.phoneNumber ?? '';
        state.twilioNumber = customParameters?.twilioNumber ?? '';

        const phoneConfigId = customParameters?.phoneConfigId ?? '';

        console.log(`[Stream] start  callSid=${callSid}  dir=${state.direction}  phone=${state.phoneNumber}`);

        // Load phone config if one was passed
        const { data: config } = phoneConfigId
          ? await supabase.from('phone_configs').select('*').eq('id', phoneConfigId).single() as { data: PhoneConfig | null }
          : { data: null as PhoneConfig | null };

        const voice = config?.call_voice ?? process.env.OPENAI_VOICE ?? 'alloy';
        const enabledTools = config?.enabled_tools ?? [];

        if (state.direction === 'outbound') {
          // Find call record pre-created by the outbound API
          const { data: existing } = await supabase
            .from('calls')
            .select('id, system_prompt')
            .eq('twilio_call_sid', callSid)
            .single();

          if (existing) {
            state.callDbId = existing.id;
            await supabase.from('calls').update({ status: 'in-progress' }).eq('id', existing.id);
            connectOpenAI(existing.system_prompt ?? '', voice, enabledTools);
            break;
          }
        }

        // Inbound (or outbound without pre-existing record)
        const { contact, contextBlock } = await buildContextForNumber(state.phoneNumber);

        // Auto-create unknown contact on first contact
        let contactId = contact?.id ?? null;
        if (!contactId && state.phoneNumber) {
          const { data: created } = await supabase
            .from('contacts')
            .insert({ phone_number: state.phoneNumber })
            .select('id')
            .single();
          contactId = created?.id ?? null;
        }

        const systemPrompt = config?.call_system_prompt
          ? `${config.call_system_prompt}\n\nCaller context:\n${contextBlock}`
          : buildSystemPrompt(state.direction, contextBlock);

        const { data: call } = await supabase
          .from('calls')
          .insert({
            twilio_call_sid: callSid,
            phone_number: state.phoneNumber,
            direction: state.direction,
            status: 'in-progress',
            contact_id: contactId,
            system_prompt: systemPrompt,
            metadata: { phoneConfigId },
          })
          .select('id')
          .single();

        state.callDbId = call?.id ?? null;
        connectOpenAI(systemPrompt, voice, enabledTools);
        break;
      }

      case 'media': {
        const audio = msg.media.payload;
        if (state.ready && state.openAiWs?.readyState === WebSocket.OPEN) {
          state.openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
        } else {
          state.pendingAudio.push(audio);
        }
        break;
      }

      case 'stop':
        await finalise(state);
        break;
    }
  });

  twilioWs.on('close', () => finalise(state));
  twilioWs.on('error', (err) => console.error('[Twilio WS] error', err.message));
}

async function finalise(state: SessionState) {
  if (state.openAiWs?.readyState === WebSocket.OPEN) state.openAiWs.close();

  if (state.callDbId) {
    const callDbId = state.callDbId;
    state.callDbId = null;

    const summary = await generateCallSummary(state.transcript);

    await supabase
      .from('calls')
      .update({ status: 'completed', transcript: state.transcript, summary, ended_at: new Date().toISOString() })
      .eq('id', callDbId)
      .is('ended_at', null);
  }
}

/* ─── Singleton initialisation ─── */

export function initWss(server: Server) {
  if (!global.__wss) {
    global.__wss = new WebSocketServer({ noServer: true });
    global.__wss.on('connection', handleTwilioConnection);
    console.log('[WSS] created');
  }

  const srv = server as Server & { __wsListening?: boolean };
  if (!srv.__wsListening) {
    srv.on('upgrade', (req: IncomingMessage, socket, head) => {
      if (req.url === STREAM_PATH && global.__wss) {
        global.__wss.handleUpgrade(req, socket as any, head, (ws) => {
          global.__wss!.emit('connection', ws, req);
        });
      }
    });
    srv.__wsListening = true;
    console.log('[WSS] upgrade listener attached');
  }
}
