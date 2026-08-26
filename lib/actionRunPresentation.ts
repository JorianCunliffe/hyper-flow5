import { ActionRun, CommunicationOutcome, NodeType } from '../types.js';

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export const communicationOutcomeFromOutput = (output: unknown): CommunicationOutcome | undefined => {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const row = output as Record<string, unknown>;
  const outcome: CommunicationOutcome = {
    businessStatus: stringValue(row.business_status),
    disposition: stringValue(row.disposition),
    successful: typeof row.successful === 'boolean' ? row.successful : undefined,
    memoryEligible: typeof row.memory_eligible === 'boolean' ? row.memory_eligible : undefined,
    failureCode: stringValue(row.failure_code),
    failureReason: stringValue(row.failure_reason) || stringValue(row.error),
    providerStatus: stringValue(row.provider_status),
    source: stringValue(row.outcome_source),
    confidence: typeof row.outcome_confidence === 'number' ? row.outcome_confidence : undefined,
  };
  return Object.values(outcome).some(value => value !== undefined) ? outcome : undefined;
};

const DISPOSITION_LABELS: Record<string, string> = {
  human_completed: 'Completed',
  voicemail: 'Voicemail',
  wrong_number: 'Wrong number',
  no_answer: 'No answer',
  busy: 'Busy',
  fax: 'Fax detected',
  automated_system: 'Automated system',
  no_meaningful_response: 'No response',
  provider_failed: 'Provider failed',
  canceled: 'Cancelled',
  unclassified: 'Could not verify',
};

export const formatCommunicationDisposition = (disposition?: string): string | undefined =>
  disposition ? DISPOSITION_LABELS[disposition] || disposition.replace(/_/g, ' ').replace(/^./, value => value.toUpperCase()) : undefined;

export const actionRunStatusLabel = (run: ActionRun, nodeType?: NodeType): string => {
  if (run.status === 'pending') return 'Waiting';
  const outcome = run.communicationOutcome || communicationOutcomeFromOutput(run.output);
  if (run.status === 'error') return formatCommunicationDisposition(outcome?.disposition) || 'Failed';
  if (nodeType === NodeType.SMS) return 'Delivered';
  if (nodeType === NodeType.EMAIL) return 'Sent';
  return formatCommunicationDisposition(outcome?.disposition) || 'Completed';
};

export const actionRunStatusClasses = (run: ActionRun): string => {
  if (run.status === 'pending') return 'bg-amber-50 border-amber-200 text-amber-800';
  if (run.status === 'success') return 'bg-emerald-50 border-emerald-200 text-emerald-800';
  return 'bg-red-50 border-red-200 text-red-700';
};
