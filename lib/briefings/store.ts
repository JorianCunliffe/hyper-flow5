import { runtimeDatabase } from "../runtimeDatabase.js";
import { fail } from "./model.js";
const key = (value: string) => encodeURIComponent(value).replace(/\./g, "%2E");
export const briefingPath = (
  org: string,
  kind: "sessions" | "changes" | "settings",
  id: string,
) => `briefings/${key(org)}/${kind}/${key(id)}`;
export async function readBriefingRecord(
  org: string,
  kind: "sessions" | "changes" | "settings",
  id: string,
): Promise<any> {
  return (
    await (await runtimeDatabase()).ref(briefingPath(org, kind, id)).get()
  ).val();
}
export async function transactBriefingRecord(
  org: string,
  kind: "sessions" | "changes" | "settings",
  id: string,
  update: (current: any) => any,
): Promise<any> {
  const ref = (await runtimeDatabase()).ref(briefingPath(org, kind, id));
  const listener = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      ref.on("value", listener, reject);
      ref.once("value", () => resolve(), reject);
    });
    const result = await ref.transaction(
      (current) => JSON.parse(JSON.stringify(update(current))),
      undefined,
      false,
    );
    if (!result.committed) fail(409, "Briefing state changed concurrently");
    return result.snapshot.val();
  } finally {
    ref.off("value", listener);
  }
}
