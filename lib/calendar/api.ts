import { assertHumanDecision } from '../http/authority.js';
import { randomUUID } from "node:crypto";
import {
  listTenantProjects,
  listWorkspaceConnectionRefs,
  requireOrganizationMember,
} from "../serverStore.js";
import { createAsk } from "../asks/createAsk.js";
import { recordAskResponse } from "../humanAsk.js";
import { HttpCommunicationsClient } from "../communications/client.js";
import { GoogleCalendar } from "./google.js";
import { calendarInstant } from "./time.js";
import { handleVisibleFlows, publicFlowResponse } from "../visibleFlows/api.js";
import { calendarStore, type CalendarStore } from "./store.js";
import {
  CalendarError,
  publicDiaryEvent,
  calendarKey,
  changeHash,
  providerEventId,
  validatePolicy,
  validateChange,
  assertAvailable,
  assertPersonalEvent,
  type CalendarLedger,
  type CalendarProposal,
  type CalendarPolicy,
  type DiaryEvent,
} from "./model.js";
type Member = { orgId: string; uid: string };
export async function handleCalendar(
  request: { method?: string; query?: Record<string, any>; body?: any },
  member: Member,
  deps: {
    store?: CalendarStore;
    projects?: typeof listTenantProjects;
    connections?: typeof listWorkspaceConnectionRefs;
    member?: typeof requireOrganizationMember;
    provider?: (
      connectionId: string,
    ) => Pick<GoogleCalendar, "calendars" | "events" | "get" | "write">;
    sync?: (event: Record<string, unknown>) => Promise<any>;
  } = {},
) {
  assertHumanDecision(member, 'calendar', request.body);
  const store = deps.store || calendarStore,
    body = request.body || {},
    query = request.query || {};
  const projects = await (deps.projects || listTenantProjects)(member.orgId),
    projectId = String(body.projectId || query.projectId || "");
  const permitted = new Set(projects.map((p) => p.id));
  if (projectId && !permitted.has(projectId))
    throw new CalendarError(403, "Project is outside your permitted scope");
  const provider = (connectionId: string) =>
    (deps.provider || ((id) => new GoogleCalendar(member.orgId, id)))(
      connectionId,
    );
  const membership = deps.member || requireOrganizationMember;
  const present = (ledger: CalendarLedger) => ({
    id: ledger.id,
    connectionId: ledger.connectionId,
    calendarId: ledger.calendarId,
    policies: Object.values(ledger.policies || {}).filter(
      (p) =>
        permitted.has(p.projectId) && (!projectId || p.projectId === projectId),
    ),
    proposals: Object.values(ledger.proposals || {})
      .filter(
        (p) =>
          permitted.has(p.projectId) &&
          (!projectId || p.projectId === projectId),
      )
      .map((p) => {
        const { token, ...ask } = p.ask;
        return { ...p, ask };
      }),
    busy: !!ledger.activeOperation,
    observations: Object.values(ledger.observations || {}).filter(
      (row) =>
        permitted.has(row.projectId) &&
        (!projectId || row.projectId === projectId),
    ),
  });
  if (request.method === "GET" && query.operation === "calendars")
    return {
      calendars: (
        await provider(String(query.connectionId || "")).calendars()
      ).map(({ id, summary, accessRole, timeZone }) => ({
        id,
        summary,
        accessRole,
        timeZone,
      })),
    };
  if (request.method === "GET" && !query.operation)
    return {
      items: (await store.list(member.orgId)).map(present),
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      connections: await (deps.connections || listWorkspaceConnectionRefs)(
        member.orgId,
      ),
      limit: 100,
    };
  if (!projectId) throw new CalendarError(422, "Choose a project");
  const id = String(body.calendarKey || query.calendarKey || "");
  if (request.method === "POST" && body.operation === "configure") {
    const actor = await membership(member.uid, member.orgId);
    if (!["owner", "admin"].includes(actor.role))
      throw new CalendarError(
        403,
        "A calendar grant requires an administrator",
      );
    const valid = validatePolicy({ ...body.policy, projectId });
    const found = (await provider(valid.connectionId).calendars()).find(
      (c) => c.id === valid.calendarId,
    );
    if (
      !found ||
      !["owner", "writer", "reader"].includes(found.accessRole) ||
      (valid.bookingEnabled && !["owner", "writer"].includes(found.accessRole))
    )
      throw new CalendarError(
        403,
        "This connection does not have the requested calendar access",
      );
    const key = calendarKey(valid.connectionId, valid.calendarId);
    const item = await store.transact(member.orgId, key, (current) => {
      const ledger = current || {
        id: key,
        connectionId: valid.connectionId,
        calendarId: valid.calendarId,
        policies: {},
        proposals: {},
      };
      if (ledger.connectionId !== valid.connectionId)
        throw new CalendarError(
          409,
          "This calendar already uses another connected account. Use that configured account so operations share one calendar lock.",
        );
      if (ledger.activeOperation && valid.bookingEnabled)
        throw new CalendarError(
          409,
          "Reconcile the active calendar operation before changing its policy",
        );
      const previous = ledger.policies[projectId];
      if ((previous?.revision || 0) !== body.expectedPolicyRevision)
        throw new CalendarError(
          409,
          "Calendar policy changed; refresh before saving",
        );
      ledger.policies[projectId] = {
        ...valid,
        revision: (previous?.revision || 0) + 1,
        configuredBy: member.uid,
      };
      return ledger;
    });
    return { item: present(item) };
  }
  if (!/^[a-f0-9]{64}$/.test(id))
    throw new CalendarError(422, "Choose a configured calendar");
  const ledger = await store.read(member.orgId, id),
    policy = ledger?.policies[projectId];
  if (!ledger || !policy)
    throw new CalendarError(404, "Calendar grant not found");
  const client = provider(ledger.connectionId);
  if (request.method === "GET" && query.operation === "events") {
    const start = Date.parse(query.start),
      end = Date.parse(query.end);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end - start > 31 * 86400000
    )
      throw new CalendarError(
        422,
        "Choose a calendar window of at most 31 days",
      );
    return {
      events: (
        await client.events(
          ledger.calendarId,
          new Date(start).toISOString(),
          new Date(end).toISOString(),
        )
      ).map(publicDiaryEvent),
      observedAt: new Date().toISOString(),
      policy,
    };
  }
  if (request.method !== "POST")
    throw new CalendarError(405, "Method not allowed");
  if (body.operation === "observe") {
    if (
      typeof body.eventId !== "string" ||
      !body.eventId ||
      body.eventId.length > 300
    )
      throw new CalendarError(422, "Choose a provider event");
    const event = await client.get(ledger.calendarId, body.eventId);
    const start =
      event.start?.dateTime ||
      (event.start?.date
        ? calendarInstant(event.start.date + "T00:00", policy.timezone)
        : "");
    const end =
      event.end?.dateTime ||
      (event.end?.date
        ? calendarInstant(event.end.date + "T00:00", policy.timezone)
        : "");
    if (!start || !end)
      throw new CalendarError(
        422,
        "The event has incomplete timing and cannot be shared as calendar context",
      );
    const observedAt = new Date().toISOString();
    const emails = [
      ...new Set(
        [
          event.organizer?.email,
          ...(event.attendees || []).map((p) => p.email),
        ].filter(Boolean),
      ),
    ];
    const result = await (
      deps.sync ||
      ((value) =>
        new HttpCommunicationsClient().ingestCalendarObservation(
          member.orgId,
          value,
        ))
    )({
      provider: "google",
      provider_id: `${ledger.id}:${event.id}`,
      title: event.summary || "Untitled event",
      description: event.description || "",
      starts_at: start,
      ends_at: end,
      participants: emails.map((email) => ({ type: "email", value: email })),
      metadata: {
        external_project_id: projectId,
        visibility: "project",
        provider_event_id: event.id,
        provider_calendar_id: ledger.calendarId,
        provider_etag: event.etag,
        observed_at: observedAt,
        status: event.status || "confirmed",
        timezone: policy.timezone,
      },
    });
    const updated = await store.transact(member.orgId, id, (current) => {
      if (!current)
        throw new CalendarError(404, "Calendar history is unavailable");
      current.observations ||= {};
      const key = calendarKey("event", event.id);
      if (
        !current.observations[key] &&
        Object.keys(current.observations).length >= 200
      )
        throw new CalendarError(
          409,
          "Calendar observation history reached its limit",
        );
      current.observations[key] = {
        eventId: event.id,
        projectId,
        observedAt,
        contextId: String(result.event?.id || result.id || ""),
        state: result.stale ? "superseded" : "synced",
      };
      return current;
    });
    return {
      item: present(updated),
      notice:
        "The observed event and participants were shared as project context. No booking or operational commitment was created.",
    };
  }
  if (body.operation === "prepare") {
    const observation = Object.values(ledger.observations || {}).find(
      (row) =>
        row.eventId === body.eventId &&
        row.projectId === projectId &&
        row.state === "synced",
    );
    if (!observation)
      throw new CalendarError(
        422,
        "Share the current event context with this project before preparing a briefing",
      );
    return publicFlowResponse(
      await handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "create",
            projectId,
            plan: {
              name: "Prepare diary briefing",
              steps: [
                {
                  id: "context",
                  name: "Read permitted meeting context",
                  action: "read_context",
                  owner: member.uid,
                  dependsOn: [],
                  inputs: {},
                  sources: [observation.contextId],
                },
                {
                  id: "operations",
                  name: "Read accepted promises and deadlines",
                  action: "read_operations",
                  owner: member.uid,
                  dependsOn: [],
                  inputs: {},
                  sources: ["HyperFlow accepted commitments"],
                },
                {
                  id: "brief",
                  name: "Prepare a meeting briefing draft",
                  action: "write_report",
                  owner: member.uid,
                  dependsOn: ["context", "operations"],
                  inputs: {
                    prompt: `Prepare a briefing for calendar event ${observation.contextId}. Cite the event, participants and relevant accepted obligations. Distinguish source evidence from accepted commitments. Identify decisions, preparation and follow-up candidates without creating promises. If this event is missing or cancelled, say so and do not invent a meeting agenda.`,
                  },
                  sources: [observation.contextId],
                },
              ],
            },
          },
        },
        member,
      ),
    );
  }
  if (body.operation === "propose") {
    const change = validateChange(body.change, policy);
    let before: DiaryEvent | undefined;
    if (change.operation !== "create") {
      before = publicDiaryEvent(
        await client.get(ledger.calendarId, change.eventId),
      );
      if (before.etag !== change.etag)
        throw new CalendarError(
          409,
          "Provider event changed; refresh before proposing",
        );
      assertPersonalEvent(before, change);
      if (change.operation === "cancel") {
        change.summary = before.summary || "Untitled event";
        change.description = before.description || "";
        change.start = new Date(before.start!.dateTime!).toISOString();
        change.end = new Date(before.end!.dateTime!).toISOString();
      }
    }
    const proposalId = randomUUID();
    const proposal: CalendarProposal = {
      id: proposalId,
      projectId,
      revision: 1,
      hash: changeHash(change, policy.revision),
      policyRevision: policy.revision,
      policy: structuredClone(policy),
      change,
      before,
      createdBy: member.uid,
      createdAt: Date.now(),
      status: "review",
      ask: createAsk({
        askId: "ask_calendar_" + proposalId,
        taskId: proposalId,
        projectId,
        question: `Approve this exact ${change.operation} proposal: ${change.summary}, ${change.start} to ${change.end} (${change.timezone}). ${change.occurrenceOnly ? "Only this recurring occurrence." : ""} No guests or invitations.`,
        responseType: "approval",
        assignees: [member.uid],
        channels: ["web"],
      }),
    };
    const updated = await store.transact(member.orgId, id, (current) => {
      if (!current || current.policies[projectId]?.revision !== policy.revision)
        throw new CalendarError(409, "Calendar policy changed");
      if (Object.keys(current.proposals).length >= 200)
        throw new CalendarError(
          409,
          "Calendar proposal history reached its limit; export before continuing",
        );
      current.proposals[proposalId] = proposal;
      return current;
    });
    return { item: present(updated), proposalId };
  }
  const proposal = ledger.proposals[String(body.proposalId)];
  if (!proposal || proposal.projectId !== projectId)
    throw new CalendarError(404, "Calendar proposal not found");
  if (body.operation === "approve" || body.operation === "reject") {
    const updated = await store.transact(member.orgId, id, (current) => {
      const p = current?.proposals[proposal.id];
      if (
        !current ||
        !p ||
        p.status !== "review" ||
        p.revision !== body.expectedRevision ||
        p.hash !== body.hash ||
        p.policyRevision !== current.policies[projectId]?.revision
      )
        throw new CalendarError(
          409,
          "Refresh and review the current exact proposal and policy",
        );
      if (!p.ask.assignees?.includes(member.uid))
        throw new CalendarError(
          403,
          "This proposal belongs to its designated reviewer",
        );
      p.ask = recordAskResponse(p.ask, {
        id: randomUUID(),
        at: Date.now(),
        via: "web",
        actor: member.uid,
        decision: body.operation === "approve" ? "approved" : "rejected",
      });
      p.status = body.operation === "approve" ? "approved" : "rejected";
      if (p.status === "approved") p.approvedBy = member.uid;
      p.revision++;
      return current;
    });
    return { item: present(updated) };
  }
  if (!["execute", "reconcile", "sync_context"].includes(body.operation))
    throw new CalendarError(422, "Unknown calendar operation");
  if (body.operation === "sync_context") {
    if (proposal.status !== "verified")
      throw new CalendarError(
        409,
        "Verify the provider state before publishing context",
      );
    return { item: present(await syncContext(ledger, proposal, policy)) };
  }
  if (body.operation === "execute") {
    if (proposal.status === "verified") return { item: present(ledger) };
    if (
      proposal.status !== "approved" ||
      proposal.hash !== body.hash ||
      proposal.revision !== body.expectedRevision
    )
      throw new CalendarError(
        409,
        "An approved exact proposal is required; reconcile previously dispatched operations",
      );
    await membership(proposal.approvedBy!, member.orgId);
    if (!policy.bookingEnabled)
      throw new CalendarError(
        403,
        "Calendar booking is disabled; the proposal has not changed the diary",
      );
    await store.transact(member.orgId, id, (current) => {
      const p = current?.proposals[proposal.id];
      if (
        !current ||
        !p ||
        p.status !== "approved" ||
        p.revision !== proposal.revision ||
        current.policies[projectId]?.revision !== p.policyRevision ||
        !current.policies[projectId]?.bookingEnabled
      )
        throw new CalendarError(409, "Proposal or authority changed");
      if (current.activeOperation)
        throw new CalendarError(
          409,
          "Another operation is pending on this calendar; reconcile it first",
        );
      current.activeOperation = p.id;
      p.status = "running";
      p.revision++;
      return current;
    });
    let dispatched = false;
    try {
      if (proposal.change.operation !== "create") {
        const latest = await client.get(
          ledger.calendarId,
          proposal.change.eventId,
        );
        if (latest.etag !== proposal.change.etag)
          throw new CalendarError(409, "The event changed since approval");
        assertPersonalEvent(latest, proposal.change);
      }
      if (proposal.change.operation !== "cancel") {
        const buffer = policy.bufferMinutes * 60000;
        const events = await client.events(
          ledger.calendarId,
          new Date(Date.parse(proposal.change.start) - buffer).toISOString(),
          new Date(Date.parse(proposal.change.end) + buffer).toISOString(),
        );
        assertAvailable(proposal.change, events, policy);
      }
      // Check identity membership again immediately before the external effect.
      await membership(proposal.approvedBy!, member.orgId);
      const latestPolicy = (await store.read(member.orgId, id))?.policies[
        projectId
      ];
      if (
        !latestPolicy?.bookingEnabled ||
        latestPolicy.revision !== proposal.policyRevision
      )
        throw new CalendarError(
          403,
          "Calendar authority changed before dispatch",
        );
      dispatched = true;
      await client.write(
        ledger.calendarId,
        proposal.change,
        proposal.change.eventId || providerEventId(proposal.id),
        proposal.hash,
      );
    } catch (error: any) {
      const definitive =
        !dispatched ||
        (error instanceof CalendarError &&
          [400, 401, 403, 404, 410, 412, 422].includes(error.status));
      const updated = await store.transact(member.orgId, id, (current) => {
        if (!current) throw error;
        const p = current.proposals[proposal.id];
        p.status = definitive ? "conflict" : "uncertain";
        p.error = String(error.message).slice(0, 500);
        p.revision++;
        if (definitive && current.activeOperation === p.id)
          delete current.activeOperation;
        return current;
      });
      return {
        item: present(updated),
        notice: definitive
          ? "The proposal was held. Refresh and propose a new version."
          : "The provider outcome is uncertain. Reconcile before any new operation on this calendar.",
      };
    }
  } else if (!["running", "uncertain"].includes(proposal.status))
    throw new CalendarError(
      409,
      "Only a dispatched uncertain operation needs reconciliation",
    );
  const current = (await store.read(member.orgId, id))!;
  const reconciled = await reconcile(
    current,
    current.proposals[proposal.id],
    current.proposals[proposal.id].policy,
  );
  return { item: present(reconciled) };

  async function reconcile(
    current: CalendarLedger,
    p: CalendarProposal,
    grant: CalendarPolicy,
  ) {
    const eventId = p.change.eventId || providerEventId(p.id);
    let event: DiaryEvent | undefined;
    try {
      event = await client.get(current.calendarId, eventId);
    } catch (error) {
      if (!(
        error instanceof CalendarError &&
        [404, 410].includes(error.status) &&
        p.change.operation === "cancel"
      ))
        return store.transact(member.orgId, id, (row) => {
          if (!row) throw error;
          row.proposals[p.id].status = "uncertain";
          row.proposals[p.id].error =
            "Provider outcome is not verified. Reconcile again; no write was repeated.";
          return row;
        });
    }
    let matches =
      p.change.operation === "cancel"
        ? !event || event.status === "cancelled"
        : event?.status !== "cancelled" &&
          !event?.attendees?.length &&
          event?.extendedProperties?.private?.hyperflowOperation === p.hash &&
          event.summary === p.change.summary &&
          String(event.description || "") === p.change.description &&
          Date.parse(event.start?.dateTime || "") ===
            Date.parse(p.change.start) &&
          Date.parse(event.end?.dateTime || "") === Date.parse(p.change.end);
    if (matches && p.change.operation !== "cancel") {
      try {
        const buffer = grant.bufferMinutes * 60000;
        const events = await client.events(
          current.calendarId,
          new Date(Date.parse(p.change.start) - buffer).toISOString(),
          new Date(Date.parse(p.change.end) + buffer).toISOString(),
        );
        assertAvailable({ ...p.change, eventId }, events, grant);
      } catch (error) {
        if (!(error instanceof CalendarError && error.status === 409))
          return store.transact(member.orgId, id, (row) => {
            if (!row) throw error;
            row.proposals[p.id].status = "uncertain";
            row.proposals[p.id].error =
              "The event exists, but post-write availability could not be verified. Reconcile again; no write was repeated.";
            return row;
          });
        matches = false;
      }
    }
    const updated = await store.transact(member.orgId, id, (row) => {
      if (!row) throw new CalendarError(404, "Calendar history is unavailable");
      const saved = row.proposals[p.id];
      saved.status = matches ? "verified" : "conflict";
      saved.revision++;
      saved.error = matches
        ? ""
        : "The observed provider event differs from the approved version; no automatic retry was made.";
      saved.receipt = {
        eventId,
        observedAt: new Date().toISOString(),
        etag: event?.etag,
        url: event?.htmlLink,
        status: matches
          ? p.change.operation === "cancel"
            ? "observed_cancelled"
            : "observed_matching"
          : "observed_conflict",
      };
      if (row.activeOperation === p.id) delete row.activeOperation;
      if (matches) saved.context = { state: "pending" };
      return row;
    });
    return matches
      ? syncContext(updated, updated.proposals[p.id], grant)
      : updated;
  }
  async function syncContext(
    current: CalendarLedger,
    p: CalendarProposal,
    grant: CalendarPolicy,
  ) {
    const observedAt = p.receipt!.observedAt;
    try {
      const result = await (
        deps.sync ||
        ((event) =>
          new HttpCommunicationsClient().ingestCalendarObservation(
            member.orgId,
            event,
          ))
      )({
        provider: "google",
        provider_id: `${current.id}:${p.receipt!.eventId}`,
        title: p.change.summary,
        description: p.change.description,
        starts_at: p.change.start,
        ends_at: p.change.end,
        participants: [],
        metadata: {
          external_project_id: projectId,
          visibility: "project",
          provider_event_id: p.receipt!.eventId,
          provider_calendar_id: current.calendarId,
          provider_etag: p.receipt!.etag || null,
          observed_at: observedAt,
          status: p.change.operation === "cancel" ? "cancelled" : "confirmed",
          hyperflow_proposal_id: p.id,
          hyperflow_hash: p.hash,
          timezone: grant.timezone,
        },
      });
      return store.transact(member.orgId, id, (row) => {
        if (!row) throw new Error("Calendar history missing");
        row.proposals[p.id].context = {
          state: result.stale ? "superseded" : "synced",
          eventId: String(result.event?.id || result.id || ""),
          observedAt,
        };
        return row;
      });
    } catch (error: any) {
      return store.transact(member.orgId, id, (row) => {
        if (!row) throw error;
        row.proposals[p.id].context = {
          state: "failed",
          observedAt,
          error: String(error.message).slice(0, 500),
        };
        return row;
      });
    }
  }
}
