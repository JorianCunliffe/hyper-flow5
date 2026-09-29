import { safeWebhookFetch, type SafeWebhookResponse } from './safeWebhook.js';

type Scope = { orgId?: string; projectId?: string };
type Fetcher = (url: string, init: RequestInit) => Promise<SafeWebhookResponse>;

/** Read-only connections. Secrets are resolved only after trusted scope checks. */
export async function executeNamedWebhook(
  input: Record<string, unknown>, scope: Scope | undefined,
  env: NodeJS.ProcessEnv = process.env, fetcher: Fetcher = safeWebhookFetch
): Promise<Record<string, unknown>> {
  const name = input.connection_name;
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
    throw new Error('Invalid webhook connection name');
  }
  if (Object.keys(input).some(key => !['connection_name', 'method'].includes(key)) ||
      (input.method !== undefined && input.method !== 'GET')) {
    throw new Error('Named webhook connections accept GET only, with no URL, headers or payload overrides');
  }
  let registry: any;
  try { registry = JSON.parse(env.WEBHOOK_CONNECTIONS_JSON || '{}'); }
  catch { throw new Error('Named webhook connection configuration is invalid'); }
  const config = registry && Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : undefined;
  if (!config || !scope?.orgId || !scope.projectId || config.orgId !== scope.orgId ||
      !Array.isArray(config.projectIds) || !config.projectIds.includes(scope.projectId)) {
    throw new Error('Named webhook connection is not configured for this project');
  }
  if (typeof config.urlEnv !== 'string' || !/^WEBHOOK_SECRET_[A-Z0-9_]+$/.test(config.urlEnv) ||
      !Array.isArray(config.responsePath) || !config.responsePath.length ||
      config.responsePath.some((key: unknown) => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))) {
    throw new Error('Named webhook connection configuration is invalid');
  }
  const url = env[config.urlEnv];
  if (!url) throw new Error('Named webhook connection secret is missing');
  // No raw provider exception, URL, query credential, or response envelope is returned.
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) throw new Error();
    const response = await fetcher(url, { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error();
    let selected: any = JSON.parse(response.text);
    // Optional provider success discriminator avoids accepting an error envelope as availability.
    if (config.successField && (!Object.prototype.hasOwnProperty.call(selected, config.successField) ||
        selected[config.successField] !== config.successValue)) throw new Error();
    for (const key of config.responsePath) {
      if (selected === null || typeof selected !== 'object' || !Object.prototype.hasOwnProperty.call(selected, key)) throw new Error();
      selected = selected[key];
    }
    if (selected === null || selected === undefined) throw new Error();
    const encoded = JSON.stringify(selected);
    const secrets = [url, ...Array.from(parsedUrl.searchParams.values()).filter(value => value.length >= 8)];
    if (secrets.some(secret => encoded.includes(secret) || encoded.includes(encodeURIComponent(secret)))) throw new Error();
    return {
      webhook_called: true, webhook_status: response.status, webhook_response: selected,
      webhook_connection: name, webhook_fetched_at: new Date().toISOString()
    };
  } catch {
    throw new Error('Named webhook request failed or returned an invalid response; check the server-side connection');
  }
}
