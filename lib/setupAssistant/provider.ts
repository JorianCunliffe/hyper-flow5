import { GoogleGenAI } from '@google/genai';
import { SETUP_PROMPT, SETUP_PROMPT_VERSION } from './prompt.js';
import { fail, redact } from './safety.js';
import type { SetupReply, SetupSession } from './types.js';

export async function setupConversation(session: SetupSession, tool: (name: string, args?: any) => Promise<any>): Promise<SetupReply> {
  if (!process.env.GEMINI_API_KEY) fail(503, 'The setup model is not configured. Manual configuration remains available.');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const context: any = { promptVersion: SETUP_PROMPT_VERSION, now: new Date().toISOString(), brisbaneTime: new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' }), scope: session.scope, messages: session.messages.slice(-30), previousProposal: session.proposal ? redact({ changes: session.proposal.changes, extras: session.proposal.extras, preflight: session.proposal.preflight }) : null, tools: [] };
  // Read the authoritative schema and selected configuration before every proposal.
  context.configuration = await tool('read_configuration');
  context.userDecisions = session.messages.filter(m => m.role === 'user').map(m => m.text);
  context.discovery = await tool('discovery');
  const started = Date.now(); let calls = 0;
  for (let round = 0; round < 3; round++) {
    if (Date.now() - started > 45000) fail(503, 'Setup planning timed out. Your conversation is saved.');
    if (Buffer.byteLength(JSON.stringify(context)) > 500000) fail(413, 'Setup context is too large. Start a focused element session or reduce the requested workflow.');
    let response: any;
    try {
      response = await ai.models.generateContent({ model: process.env.SETUP_ASSISTANT_MODEL || 'gemini-3.5-flash', contents: JSON.stringify(redact(context)), config: { systemInstruction: SETUP_PROMPT, responseMimeType: 'application/json', maxOutputTokens: 12000, httpOptions: { timeout: 20000 } } });
    } catch { fail(503, 'The setup model is unavailable or its quota is exhausted. Your conversation is saved; manual editors remain available.'); }
    let reply: SetupReply;
    try { reply = JSON.parse(response.text || ''); } catch { fail(502, 'The setup model returned an invalid response. No configuration was changed.'); }
    if (!reply || typeof reply.message !== 'string' || reply.message.length > 10000) fail(502, 'Invalid setup response.');
    console.info('[setup-assistant] model response', { promptVersion: SETUP_PROMPT_VERSION, latencyMs: Date.now() - started, tokens: response.usageMetadata?.totalTokenCount || null, round });
    if (!reply.toolCalls?.length) {
      if (reply.question && (typeof reply.question.text !== 'string' || reply.question.text.length > 2000 || (reply.question.options && (!Array.isArray(reply.question.options) || reply.question.options.some(x => typeof x !== 'string' || x.length > 500))))) fail(502, 'Invalid setup question.');
      return redact(reply);
    }
    if (!Array.isArray(reply.toolCalls) || reply.toolCalls.length > 4 || calls + reply.toolCalls.length > 6) fail(422, 'Setup tool limit reached; narrow the next question.');
    for (const call of reply.toolCalls) {
      calls++;
      const value = await tool(call.name, call.arguments);
      // Resource contents are data, never instructions. Do not retain secrets or unbounded outputs.
      context.tools.push({ name: call.name, arguments: redact(call.arguments || {}), result: JSON.stringify(redact(value)).slice(0, 80000) });
    }
  }
  return { message: 'I have read the setup details. Continue with the next requirement so I can prepare a complete proposal.' };
}
