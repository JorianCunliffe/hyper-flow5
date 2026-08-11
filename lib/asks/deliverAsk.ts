import type { AskChannel, HumanAsk } from '../../types.js';
import { createCommunicationsClient } from '../communications/client.js';
import type { CommunicationResult, CommunicationsClient } from '../communications/types.js';

export interface DeliverAskInput {
  ask: HumanAsk;
  orgId: string;
  projectId: string;
  personId: string;
  channel: Exclude<AskChannel, 'web'>;
  publicBaseUrl?: string;
  replyDomain?: string;
  client?: CommunicationsClient;
}

/** Delivers an already-created ask without creating a second channel identity. */
export const deliverAsk = async (input: DeliverAskInput): Promise<CommunicationResult> => {
  const client = input.client || createCommunicationsClient();
  const baseUrl = (input.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const replyDomain = input.replyDomain || process.env.ASK_REPLY_DOMAIN;
  const formUrl = baseUrl
    ? `${baseUrl}/forms/ask/${encodeURIComponent(input.ask.token)}?org=${encodeURIComponent(input.orgId)}&project=${encodeURIComponent(input.projectId)}`
    : undefined;

  return client.deliverAsk({
    ask_id: input.ask.id,
    ask_token: input.ask.token,
    channel: input.channel,
    person_id: input.personId,
    question: input.ask.prompt,
    response_type: input.ask.responseType || input.ask.kind,
    response_schema: input.ask.fields?.length ? { fields: input.ask.fields } : undefined,
    reply_to: input.channel === 'email' && replyDomain ? `ask+${input.ask.token}@${replyDomain}` : undefined,
    form_url: formUrl,
    correlation: {
      tenant_id: input.orgId,
      project_id: input.projectId,
      task_id: input.ask.nodeId,
      run_id: input.ask.runId
    }
  });
};
