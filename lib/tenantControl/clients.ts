import rewrites from '../../vercel.json';
import {
  createHash,
  randomUUID,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  API_GROUPS,
  TenantControlError,
  normalizeControl,
  type ControlStore,
  type ApiClient,
} from "./model.js";
const scrypt = promisify(scryptCallback);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export async function hashClientSecret(secret: string) {
  const salt = randomBytes(16).toString("hex");
  return (
    salt +
    ":" +
    Buffer.from((await scrypt(secret, salt, 32)) as Buffer).toString("hex")
  );
}
async function verifySecret(secret: string, encoded: string) {
  const [salt, hash] = encoded.split(":");
  if (!salt || !hash) return false;
  const actual = Buffer.from((await scrypt(secret, salt, 32)) as Buffer),
    expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const fail = (status: number, message: string): never => {
  throw new TenantControlError(status, message);
};
export type ControlMember = {
  orgId: string;
  uid: string;
  role: string;
  apiClientId?: string;
};
export function requestScope(req: {url?:string; method?:string; query?:any; body?:any}): string {
  let path=String(req.url||'').split('?')[0];
  const query={...Object.fromEntries(new URL(String(req.url||'/'),'http://localhost').searchParams),...req.query};
  // Normalize dispatcher URLs and canonical aliases to the same operation before authorization.
  for(const rewrite of [...rewrites.rewrites].sort((a,b)=>b.destination.length-a.destination.length)) {
    const target=new URL(rewrite.destination,'http://localhost');
    if(target.pathname===path && [...target.searchParams].length && [...target.searchParams].every(([k,v])=>query[k]===v)) {path=rewrite.source;break;}
  }
  if(query.action && ['/api/communications/status','/api/gemini'].includes(path))fail(403,'This endpoint requires a human session');
  let group=path.match(/^\/api\/([^/]+)/)?.[1];
  if(path.startsWith('/api/gemini'))group='workspace';
  if(path==='/api/workspace/resources')group='workspace-resources';
  if(['projects','nodes','subtasks','settings','ui-views','scratch-tasks'].includes(group||''))group='configuration';
  if(path==='/api/openapi.json')group='discovery';
  if(path==='/api/triage') {
    const scope=query.scope||req.body?.scope;
    if(scope==='capabilities')group='capabilities';
    if(scope==='workspace_resources')group='workspace-resources';
  }
  const b=req.body||{};
  const read=req.method==='GET' || path==='/api/communications/memory' ||
    (path==='/api/configuration' && ['validate','plan'].includes(b.operation)) ||
    (path==='/api/commitments' && b.action==='promise_ledger' && ['query','read','coverage'].includes(b.operation||'query')) ||
    (path==='/api/commitments' && b.action==='operational_review' && ['read','work'].includes(b.operation));
  if(!API_GROUPS.includes(group as any))fail(403,'This endpoint requires a human session');
  return `${group}:${read?'read':'write'}`;
}
export async function authenticateClient(
  token: string,
  scope: string,
  store: ControlStore,
  membership: (uid: string, org: string) => Promise<ControlMember>,
  requestedOrg?: string,
) {
  const parts = token.split(".");
  if (
    parts.length !== 4 ||
    parts[0] !== "hf" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(parts[1]) ||
    !/^client_[a-f0-9]{32}$/.test(parts[2]) ||
    !/^[a-zA-Z0-9_-]{32,256}$/.test(parts[3])
  )
    fail(401, "Invalid API credential");
  const [, org, id, secret] = parts;
  if (requestedOrg && requestedOrg !== org)
    fail(403, "API credential belongs to another organization");
  const initial = normalizeControl(await store.read(org)),
    client = initial.clients[id];
  if (
    !client ||
    client.revokedAt ||
    client.expiresAt <= Date.now() ||
    !(await verifySecret(secret, client.secretHash))
  )
    fail(401, "Invalid or expired API credential");
  if (!client.scopes.includes(scope))
    fail(403, "API credential lacks this scope");
  const member = await membership(client.uid, org);
  const now = Date.now(),
    day = new Date(now).toISOString().slice(0, 10);
  await store.transact(org, (raw) => {
    const r = normalizeControl(raw),
      current = r.clients[id];
    if (
      !current ||
      current.revision !== client.revision ||
      current.revokedAt ||
      current.expiresAt <= now
    )
      fail(401, "API credential changed");
    const usage = r.days[day] || { requests: 0, clients: {} };
    usage.clients ||= {};
    if (r.dailyLimit > 0 && usage.requests >= r.dailyLimit)
      fail(429, "Organization API request budget exhausted");
    usage.requests++;
    usage.clients[id] = (usage.clients[id] || 0) + 1;
    r.days[day] = usage;
    // Keep a disclosed 90-day UTC usage window; no message content is recorded.
    for (const key of Object.keys(r.days))
      if (key < new Date(now - 90 * 86400000).toISOString().slice(0, 10))
        delete r.days[key];
    current.lastUsedAt = now;
    if(scope.endsWith(':write')) {
      r.audit.push({id:randomUUID(),at:now,actor:member.uid,operation:'api.'+scope,resource:id});
      r.audit=r.audit.slice(-1000);
    }
    r.revision++;
    return r;
  });
  return { ...member, apiClientId: id };
}
const redact = (c: ApiClient) => {
  const { secretHash, requestHash, lastRotationHash, ...safe } = c;
  return safe;
};
export async function handleClientControl(
  request: { method?: string; body?: any },
  member: ControlMember,
  store: ControlStore,
) {
  if (!["owner", "admin"].includes(member.role))
    fail(403, "Administrator membership required");
  const initial = normalizeControl(await store.read(member.orgId));
  if (request.method === "GET")
    return {
      owner: "hyperflow",
      organizationId: member.orgId,
      revision: initial.revision,
      clients: Object.values(initial.clients).map(redact),
      dailyLimit: initial.dailyLimit,
      usage: initial.days,
      audit: initial.audit,
      retention: { usageDays: 90, auditEvents: 1000 },
    };
  if (request.method !== "POST") fail(405, "Method not allowed");
  if (member.apiClientId)
    fail(403, "A human administrator must manage API credentials and budgets");
  const b = request.body || {},
    operation = b.operation;
  if (
    !["create_client", "rotate_client", "revoke_client", "budget"].includes(
      operation,
    )
  )
    fail(400, "Unknown tenant operation");
  const now = Date.now(),
    id =
      operation === "create_client"
        ? "client_" +
          digest(member.uid + ":" + String(b.requestId)).slice(0, 32)
        : String(b.id || "");
  let secretHash = "",
    requestHash = "";
  if (["create_client", "rotate_client"].includes(operation)) {
    if (
      typeof b.secret !== "string" ||
      !/^[a-zA-Z0-9_-]{32,256}$/.test(b.secret)
    )
      fail(
        422,
        "Provide a high-entropy secret of 32 to 256 URL-safe characters",
      );
    if (
      !Number.isFinite(b.expiresAt) ||
      b.expiresAt <= now ||
      b.expiresAt > now + 366 * 86400000
    )
      fail(422, "Expiry must be within 366 days");
    secretHash = await hashClientSecret(b.secret);
    if (operation === "rotate_client")
      requestHash = digest(JSON.stringify([b.secret, b.expiresAt]));
  }
  if (operation === "create_client") {
    if (
      !/^[a-zA-Z0-9_-]{8,100}$/.test(b.requestId || "") ||
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 120
    )
      fail(422, "Stable request identity and client name required");
    const allowed = API_GROUPS.flatMap((g) => g==='tenant'?[g+':read']:[g + ":read", g + ":write"]);
    if (
      !Array.isArray(b.scopes) ||
      !b.scopes.length ||
      b.scopes.length > allowed.length ||
      b.scopes.some((s: any) => !allowed.includes(s))
    )
      fail(422, "Select supported API scopes");
    // Human administrators issue client authority; clients cannot delegate or amplify it.
    if (member.apiClientId)
      fail(403, "A human administrator must create API credentials");
    requestHash = digest(
      JSON.stringify([
        b.name.trim(),
        [...new Set(b.scopes)].sort(),
        b.secret,
        b.expiresAt,
      ]),
    );
  }
  const result = await store.transact(member.orgId, (raw) => {
    const r = normalizeControl(raw);
    let row = r.clients[id];
    if (operation === "create_client" && row) {
      if (row.requestHash !== requestHash)
        fail(409, "Request identity conflict");
      return r;
    }
    if (operation === "revoke_client" && row?.revokedAt) return r;
    if (
      operation === "rotate_client" &&
      row &&
      !row.revokedAt &&
      row.lastRotationHash === requestHash
    )
      return r;
    if (r.revision !== b.revision) fail(409, "Tenant settings changed; reload");
    if (operation === "budget") {
      if (
        !Number.isInteger(b.dailyLimit) ||
        b.dailyLimit < 0 ||
        b.dailyLimit > 1000000
      )
        fail(422, "Daily API request limit must be 0 to 1,000,000");
      if (member.apiClientId)
        fail(403, "A human administrator must change the budget");
      r.dailyLimit = b.dailyLimit;
    } else if (operation === "create_client") {
      if (Object.keys(r.clients).length >= 100)
        fail(422, "Client registry limit reached");
      row = {
        id,
        name: b.name.trim(),
        uid: member.uid,
        secretHash,
        scopes: [...new Set<string>(b.scopes)].sort(),
        createdAt: now,
        expiresAt: b.expiresAt,
        revision: 1,
        requestHash,
      };
      r.clients[id] = row;
    } else {
      if (!row) fail(404, "API client not found");
      if (member.apiClientId)
        fail(403, "A human administrator must rotate or revoke credentials");
      if (operation === "rotate_client") {
        if (row.revokedAt) fail(409, "A revoked client cannot be reactivated");
        row.secretHash = secretHash;
        row.lastRotationHash = requestHash;
        row.expiresAt = b.expiresAt;
      } else row.revokedAt = now;
      row.revision++;
    }
    r.audit.push({
      id: randomUUID(),
      at: now,
      actor: member.uid,
      operation,
      resource: id || "api_budget",
    });
    r.audit = r.audit.slice(-1000);
    r.revision++;
    return r;
  });
  return {
    owner: "hyperflow",
    revision: result.revision,
    item: result.clients[id] ? redact(result.clients[id]) : null,
    credentialPrefix: ["create_client", "rotate_client"].includes(operation)
      ? `hf.${member.orgId}.${id}.`
      : undefined,
    secretReturned: false,
  };
}
