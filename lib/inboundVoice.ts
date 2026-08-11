/**
 * Normalizes provider voice callbacks into the shape the orchestrator expects.
 * Kept free of Firebase and Vercel imports so it can be tested directly.
 */

export interface NormalizedVoiceEvent {
  eventId: string;
  orgId?: string;
  projectId?: string;
  nodeId?: string;
  runId?: string;
  status: 'success' | 'error';
  output: Record<string, any>;
  logs: string[];
  error?: string;
}

/**
 * Bland returns analysis values as strings ("true", "false") as often as native
 * types. Decision branches compare with `equals`, which is strict — so coerce
 * here rather than making every branch condition defensive.
 */
export const coerceAnalysisValue = (value: any): any => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^(null|none|n\/a)$/i.test(trimmed)) return null;
  return value;
};

export const coerceAnalysis = (analysis: any): Record<string, any> => {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return {};
  return Object.fromEntries(Object.entries(analysis).map(([k, v]) => [k, coerceAnalysisValue(v)]));
};

/** A call that was answered and ran to completion is a success; anything else is not. */
const isSuccessfulCall = (payload: any): boolean => {
  if (payload.status && String(payload.status).toLowerCase() === 'completed') return true;
  if (payload.completed === true && !payload.error_message) return true;
  return false;
};

export const normalizeBlandCallback = (rawBody: any): NormalizedVoiceEvent => {
  const payload = rawBody && typeof rawBody === 'object' ? rawBody : {};
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

  const analysis = coerceAnalysis(payload.analysis);
  const success = isSuccessfulCall(payload);

  const logs: string[] = [`Bland callback: status=${payload.status ?? 'unknown'}`];
  if (payload.answered_by) logs.push(`Answered by: ${payload.answered_by}`);
  if (payload.disposition_tag) logs.push(`Disposition: ${payload.disposition_tag}`);
  if (payload.error_message) logs.push(`Provider error: ${payload.error_message}`);

  // These keys are merged into projectData, so they are the contract that
  // downstream decision branches are written against.
  const output: Record<string, any> = {
    ...analysis,
    call_completed: success,
    call_status: payload.status ?? null,
    call_id: payload.call_id ?? null
  };
  if (payload.summary !== undefined) output.call_summary = payload.summary;
  if (payload.call_length !== undefined) output.call_length = payload.call_length;
  if (payload.recording_url) output.call_recording_url = payload.recording_url;
  if (payload.concatenated_transcript) output.call_transcript = payload.concatenated_transcript;
  if (payload.answered_by) output.call_answered_by = payload.answered_by;
  // Bland populates this on real calls (observed: "NOT_INTERESTED"). It is its own
  // read of how the call went, independent of the analysis schema, so it is worth
  // having in project data for branching.
  if (payload.disposition_tag) output.call_disposition = payload.disposition_tag;

  return {
    eventId: payload.call_id ? String(payload.call_id) : '',
    orgId: metadata.orgId ? String(metadata.orgId) : undefined,
    projectId: metadata.projectId ? String(metadata.projectId) : undefined,
    nodeId: metadata.nodeId ? String(metadata.nodeId) : undefined,
    runId: metadata.runId ? String(metadata.runId) : undefined,
    status: success ? 'success' : 'error',
    output,
    logs,
    error: success ? undefined : payload.error_message || `Call ended with status "${payload.status ?? 'unknown'}"`
  };
};
