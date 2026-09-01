import type { IncomingHttpHeaders } from 'node:http';
import { bearerToken, hasSharedSecret } from './apiAuth.js';
import { verifyCommunicationsSignatureV2 } from './communications/webhook.js';

export interface SchedulerAuthRequest {
  method?: string;
  headers: IncomingHttpHeaders;
}

export interface SchedulerSecrets {
  schedulerSecret?: string;
  cronSecret?: string;
  communicationsWebhookSecret?: string;
}

export const schedulerAuthenticationConfigured = (secrets: SchedulerSecrets): boolean =>
  Boolean(secrets.schedulerSecret || secrets.cronSecret || secrets.communicationsWebhookSecret);

export const isSchedulerTickAuthorized = (
  request: SchedulerAuthRequest,
  secrets: SchedulerSecrets,
  now = Date.now()
): boolean => {
  if (hasSharedSecret(request.headers['x-hyperflow-scheduler-secret'], secrets.schedulerSecret)) return true;
  if (hasSharedSecret(bearerToken(request as any), secrets.cronSecret)) return true;
  if (request.method !== 'POST' || !secrets.communicationsWebhookSecret) return false;
  return verifyCommunicationsSignatureV2(
    '',
    request.headers['x-communications-signature-v2'],
    request.headers['x-communications-timestamp'],
    secrets.communicationsWebhookSecret,
    now
  );
};
