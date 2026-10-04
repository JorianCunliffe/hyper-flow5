import { receptionStore } from "./store.js";
import { digest, fail, text, type ReceptionSession } from "./model.js";
import { createCommunicationsClient } from "../communications/client.js";
/** Signed service-only transcript ingestion. Model tools cannot call this operation.
 * Segment routing comes exclusively from the saved call session, not the payload. */
export async function ingestReceptionSegments(body: any) {
  const org = text(body.tenant_id),
    id = `reception_${digest([org, body.communication_id]).slice(0, 40)}`;
  const session = await receptionStore.read<ReceptionSession>(
    org,
    "sessions",
    id,
  );
  if (
    !session ||
    session.personId !== body.person_id ||
    session.identity !== body.service_identity ||
    session.threadId !== body.thread_id
  )
    fail(403, "Reception identity mismatch.");
  const call = await createCommunicationsClient().getCommunication(
    org,
    session.communicationId,
  );
  if (
    call.personId !== session.personId ||
    call.tenantId !== org ||
    call.channel !== "voice" ||
    call.direction !== "inbound"
  )
    fail(403, "Inbound source required.");
  const groups = body.arguments?.segments;
  if (!Array.isArray(groups) || groups.length > 20)
    fail(422, "Bounded call segments required.");
  for (const group of groups) {
    const segment = session.segments.find((s) => s.id === group.id);
    if (!segment) fail(403, "Unknown call segment.");
    if (!segment.projectId || group.private !== false) continue;
    const content = text(group.text, 12000);
    if (!content) continue;
    const sourceId = digest([session.id, segment.id]);
    await receptionStore.transact<any>(
      org,
      "voice_segments",
      sourceId,
      (current) => {
        if (current && current.text !== content)
          fail(
            409,
            "A call segment already has different evidence. Review it manually.",
          );
        return (
          current || {
            id: sourceId,
            personId: session.personId,
            projectId: segment.projectId,
            communicationId: session.communicationId,
            segmentId: segment.id,
            text: content,
            occurredAt: segment.startedAt,
            kind: "received_voice",
            visibility: "routine",
          }
        );
      },
    );
  }
  return { saved: true };
}
