import { runtimeDatabase } from "../runtimeDatabase.js";
import { encodeRtdbRecord, decodeRtdbRecord } from "../rtdbJson.js";
import { fail } from "./model.js";
const key = (v: string) => encodeURIComponent(v).replace(/\./g, "%2E");
export const receptionStore = {
  async read<T = any>(
    org: string,
    collection: string,
    id: string,
  ): Promise<T | null> {
    const s = await (
      await runtimeDatabase()
    )
      .ref(`reception/${key(org)}/${key(collection)}/${key(id)}`)
      .get();
    return s.exists() ? decodeRtdbRecord(s.val()) : null;
  },
  async list<T = any>(org: string, collection: string): Promise<T[]> {
    const s = await (
      await runtimeDatabase()
    )
      .ref(`reception/${key(org)}/${key(collection)}`)
      .limitToLast(200)
      .get();
    return Object.values(s.val() || {}).map((v) => decodeRtdbRecord(v)) as T[];
  },
  async transact<T = any>(
    org: string,
    collection: string,
    id: string,
    fn: (value: T | null) => T,
  ): Promise<T> {
    const ref = (await runtimeDatabase()).ref(
      `reception/${key(org)}/${key(collection)}/${key(id)}`,
    );
    const listener = () => {};
    try {
      // Firebase may initially invoke a cold transaction with null. Prime its
      // local view before applying revision/ownership preconditions.
      await new Promise<void>((resolve, reject) => {
        ref.on("value", listener, reject);
        ref.once("value", () => resolve(), reject);
      });
      const r = await ref.transaction(
        (raw) => {
          const value = fn(raw ? decodeRtdbRecord(raw) : null);
          if (Buffer.byteLength(JSON.stringify(value)) > 500000)
            fail(413, "Reception record exceeds its size limit.");
          return encodeRtdbRecord(value);
        },
        undefined,
        false,
      );
      if (!r.committed)
        fail(409, "Reception record changed. Retry the same operation.");
      return decodeRtdbRecord(r.snapshot.val());
    } finally {
      ref.off("value", listener);
    }
  },
};
