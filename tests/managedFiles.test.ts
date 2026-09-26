import test from "node:test";
import {readFileSync} from 'node:fs';
import assert from "node:assert/strict";
import { handleFiles, fileDependencies } from "../lib/files/api";
import {
  FILE_CHUNK_BYTES,
  FileError,
  type ManagedFile,
} from "../lib/files/model";
import { crc32cUpdate, crc32cBase64 } from "../lib/files/crc32c";
import { lifecycleRecord, beginLifecycle } from "../lib/tenantLifecycle/model";
import { requestScope } from "../lib/tenantControl/clients";
import { uploadManagedFile } from "../services/managedFiles";
test('managed file contract is routed and scoped in both deployments',()=>{
  const config=JSON.parse(readFileSync('vercel.json','utf8'));
  const target=config.rewrites.find((r:any)=>r.source==='/api/files')?.destination;
  assert.equal(target,'/api/gemini?action=files');
  assert.match(readFileSync('lib/http/express.ts','utf8'),/config.rewrites/);
  assert.match(readFileSync('lib/http/express.ts','utf8'),/gemini from/);
  assert.ok(JSON.parse(readFileSync('contracts/phase11.openapi.json','utf8')).paths['/api/files']);
});
function fixture() {
  const rows = new Map<string, ManagedFile>(),
    leases = new Set<string>(),
    objects = new Map<string, Buffer>();
  let queue = Promise.resolve(),
    losePut = false,
    failClose = false,
    creates = 0,
    writes = 0,
    enabled = true;
  const deps: typeof fileDependencies = {
    ...fileDependencies,
    enabled: () => enabled,
    lifecycle: async () => lifecycleRecord(null),
    read: async (org, id) => structuredClone(rows.get(org + "/" + id) || null),
    list: async (org, after, limit) =>
      [...rows.entries()]
        .filter(([key, r]) => key.startsWith(org + "/") && r.id > after)
        .map(([, r]) => structuredClone(r))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit),
    transact: async (org, id, fn) => {
      const result = queue.then(() => {
        const r = fn(structuredClone(rows.get(org + "/" + id) || null));
        rows.set(org + "/" + id, structuredClone(r));
        return structuredClone(r);
      });
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    },
    reserve: async (org, id) => {
      leases.add(org + "/" + id);
    },
    release: async (org, id) => {
      leases.delete(org + "/" + id);
    },
    provider: {
      create: async (file) => {
        creates++;
        objects.set(file.path, Buffer.alloc(0));
        return "https://storage.googleapis.com/upload/storage/v1/session?upload_id=fixture-secret";
      },
      progress: async (file) => {
        const bytes = objects.get(file.path) || Buffer.alloc(0);
        return {
          offset: bytes.length,
          ...(bytes.length === file.bytes
            ? {
                object: {
                  generation: "12345",
                  size: bytes.length,
                  crc32c: crc32cBase64(crc32cUpdate(bytes)),
                },
              }
            : {}),
        };
      },
      put: async (file, offset, bytes) => {
        writes++;
        const before = objects.get(file.path)!;
        assert.equal(offset, before.length);
        objects.set(file.path, Buffer.concat([before, bytes]));
        if (losePut) {
          losePut = false;
          throw new Error("Lost provider response with secret URI");
        }
      },
      close: async (file) => {
        if (failClose) throw new Error("Provider unavailable");
        objects.delete(file.path);
      },
      download: async (file) => ({
        url: "https://storage.example/" + file.id,
        expiresAt: Date.now() + 60000,
      }),
    },
  };
  const member = { uid: "ceo_fixture", orgId: "org_fixture", role: "owner" };
  const call = (body: any, m = member) =>
    handleFiles({ method: "POST", body }, m, deps);
  return {
    deps,
    member,
    call,
    rows,
    leases,
    objects,
    losePut: () => {
      losePut = true;
    },
    closeFails: (v: boolean) => {
      failClose = v;
    },
    disable: () => {
      enabled = false;
    },
    counts: () => ({ creates, writes }),
  };
}
const descriptor = (id: string, bytes: Buffer, visibility = "private") => ({
  operation: "start",
  id,
  name: "review.txt",
  mime: "text/plain",
  bytes: bytes.length,
  crc32c: crc32cBase64(crc32cUpdate(bytes)),
  visibility,
});
test("managed files verify resumed bytes, reject changed replay, and keep private/tenant boundaries", async () => {
  const f = fixture(),
    bytes = Buffer.alloc(FILE_CHUNK_BYTES + 11, 42),
    id = "file_fixture_01";
  const start = descriptor(id, bytes);
  const first = await f.call(start);
  assert.equal(first.file!.state, "uploading");
  assert.equal(JSON.stringify(first).includes("fixture-secret"), false);
  await f.call(start);
  assert.equal(f.counts().creates, 1);
  await assert.rejects(
    f.call({ ...start, name: "other.txt" }),
    /identity conflict/,
  );
  await assert.rejects(
    handleFiles(
      { method: "GET", query: { id } },
      { ...f.member, orgId: "other_org" },
      f.deps,
    ),
    /not found/,
  );
  await assert.rejects(
    handleFiles(
      { method: "GET", query: { id } },
      { ...f.member, uid: "colleague" },
      f.deps,
    ),
    /not found/,
  );
  const chunk = {
    operation: "chunk",
    id,
    offset: 0,
    content: bytes.subarray(0, FILE_CHUNK_BYTES).toString("base64"),
  };
  f.losePut();
  await assert.rejects(
    f.call(chunk),
    (e) => e instanceof FileError && !e.message.includes("secret URI"),
  );
  assert.equal(f.leases.size, 1);
  assert.equal(f.rows.get("org_fixture/" + id)!.pending!.offset, 0);
  await f.call(chunk);
  assert.equal(f.counts().writes, 1);
  assert.equal(f.rows.get("org_fixture/" + id)!.offset, FILE_CHUNK_BYTES);
  await assert.rejects(
    f.call({
      ...chunk,
      content: Buffer.alloc(FILE_CHUNK_BYTES, 43).toString("base64"),
    }),
    /identity conflict/,
  );
  const last = {
    operation: "chunk",
    id,
    offset: FILE_CHUNK_BYTES,
    content: bytes.subarray(FILE_CHUNK_BYTES).toString("base64"),
  };
  const done = await f.call(last);
  assert.equal(done.file!.state, "ready");
  assert.equal(f.leases.size, 0);
  await f.call(last);
  assert.equal(f.counts().writes, 2);
  assert.deepEqual(f.objects.values().next().value, bytes);
  assert.equal(
    (
      await handleFiles(
        { method: "GET", query: { id, download: "1" } },
        f.member,
        f.deps,
      )
    ).owner,
    "hyperflow",
  );
  f.closeFails(true);
  await assert.rejects(f.call({ operation: "delete", id }), /unresolved/);
  assert.equal(f.rows.get("org_fixture/" + id)!.state, "deleting");
  assert.equal(f.leases.size, 1);
  await assert.rejects(f.call(last), /not accepting/);
  f.closeFails(false);
  await f.call({ operation: "delete", id });
  await f.call({ operation: "delete", id });
  assert.equal(f.leases.size, 0);
  assert.equal(f.objects.size, 0);
  assert.equal((await f.call(start)).file!.state, "deleted");
  assert.equal(f.counts().creates, 1);
});
test("checksum failure retains the lease; bounded pages can continue across invisible files", async () => {
  const f = fixture(),
    bytes = Buffer.from("123456789");
  assert.equal(crc32cUpdate(bytes), 0xe3069283);
  assert.equal(
    crc32cUpdate(bytes.subarray(4), crc32cUpdate(bytes.subarray(0, 4))),
    0xe3069283,
  );
  await f.call({ ...descriptor("file_private_01", bytes), crc32c: "AAAAAA==" });
  await assert.rejects(
    f.call({
      operation: "chunk",
      id: "file_private_01",
      offset: 0,
      content: bytes.toString("base64"),
    }),
    /integrity check failed/,
  );
  assert.equal(f.leases.size, 1);
  await f.call(descriptor("file_shared_02", bytes, "organization"));
  const other = { ...f.member, uid: "colleague", role: "member" };
  const page = await handleFiles(
    { method: "GET", query: { limit: 1 } },
    other,
    f.deps,
  );
  assert.deepEqual(page.items, []);
  assert.equal(page.next, "file_private_01");
  const next = await handleFiles(
    { method: "GET", query: { limit: 1, after: page.next } },
    other,
    f.deps,
  );
  assert.equal(next.items!.length, 1);
  await assert.rejects(
    f.call({ operation: "delete", id: "file_shared_02" }, other),
    /author or organization administrator/,
  );
  await assert.rejects(
    f.call({ ...descriptor("../escape", bytes) }),
    /identity required/,
  );
  f.disable();
  await assert.rejects(
    handleFiles({ method: "GET" }, f.member, f.deps),
    /not enabled/,
  );
});
test("file API scopes and live upload lease prevent unrelated lifecycle mutation", () => {
  assert.equal(
    requestScope({ url: "/api/files", method: "GET" }),
    "files:read",
  );
  assert.equal(
    requestScope({
      url: "/api/gemini",
      query: { action: "files" },
      method: "POST",
    }),
    "files:write",
  );
  const r = lifecycleRecord(null);
  r.storageLeases.upload = { at: Date.now(), path: "managed/org/file" };
  assert.throws(
    () =>
      beginLifecycle(r, {
        id: "pause-fixture",
        actor: "owner",
        revision: 0,
        operation: "suspend",
      }),
    /file operation is still running/,
  );
});
test("browser upload uses the same REST contract, stops on account change and never auto-retries an uncertain write", async () => {
  const f = fixture(),
    bytes = Buffer.alloc(FILE_CHUNK_BYTES + 19, 97),
    file = new Blob([bytes], { type: "text/plain" });
  let requests = 0;
  const options = {
    id: "browser_file_01",
    visibility: "private" as const,
    checkIdentity: () => {},
    request: async (_q: string, body: any) => {
      requests++;
      return f.call(body);
    },
  };
  f.losePut();
  await assert.rejects(
    uploadManagedFile(file, "browser.txt", options),
    /unresolved/,
  );
  assert.equal(requests, 2);
  const complete = await uploadManagedFile(file, "browser.txt", options);
  assert.equal(complete.state, "ready");
  assert.equal(f.counts().creates, 1);
  assert.equal(f.counts().writes, 2);
  const before = requests;
  await assert.rejects(
    uploadManagedFile(file, "other.txt", {
      ...options,
      id: "browser_file_02",
      checkIdentity: () => {
        throw new Error("Account changed");
      },
    }),
    /Account changed/,
  );
  assert.equal(requests, before);
});
test("administrator can remove a stuck private upload without receiving its private metadata", async () => {
  const f = fixture(),
    bytes = Buffer.from("private");
  await f.call(descriptor("private_file_03", bytes));
  const result = await f.call(
    { operation: "delete", id: "private_file_03" },
    { ...f.member, uid: "other_administrator", role: "admin" },
  );
  assert.equal(result.file!.state, "deleted");
  assert.equal((result.file as any).name, undefined);
  assert.equal(result.file!.deletedBy, "other_administrator");
});
