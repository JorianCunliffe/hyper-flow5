import { getManagedFileBucket } from "../serverStore.js";
import { FileError, type ManagedFile } from "./model.js";
export interface StoredObject {
  generation: string;
  size: number;
  crc32c: string;
}
export interface FileProvider {
  create(file: ManagedFile): Promise<string>;
  progress(
    file: ManagedFile,
  ): Promise<{ offset: number; object?: StoredObject }>;
  put(file: ManagedFile, offset: number, bytes: Buffer): Promise<void>;
  close(file: ManagedFile): Promise<void>;
  download(file: ManagedFile): Promise<{ url: string; expiresAt: number }>;
}
function session(file: ManagedFile) {
  const uri = new URL(file.sessionSecret || "https://invalid");
  if (
    uri.origin !== "https://storage.googleapis.com" ||
    !uri.pathname.startsWith("/upload/storage/v1/")
  )
    throw new FileError(503, "Upload session requires operator review");
  return uri;
}
const object = (metadata: any): StoredObject => ({
  generation: String(metadata.generation),
  size: Number(metadata.size),
  crc32c: String(metadata.crc32c),
});
function bucket(file: ManagedFile) {
  if (!file.bucket || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(file.bucket))
    throw new FileError(503, "Stored file bucket requires operator review");
  return getManagedFileBucket(file.bucket);
}
/** Dedicated queue handoff, never returned to a browser. Ordinary downloads remain 60 seconds. */
export async function transcriptionDownload(file: ManagedFile) {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const [url] = await bucket(file).file(file.path, { generation: file.generation })
    .getSignedUrl({ action: 'read', version: 'v4', expires: expiresAt });
  return { url, expiresAt };
}
async function metadata(file: ManagedFile): Promise<StoredObject | undefined> {
  try {
    const [m] = await bucket(file).file(file.path).getMetadata();
    return object(m);
  } catch (e: any) {
    if (e.code === 404) return undefined;
    throw new FileError(503, "File storage is unavailable");
  }
}
export async function cancelUploadSession(file: ManagedFile): Promise<void> {
  const response = await fetch(session(file), {
    method: 'DELETE', redirect: 'manual', signal: AbortSignal.timeout(30000),
  });
  if ([499,404,410].includes(response.status)) return;
  // A finalized session returns its completed object instead of cancellation.
  // Validate that terminal receipt before the caller deletes the live object.
  if (response.status===200 || response.status===201) {
    const raw=await response.json();
    const stored=object(raw);
    if(raw.bucket===file.bucket && raw.name===file.path && stored.size===file.bytes && stored.crc32c===file.crc32c && /^[0-9]+$/.test(stored.generation) && (!file.generation||stored.generation===file.generation)) return;
  }
  throw new FileError(503,'Upload cancellation is unresolved; file remains pending');
}
/** Session bearer URIs stay server-side; the client sends bounded REST chunks. */
export const cloudFileProvider: FileProvider = {
  async create(file) {
    const [uri] = await bucket(file)
      .file(file.path)
      .createResumableUpload({
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: file.mime,
          contentLength: file.bytes,
          crc32c: file.crc32c,
          cacheControl: "private, no-store",
          contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        },
      });
    return uri;
  },
  async progress(file) {
    const response = await fetch(session(file), {
      method: "PUT",
      headers: {
        "Content-Length": "0",
        "Content-Range": `bytes */${file.bytes}`,
      },
      // GCS uses 308 as upload progress, which fetch treats as a redirect.
      // Inspect the status without following any Location header.
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 308) {
      const range = response.headers.get("range");
      return {
        offset: range ? Number(range.match(/^bytes=0-(\d+)$/)?.[1]) + 1 : 0,
      };
    }
    if (response.ok) {
      const stored = object(await response.json());
      return { offset: stored.size, object: stored };
    }
    if (response.status === 404 || response.status === 410) {
      const stored = await metadata(file);
      if (stored) return { offset: stored.size, object: stored };
    }
    throw new FileError(
      503,
      "Upload status is unresolved; reconcile or cancel this file",
    );
  },
  async put(file, offset, bytes) {
    const response = await fetch(session(file), {
      method: "PUT",
      headers: {
        "Content-Length": String(bytes.length),
        "Content-Type": file.mime,
        "Content-Range": `bytes ${offset}-${offset + bytes.length - 1}/${file.bytes}`,
      },
      body: bytes as any,
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok && response.status !== 308)
      throw new FileError(
        503,
        "Upload response is uncertain; reconcile the original file",
      );
  },
  async close(file) {
    if (!file.sessionSecret && !file.generation) return; // No bytes can be written before a session is durably recorded.
    if (file.sessionSecret) {
      await cancelUploadSession(file);
    }
    const stored = await metadata(file);
    if (stored) {
      if (file.generation && file.generation !== stored.generation)
        throw new FileError(
          409,
          "Stored object generation changed; operator review required",
        );
      try {
        await bucket(file)
          .file(file.path)
          .delete({ ifGenerationMatch: stored.generation });
      } catch (e: any) {
        if (e.code !== 404)
          throw new FileError(
            503,
            "Object cleanup is unresolved; file remains pending",
          );
      }
    }
    if (await metadata(file))
      throw new FileError(503, "Object cleanup requires reconciliation");
  },
  async download(file) {
    const expiresAt = Date.now() + 60000;
    const [url] = await bucket(file)
      .file(file.path, { generation: file.generation })
      .getSignedUrl({ action: "read", version: "v4", expires: expiresAt });
    return { url, expiresAt };
  },
};
