/**
 * Vercel AI SDK provider configuration.
 *
 * HTTP calls (text generation, summaries) are routed through the Vercel AI
 * Gateway when VERCEL_AI_GATEWAY_URL is set, giving you observability, rate
 * limiting, and cost tracking in the Vercel dashboard.
 *
 * The OpenAI Realtime API (WebSocket) cannot be proxied through the Gateway —
 * that connection is always direct to OpenAI.
 *
 * Gateway URL format:
 *   https://gateway.ai.vercel.com/v1/<team_id>/<gateway_name>
 *
 * Find yours at: vercel.com/dashboard → AI → Gateways
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { TranscriptEntry } from '@/types';

const gatewayBase = process.env.VERCEL_AI_GATEWAY_URL?.replace(/\/$/, '');

export const openaiProvider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  // When the gateway URL is set, route HTTP AI calls through it.
  // The gateway expects the provider prefix, so we append /openai/v1.
  ...(gatewayBase ? { baseURL: `${gatewayBase}/openai/v1` } : {}),
});

// The Realtime WebSocket goes direct to OpenAI — gateway does not proxy WS.
export const OPENAI_REALTIME_WS_URL =
  'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

export async function generateCallSummary(
  transcript: TranscriptEntry[],
): Promise<string | null> {
  if (transcript.length === 0) return null;

  const text = transcript
    .map((t) => `${t.role === 'assistant' ? 'AI' : 'Caller'}: ${t.content}`)
    .join('\n');

  try {
    const { text: summary } = await generateText({
      model: openaiProvider('gpt-4o-mini'),
      maxTokens: 200,
      prompt: `Summarize this call transcript in 2–3 concise sentences.\n\n${text}`,
    });
    return summary;
  } catch (err) {
    console.error('[summary] generation failed:', err);
    return null;
  }
}
