/**
 * Singleton WebSocket server that bridges Twilio Media Streams ↔ OpenAI Realtime API.
 *
 * Stored on `global` so it survives Next.js hot-reload and is shared across
 * all API route invocations within the same Node.js process.  On Vercel the
 * voice webhook fires first (same instance), attaching the upgrade listener
 * before Twilio connects the WebSocket.  Configure maxDuration ≥ 300 in
 * vercel.json so the function stays alive for the call duration.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'net';
import { supabase } from './supabase';
import { buildContextForNumber, buildSystemPrompt } from './prompts';
import { OPENAI_REALTIME_WS_URL, generateCallSummary } from './ai-provider';
import type { TranscriptEntry } from '@/types';

declare global {
  // eslint-disable-next-line no-var
  var __wss: WebSocketServer | undefined;
}

const OPENAI_REALTIME_URL = OPENAI_REALTIME_WS_URL;
const STREAM_PATH = '/api/twilio/stream';

/* ─── Types for Twilio Media Streams protocol ─── */

interface TwilioStartPayload {
  streamSid: string;
  callSid: string;
  accountSid: string;
  tracks: string[];
  mediaFormat: { encoding: string; sampleRate: number; channels: number };
  customParameters?: Record<string, string>;
}

interface TwilioMediaPayload {
  track: string;
  chunk: string;
  timestamp: string;
  payload: string; // base64 G.711 μ-law
}

type TwilioMessage =
  | { event: 'connected' }
  | { event: 'start'; sequenceNumber: string; start: TwilioStartPayload; streamSid: string }
  | { event: 'media'; sequenceNumber: string; media: TwilioMediaPayload; streamSid: string }
  | { event: 'stop'; sequenceNumber: string; stop: { streamSid: string; callSid: string }; streamSid: string }
  | { event: 'mark'; mark: { name: string }; streamSid: string };

/* ─── Session state per call ─── */

interface SessionState {
  callSid: string;
  streamSid: string;
  direction: 'inbound' | 'outbound';
  phoneNumber: string;
  openAiWs: WebSocket | null;
  transcript: TranscriptEntry[];
  callDbId: string | null;
  ready: boolean;
  pendingAudio: string[];
}

/* ─── OpenAI Realtime session configuration ─── */

