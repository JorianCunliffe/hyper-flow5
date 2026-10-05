import type { HumanAsk, HumanResponse } from '../../types.js';
import type { FlowRun } from '../flowRuntimeTypes.js';

/** Only speaker-labelled caller turns qualify. Flat or mixed transcripts are
 * deliberately insufficient: assistant prompts and quoted sources aren't commands. */
export function voiceCancellationText(transcript: unknown): string | undefined {
  if (!transcript || typeof transcript !== 'object') return;
  const segments = (transcript as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) return;
  const caller = segments.filter(s => s?.role === 'user' && s?.speaker === 'caller' && typeof s.text === 'string');
  const last = caller.at(-1)?.text?.trim();
  if (!last) return;
  // Match a whole spoken sentence, never a substring in a negation or quotation.
  const commands = last.split(/[.!?\n]+/).map((s: string) => s.trim());
  return commands.some((s: string) => /^(?:please\s+)?(?:you can\s+)?(?:cancel|stop)\s+(?:all\s+)?(?:the\s+)?(?:rest(?:\s+of\s+(?:it|this|the questions))?|remaining questions|this (?:test|run|workflow)|the (?:test|run|workflow|questions))(?:\s+please)?$/i.test(s)) ? last : undefined;
}

/** Recover cancellations recorded by older versions before any further work. */
export function recordedVoiceCancellation(run: FlowRun) {
  for (const node of run.state.milestones) for (const ask of node.asks || []) {
    if (ask.status !== 'open') continue;
    for (const response of [...ask.responses].reverse()) {
      if (response.via !== 'voice' || response.raw?.source !== 'communications' || !response.communicationId) continue;
      if (!ask.deliveries?.some(d => d.communicationId === response.communicationId && d.personId === response.actor)) continue;
      if (voiceCancellationText(response.raw?.payload?.transcript)) return { ask, response };
    }
  }
}

/** Cancelling a human wait stops its occurrence, never resolves it as success. */
export function cancelledVoiceAskRun(run: FlowRun, ask: HumanAsk, text: string, communicationId: string, now: number): FlowRun {
  if (run.status === 'cancelled') return run;
  if (!['waiting', 'running'].includes(run.status) || ask.status !== 'open' || ask.projectId !== run.projectId) throw new Error('Ask is no longer cancellable');
  const node = run.state.milestones.find(n => n.id === ask.nodeId);
  if (!node?.asks?.some(a => a.id === ask.id && a.status === 'open')) throw new Error('Ask does not belong to this run');
  const response: HumanResponse = { id: `cancel_${ask.id}_${communicationId}`, at: now, via: 'voice', actor: ask.deliveries?.find(d => d.communicationId === communicationId)?.personId || 'caller', text, communicationId, intent: 'cancel_remaining_questions', needsInterpretation: false };
  return { ...run, status: 'cancelled', cancelledAt: now, updatedAt: now,
    state: { ...run.state, milestones: run.state.milestones.map(n => ({ ...n,
      asks: n.asks?.map(a => a.status !== 'open' ? a : { ...a, status: 'cancelled' as const, escalationState: undefined,
        responses: a.id === ask.id ? [...a.responses, response] : a.responses })
    })) } };
}
