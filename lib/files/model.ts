export class FileError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const FILE_CHUNK_BYTES = 1024 * 1024;
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export interface ManagedFile {
  id: string;
  actor: string;
  name: string;
  mime: string;
  bytes: number;
  crc32c: string;
  visibility: "private" | "organization";
  path: string;
  createdAt: number;
  state: "initializing" | "uploading" | "ready" | "deleting" | "deleted";
  offset: number;
  bucket?: string;
  sessionSecret?: string;
  generation?: string;
  pending?: { offset: number; hash: string; bytes: number };
  chunks?: Record<string, string>;
  completedAt?: number;
  deletedAt?: number;
  deletedBy?: string;
  /** Server-only transcription handoff. Never include in publicFile. */
  audioIntake?: { generation: string; externalId: string; mediaSecret: string; expiresAt: number; createdAt: number };
}
export function fileKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(value))
    throw new FileError(422, "Valid file request identity required");
  return value;
}
export function newFile(input: any, actor: string, org: string): ManagedFile {
  const id = fileKey(input.id);
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 180 ||
    /[\x00-\x1f\x7f/\\]/.test(input.name)
  )
    throw new FileError(422, "A filename without path separators is required");
  if (
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1 ||
    input.bytes > MAX_FILE_BYTES
  )
    throw new FileError(422, "Files must contain 1 byte to 256 MB");
  if (
    typeof input.mime !== "string" ||
    !/^[\w.+-]+\/[\w.+-]+$/.test(input.mime)
  )
    throw new FileError(422, "A valid media type is required");
  if (
    typeof input.crc32c !== "string" ||
    !/^[A-Za-z0-9+/]{6}==$/.test(input.crc32c)
  )
    throw new FileError(422, "The file CRC32C checksum is required");
  if (!["private", "organization"].includes(input.visibility))
    throw new FileError(422, "Choose private or organization file visibility");
  return {
    id,
    actor,
    name: input.name.trim(),
    mime: input.mime,
    bytes: input.bytes,
    crc32c: input.crc32c,
    visibility: input.visibility,
    path: `managed/${encodeURIComponent(org)}/${id}`,
    createdAt: Date.now(),
    state: "initializing",
    offset: 0,
  };
}
export function sameFile(a: ManagedFile, b: ManagedFile) {
  return [
    "id",
    "actor",
    "name",
    "mime",
    "bytes",
    "crc32c",
    "visibility",
    "path",
    "bucket",
  ].every((k) => a[k as keyof ManagedFile] === b[k as keyof ManagedFile]);
}
export function visibleFile(file: ManagedFile, actor: string) {
  return file.visibility === "organization" || file.actor === actor;
}
export function publicFile(file: ManagedFile) {
  return {
    id:file.id, actor:file.actor, name:file.name, mime:file.mime, bytes:file.bytes,
    crc32c:file.crc32c, visibility:file.visibility, state:file.state, offset:file.offset,
    generation:file.generation, createdAt:file.createdAt, completedAt:file.completedAt,
    deletedAt:file.deletedAt, deletedBy:file.deletedBy,
    pending: file.pending ? { offset: file.pending.offset, bytes: file.pending.bytes } : null,
    owner: "hyperflow" as const,
    url: `/?file=${encodeURIComponent(file.id)}`,
  };
}