function makeSessionUpdate(systemPrompt: string) {
  return {
    type: 'session.update',
    session: {
      turn_detection: { type: 'server_vad' },
      input_audio_format: 'g711_ulaw',
      output_audio_format: 'g711_ulaw',
      voice: process.env.OPENAI_VOICE || 'alloy',
      instructions: systemPrompt,
      modalities: ['text', 'audio'],
      temperature: 0.8,
      input_audio_transcription: { model: 'whisper-1' },
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
    openAiWs: null,
    transcript: [],
    callDbId: null,
    ready: false,
    pendingAudio: [],
  };

  /* Connect to OpenAI Realtime API and bridge audio */
  function connectOpenAI(systemPrompt: string) {
    const oaiWs = new WebSocket(OPENAI_REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });
    state.openAiWs = oaiWs;

    oaiWs.on('open', () => {
      oaiWs.send(JSON.stringify(makeSessionUpdate(systemPrompt)));
      state.ready = true;

      // Flush audio buffered while OpenAI was connecting
      for (const audio of state.pendingAudio) {
        oaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
      }
      state.pendingAudio = [];

      // For outbound calls the AI greets first
      if (state.direction === 'outbound') {
        oaiWs.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'Hello' }],
            },
          }),
        );
        oaiWs.send(JSON.stringify({ type: 'response.create' }));
      }
    });

    oaiWs.on('message', (raw: Buffer) => {
      try {
        const event = JSON.parse(raw.toString());

        // Forward audio chunks back to Twilio
        if (event.type === 'response.audio.delta' && event.delta) {
          if (twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(
              JSON.stringify({
                event: 'media',
                streamSid: state.streamSid,
                media: { payload: event.delta },
              }),
            );
          }
        }

        // Capture AI transcript
        if (event.type === 'response.audio_transcript.done' && event.transcript) {
          state.transcript.push({
            role: 'assistant',
            content: event.transcript,
            timestamp: new Date().toISOString(),
          });
        }

        // Capture user transcript (requires input_audio_transcription in session)
        if (
          event.type === 'conversation.item.created' &&
          event.item?.role === 'user' &&
          event.item?.content?.[0]?.transcript
        ) {
          state.transcript.push({
            role: 'user',
            content: event.item.content[0].transcript,
            timestamp: new Date().toISOString(),
          });
        }
      } catch {
        // Non-fatal parse errors
      }
    });

    oaiWs.on('error', (err) => console.error('[OpenAI] error', err.message));
    oaiWs.on('close', () => console.log('[OpenAI] connection closed'));
  }

  /* Handle Twilio messages */
  twilioWs.on('message', async (raw: Buffer) => {
    let msg: TwilioMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case 'start': {
        const { callSid, streamSid, customParameters } = msg.start;
        state.callSid = callSid;
        state.streamSid = streamSid;
        state.direction = (customParameters?.direction as 'inbound' | 'outbound') || 'inbound';
        state.phoneNumber = customParameters?.phoneNumber || '';

        console.log(`[Stream] call started  callSid=${callSid}  direction=${state.direction}  phone=${state.phoneNumber}`);

        if (state.direction === 'outbound') {
          // Outbound: find the call record created by the API and reuse its prompt
          const { data: existing } = await supabase
            .from('calls')
            .select('id, system_prompt')
            .eq('twilio_call_sid', callSid)
            .single();

          if (existing) {
            state.callDbId = existing.id;
            await supabase.from('calls').update({ status: 'in-progress' }).eq('id', existing.id);
            connectOpenAI(existing.system_prompt || '');
            break;
          }
        }

        // Inbound (or outbound record not found): create new call record
        const { contact, contextBlock } = await buildContextForNumber(state.phoneNumber);
        const systemPrompt = buildSystemPrompt(state.direction, contextBlock);

        const { data: call } = await supabase
          .from('calls')
          .insert({
            twilio_call_sid: callSid,
            phone_number: state.phoneNumber,
            direction: state.direction,
            status: 'in-progress',
            contact_id: contact?.id ?? null,
            system_prompt: systemPrompt,
          })
          .select('id')
          .single();

        state.callDbId = call?.id ?? null;
        connectOpenAI(systemPrompt);
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

      case 'stop': {
        console.log(`[Stream] call stopped  callSid=${state.callSid}`);
        await finalise(state);
        break;
      }
    }
  });

  twilioWs.on('close', async () => {
    await finalise(state);
  });

  twilioWs.on('error', (err) => console.error('[Twilio WS] error', err.message));
}

async function finalise(state: SessionState) {
  // Close OpenAI connection if still open
  if (state.openAiWs && state.openAiWs.readyState === WebSocket.OPEN) {
    state.openAiWs.close();
  }

  // Update call record — guard against double-write
  if (state.callDbId) {
    const callDbId = state.callDbId;
    state.callDbId = null; // prevent double-write on concurrent close + stop events

    // Generate summary via Vercel AI SDK (routed through Gateway if configured)
    const summary = await generateCallSummary(state.transcript);

    await supabase
      .from('calls')
      .update({
        status: 'completed',
        transcript: state.transcript,
        summary,
        ended_at: new Date().toISOString(),
      })
      .eq('id', callDbId)
      .is('ended_at', null);
  }
}

/* ─── Public: initialise the singleton and attach to the HTTP server ─── */

export function initWss(server: Server) {
  if (!global.__wss) {
    global.__wss = new WebSocketServer({ noServer: true });
    global.__wss.on('connection', handleTwilioConnection);
    console.log('[WSS] WebSocket server created');
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
