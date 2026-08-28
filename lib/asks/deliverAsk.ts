import type { AskChannel, HumanAsk } from '../../types.js';
import { createCommunicationsClient } from '../communications/client.js';
import type { CommunicationResult, CommunicationsClient, HyperFlowCallOverrides } from '../communications/types.js';

export interface DeliverAskInput {
  ask: HumanAsk;
  orgId: string;
  projectId: string;
  personId: string;
  deliveryAskId?: string;
  deliveryToken?: string;
  recipient: string;
  fromNumber?: string;
  emailIdentity?: string;
  replyIdentity?: string;
  connectionId?: string;
  channel: Exclude<AskChannel, 'web'>;
  publicBaseUrl?: string;
  client?: CommunicationsClient;
}

const e164 = /^\+[1-9]\d{7,14}$/;
const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const callbackUrl = (baseUrl: string): string => {
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error('PUBLIC_BASE_URL must be an absolute HTTPS URL'); }
  if (parsed.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use HTTPS for Communications callbacks');
  return `${parsed.toString().replace(/\/$/, '')}/api/events`;
};

const callOverrides = (question: string): HyperFlowCallOverrides => ({
  systemMessage: `You are making an outbound call for HyperFlow. Ask the following question, keep the conversation focused on obtaining a clear answer, and do not claim the workflow is resolved: ${question}`,
  greetingText: `Begin by introducing the call briefly, then ask: ${question}`,
  aiSpeaksFirst: true,
  liveTranscript: true
});

/** Delivers an already-created ask without creating a second channel identity. */
export const deliverAsk = async (input: DeliverAskInput): Promise<CommunicationResult> => {
  const baseUrl = (input.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('PUBLIC_BASE_URL is required to deliver an ask');
  const formUrl = `${baseUrl}/forms/ask/${encodeURIComponent(input.deliveryToken || input.ask.token)}?org=${encodeURIComponent(input.orgId)}&project=${encodeURIComponent(input.projectId)}`;

  if (!input.ask.runId) throw new Error(`Ask ${input.ask.id} has no run_id correlation`);
  const client = input.client || createCommunicationsClient();
  const correlation = {
    tenant_id: input.orgId,
    external_project_id: input.projectId,
    task_id: input.ask.nodeId,
    run_id: input.ask.runId,
    person_id: input.personId
  };
  const purpose = {
    type: 'human_ask' as const,
    ask_id: input.deliveryAskId || input.ask.id,
    token: input.deliveryToken || input.ask.token
  };
  const callback_url = callbackUrl(baseUrl);

  if (input.channel === 'email') {
    const identity = (input.emailIdentity || process.env.COMMUNICATIONS_EMAIL_IDENTITY || '').trim();
    if (!identity) throw new Error('A Communications email service identity is required');
    return client.sendEmail({
      to: [input.recipient],
      service_identity_id: identity,
      provider_connection_id: input.connectionId || process.env.COMMUNICATIONS_CONNECTION_ID || undefined,
      reply_to: input.replyIdentity ? [input.replyIdentity] : undefined,
      subject: `HyperFlow response requested: ${input.ask.prompt.slice(0, 80)}`,
      text: `${input.ask.prompt}\n\nSecure response form: ${formUrl}`,
      html: `<p>${escapeHtml(input.ask.prompt)}</p><p><a href="${escapeHtml(formUrl)}">Open the secure response form</a></p>`,
      person_id: input.personId,
      purpose,
      correlation,
      callback_url
    });
  }

  const from = (input.fromNumber || process.env.COMMUNICATIONS_FROM_NUMBER || '').trim();
  if (!e164.test(from)) throw new Error('A valid E.164 Communications sending number is required');
  if (!e164.test(input.recipient)) throw new Error(`Person identity "${input.personId}" phone number must use E.164 format`);

  return input.channel === 'sms'
    ? client.sendSms({ to: input.recipient, from, body: input.ask.prompt, purpose, correlation, callback_url })
    : client.startCall({
        to: input.recipient, from, overrides: callOverrides(input.ask.prompt), purpose, correlation, callback_url
      });
};
