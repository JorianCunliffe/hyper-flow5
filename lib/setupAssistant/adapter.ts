import { fail, redact } from './safety.js';
import type { SetupScope } from './types.js';

export type SetupApi = (method: string, path: string, body?: any, query?: any) => Promise<any>;
/** Fixed route table. No network fetch, arbitrary URLs, code tools, or model-owned writes. */
export function authenticatedApi(headers: Record<string, any>): SetupApi {
  return async (method, path, body, query = {}) => {
    let handler: any, fixed: any = {};
    if (['/api/reception', '/api/discovery', '/api/configuration', '/api/test-runs', '/api/calendar'].includes(path)) {
      handler = (await import('../../api/gemini/index.js')).default;
      fixed = { action: path.split('/').at(-1) === 'test-runs' ? 'test_runs' : path.split('/').at(-1) };
    } else if (['/api/integrations', '/api/service-projects/status', '/api/integrations/google/resources'].includes(path)) {
      handler = (await import('../../api/communications/status.js')).default;
      fixed = path === '/api/integrations' ? { action: 'integrations' } : path === '/api/service-projects/status' ? { action: 'service_setup_status' } : { action: 'google_resources' };
    } else if (path === '/api/workspace/resources') {
      handler = (await import('../../api/triage/index.js')).default; fixed = { scope: 'workspace_resources' };
    } else if (path === '/api/schedules' || path === '/api/schedules/run') {
      handler = (await import('../../api/schedules/index.js')).default; fixed = path.endsWith('/run') ? { action: 'run' } : {};
    } else if (path === '/api/flow/advance') handler = (await import('../../api/flow/advance.js')).default;
    else fail(403, 'Unsupported setup API route.');
    let code = 200, result: any;
    const response: any = { setHeader() {}, status(n: number) { code = n; return this; }, json(value: any) { result = value; return this; }, end() { return this; }, send(value: any) { result = value; return this; } };
    await handler({ headers, method, url: path, query: { ...query, ...fixed }, body }, response);
    if (code >= 400) fail(code, String(redact(result?.error || `API request failed (${code})`)));
    return result;
  };
}
export function readTools(api: SetupApi, scope: SetupScope) {
  return async (name: string, args: any = {}) => {
    if (name === 'read_configuration') {
      const configuration = await api('GET', '/api/configuration');
      return redact({ revision: configuration.revision, settings: configuration.settings, projects: configuration.projects.filter((p: any) => p.id === scope.projectId) });
    }
    if (name === 'reception') {const r=await api('GET','/api/reception');return redact({revision:r.config.revision,enabled:r.enabled,project:r.config.projects.find((p:any)=>p.projectId===scope.projectId),lines:r.config.lines.filter((l:any)=>l.projectIds.includes(scope.projectId)).map((l:any)=>({id:l.id,identity:l.identity,enabled:l.enabled,name:l.name}))});}
    if (name === 'discovery') return api('GET', '/api/discovery');
    if (name === 'integrations') return redact(await api('GET', '/api/integrations'));
    if (name === 'resources') return scope.kind === 'new' ? { resources: [] } : redact(await api('GET', '/api/workspace/resources', undefined, { projectId: scope.projectId }));
    if (name === 'schedules') return redact({ data: (await api('GET', '/api/schedules')).data.filter((s: any) => s.projectId === scope.projectId) });
    if (name === 'diaries') {
      const result = await api('GET', '/api/calendar', undefined, scope.kind === 'new' ? {} : { projectId: scope.projectId });
      return redact({ items: (result.items || []).map((r: any) => ({ id: r.id, calendarId: r.calendarId, connectionId: r.connectionId, policies: r.policies })), connections: result.connections });
    }
    if (name === 'calendars') {
      const integrations = await api('GET', '/api/integrations');
      if (!(integrations.workspaces || []).some((w: any) => w.connectionId === args.connectionId || w.id === args.connectionId)) fail(403, 'Select an existing workspace connection.');
      return redact(await api('GET', '/api/calendar', undefined, { operation: 'calendars', connectionId: args.connectionId }));
    }
    if (name === 'diagnostics') return scope.kind === 'new' ? { status: 'not_saved', providerAvailability: 'not_checked' } : redact(await api('GET', '/api/service-projects/status', undefined, { projectId: scope.projectId }));
    if (name === 'workspace_items') {
      if (!['document', 'spreadsheet'].includes(args.kind) || typeof args.connectionId !== 'string') fail(422, 'Select a connected workspace and resource kind.');
      const integrations = await api('GET', '/api/integrations');
      if (!(integrations.workspaces || []).some((w: any) => w.connectionId === args.connectionId || w.id === args.connectionId)) fail(403, 'Select an existing workspace connection.');
      return redact(await api('GET', '/api/integrations/google/resources', undefined, { connectionId: args.connectionId, kind: args.kind }));
    }
    fail(403, 'The setup model has only the listed read-only tools.');
  };
}
