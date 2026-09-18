import { useProjectScope, useScopedProject, ProjectDirectory } from './ProjectScope';
import React, { useEffect, useState } from "react";
import { firebaseService } from "../services/firebaseService";
import { calendarInstant, calendarWallTime } from "../lib/calendar/time";
import type {
  CalendarPolicy,
  CalendarProposal,
  DiaryEvent,
} from "../lib/calendar/model";
const field =
  "w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900";
const button =
  "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40";
export function DiaryPanel() {
  const scope = useProjectScope();
  const [projectId, setProjectId] = useScopedProject();
  const [data, setData] = useState<any>(null),
    [calendarKey, setCalendarKey] = useState(""),
    [connectionId, setConnectionId] = useState(""),
    [calendars, setCalendars] = useState<any[]>([]),
    [events, setEvents] = useState<DiaryEvent[]>([]),
    [obligations, setObligations] = useState<
      Array<{ id: string; deliverable: string }>
    >([]),
    [observedAt, setObservedAt] = useState(""),
    [selected, setSelected] = useState<DiaryEvent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const selectedLedger = data?.items.find((l: any) => l.id === calendarKey),
    policy: CalendarPolicy | undefined = selectedLedger?.policies.find(
      (p: CalendarPolicy) => p.projectId === projectId,
    );
  async function request(body?: any, query = "") {
    const response = await firebaseService.authorizedFetch(
      "/api/calendar" + query,
      {
        method: body ? "POST" : "GET",
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...body, projectId, calendarKey }),
            }
          : {}),
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Calendar request failed");
    return result;
  }
  useEffect(() => {
    let active = true;
    setBusy(true);
    firebaseService
      .authorizedFetch("/api/calendar")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      if (result?.notice) setNotice(result.notice);
      return result;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function mutate(body: any) {
    const result = await request(body);
    setData(await request());
    return result;
  }
  const time = (at?: string) =>
    at
      ? new Date(at).toLocaleString("en-AU", {
          timeZone: policy?.timezone || "Australia/Brisbane",
        })
      : "Not available";
  return (
    <section className="mx-auto max-w-6xl space-y-5 p-6">
      <h1 className="text-2xl font-bold">Calendar</h1>
      <p>
        Inspect availability, propose a change and approve its exact details
        before booking. Calendar context is shared through Communications;
        approval and booking receipts belong to HyperFlow.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <ProjectDirectory purpose="Select a project to view its calendars, appointments and booking approvals." />
      <div className="grid gap-3 md:grid-cols-2">
        {!scope && <>
        <label>
          Project
          <select
            className={field}
            value={projectId}
            disabled={busy}
            onChange={(e) => {
              setProjectId(e.target.value);
              setObligations([]);
              setCalendarKey("");
              setEvents([]);
              setSelected(null);
            }}
          >
            <option value="">Choose a project</option>
            {data?.projects.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        </>}
        <label>
          Configured calendar
          <select
            className={field}
            value={calendarKey}
            disabled={busy}
            onChange={(e) => {
              setCalendarKey(e.target.value);
              setEvents([]);
              setSelected(null);
            }}
          >
            <option value="">Choose a calendar</option>
            {data?.items
              .filter((l: any) =>
                l.policies.some(
                  (p: CalendarPolicy) => p.projectId === projectId,
                ),
              )
              .map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.calendarId}
                </option>
              ))}
          </select>
        </label>
      </div>
      <details>
        <summary className="cursor-pointer font-bold">
          Calendar access and booking policy
        </summary>
        <p className="my-3">
          Google calendar access is separate from your existing document
          connection. Booking starts disabled. This release supports personal
          timed events and changes to one recurring occurrence; invitations,
          all-day changes and whole-series edits remain unavailable.
        </p>
        <div className="flex gap-2">
          {(["read", "write"] as const).map((access) => (
            <button
              key={access}
              className={button}
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const response = await firebaseService.authorizedFetch(
                    "/api/integrations/google/start",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        calendarAccess: access,
                        returnTo: "/?view=diary",
                      }),
                    },
                  );
                  const result = await response.json();
                  if (!response.ok) throw new Error(result.error);
                  window.location.assign(result.authorizationUrl);
                })
              }
            >
              Connect calendar{" "}
              {access === "read" ? "read access" : "booking access"}
            </button>
          ))}
        </div>
        <label>
          Google account
          <select
            className={field}
            value={connectionId}
            disabled={busy}
            onChange={(e) => {
              setConnectionId(e.target.value);
              setCalendars([]);
            }}
          >
            <option value="">Choose a connected account</option>
            {data?.connections
              .filter((c: any) => c.provider === "google")
              .map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.accountEmail}
                </option>
              ))}
          </select>
        </label>
        <button
          className={button}
          disabled={busy || !connectionId}
          onClick={() =>
            void act(async () => {
              const result = await request(
                undefined,
                "?" +
                  new URLSearchParams({ operation: "calendars", connectionId }),
              );
              setCalendars(result.calendars);
            })
          }
        >
          Load calendars
        </button>
        <form
          key={calendarKey + String(policy?.revision || 0)}
          className="my-3 grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void act(() =>
              mutate({
                operation: "configure",
                expectedPolicyRevision: policy?.revision || 0,
                policy: {
                  connectionId,
                  calendarId: form.get("calendarId"),
                  timezone: form.get("timezone"),
                  startHour: Number(form.get("startHour")),
                  endHour: Number(form.get("endHour")),
                  bufferMinutes: Number(form.get("bufferMinutes")),
                  bookingEnabled: form.get("bookingEnabled") === "on",
                },
              }),
            );
          }}
        >
          <label>
            Calendar
            <select
              name="calendarId"
              className={field}
              required
              defaultValue={policy?.calendarId || ""}
            >
              <option value="">Choose a calendar</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.summary} ({c.accessRole})
                </option>
              ))}
            </select>
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              className={field}
              required
              defaultValue={policy?.timezone || "Australia/Brisbane"}
            />
          </label>
          <label>
            Work starts at hour
            <input
              name="startHour"
              type="number"
              min="0"
              max="23"
              className={field}
              defaultValue={policy?.startHour ?? 9}
            />
          </label>
          <label>
            Work ends at hour
            <input
              name="endHour"
              type="number"
              min="1"
              max="24"
              className={field}
              defaultValue={policy?.endHour ?? 17}
            />
          </label>
          <label>
            Buffer minutes
            <input
              name="bufferMinutes"
              type="number"
              min="0"
              max="120"
              className={field}
              defaultValue={policy?.bufferMinutes ?? 15}
            />
          </label>
          <label>
            <input
              name="bookingEnabled"
              type="checkbox"
              defaultChecked={policy?.bookingEnabled || false}
            />{" "}
            Allow separately approved personal bookings
          </label>
          <button
            className={button}
            disabled={busy || !projectId || !connectionId || !calendars.length}
          >
            Save calendar policy
          </button>
        </form>
      </details>
      {policy && (
        <>
          <p>
            {policy.timezone} · {policy.startHour}:00–{policy.endHour}:00 ·{" "}
            {policy.bufferMinutes} minute buffer · Booking{" "}
            {policy.bookingEnabled ? "enabled after approval" : "disabled"}
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const now = Date.now();
                const result = await request(
                  undefined,
                  "?" +
                    new URLSearchParams({
                      operation: "events",
                      projectId,
                      calendarKey,
                      start: new Date(now).toISOString(),
                      end: new Date(now + 14 * 86400000).toISOString(),
                    }),
                );
                setEvents(result.events);
                setObservedAt(result.observedAt);
              })
            }
          >
            Read the next fourteen days
          </button>
          {observedAt && (
            <p>
              Calendar read at {time(observedAt)}. Availability is checked again
              immediately before a write.
            </p>
          )}
          <div className="space-y-2">
            {events.map((event) => (
              <article className="rounded-xl border p-3" key={event.id}>
                <h2 className="font-bold">
                  {event.summary || "Untitled event"}
                </h2>
                <p>
                  {event.start?.date || time(event.start?.dateTime)} –{" "}
                  {event.end?.date || time(event.end?.dateTime)}
                  {event.recurringEventId ? " · Recurring occurrence" : ""}
                </p>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => setSelected(event)}
                >
                  Inspect this event
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      mutate({ operation: "observe", eventId: event.id }),
                    )
                  }
                >
                  Share event context with this project
                </button>
              </article>
            ))}
          </div>
          <form
            key={selected?.id || "new"}
            className="grid gap-3 rounded-xl border p-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void act(() =>
                mutate({
                  operation: "propose",
                  change: {
                    operation: form.get("operation"),
                    eventId: selected?.id || "",
                    etag: selected?.etag || "",
                    summary: form.get("summary"),
                    description: form.get("description"),
                    start: calendarInstant(
                      String(form.get("start")),
                      policy.timezone,
                    ),
                    end: calendarInstant(
                      String(form.get("end")),
                      policy.timezone,
                    ),
                    timezone: policy.timezone,
                    occurrenceOnly: form.get("occurrenceOnly") === "on",
                    sourceIds: form.getAll("sourceIds").map(String),
                  },
                }),
              );
            }}
          >
            <h2 className="font-bold md:col-span-2">
              {selected
                ? "Propose a change to this event"
                : "Propose a personal diary event"}
            </h2>
            <label>
              Change
              <select className={field} name="operation">
                {selected ? (
                  <>
                    <option value="update">Update this event</option>
                    <option value="cancel">Cancel this event</option>
                  </>
                ) : (
                  <option value="create">Create a personal event</option>
                )}
              </select>
            </label>
            <label>
              Title
              <input
                className={field}
                name="summary"
                defaultValue={selected?.summary || ""}
                maxLength={300}
                required
              />
            </label>
            <label>
              Starts in {policy.timezone}
              <input
                className={field}
                name="start"
                type="datetime-local"
                required
                defaultValue={
                  selected?.start?.dateTime
                    ? calendarWallTime(selected.start.dateTime, policy.timezone)
                    : ""
                }
              />
            </label>
            <label>
              Ends in {policy.timezone}
              <input
                className={field}
                name="end"
                type="datetime-local"
                required
                defaultValue={
                  selected?.end?.dateTime
                    ? calendarWallTime(selected.end.dateTime, policy.timezone)
                    : ""
                }
              />
            </label>
            <label className="md:col-span-2">
              Notes
              <textarea
                className={field}
                name="description"
                maxLength={8000}
                defaultValue={selected?.description || ""}
              />
            </label>
            <fieldset>
              <legend>Related work, optional</legend>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const response = await firebaseService.authorizedFetch(
                      "/api/cockpit?" +
                        new URLSearchParams({ view: "all", projectId }),
                    );
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error);
                    setObligations(result.items);
                    if (result.incomplete)
                      setNotice(
                        "Some work is omitted from this bounded view; use the obligation list for the complete history.",
                      );
                  })
                }
              >
                Load project obligations
              </button>
              {obligations.map((row) => (
                <label key={row.id} className="block">
                  <input type="checkbox" name="sourceIds" value={row.id} />{" "}
                  {row.deliverable}
                </label>
              ))}
            </fieldset>
            {selected?.recurringEventId && (
              <label>
                <input name="occurrenceOnly" type="checkbox" required /> Change
                only this occurrence
              </label>
            )}
            <button className={button} disabled={busy}>
              Save proposal for review
            </button>
            {selected && (
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                New personal event instead
              </button>
            )}
          </form>
          <h2 className="text-xl font-bold">Shared meeting context</h2>
          {(selectedLedger.observations || [])
            .filter((row: any) => row.projectId === projectId)
            .map((row: any) => (
              <article className="rounded-xl border p-3" key={row.eventId}>
                <p>
                  Event {row.eventId} · {row.state} at {time(row.observedAt)}
                </p>
                <button
                  className={button}
                  disabled={busy || row.state !== "synced"}
                  onClick={() =>
                    void act(async () => {
                      const result = await request({
                        operation: "prepare",
                        eventId: row.eventId,
                      });
                      window.location.assign(
                        "/?view=flows&flow=" +
                          encodeURIComponent(result.item.id),
                      );
                    })
                  }
                >
                  Create preparation flow for review
                </button>
              </article>
            ))}
          <h2 className="text-xl font-bold">Proposals and receipts</h2>
          {selectedLedger.proposals
            .filter((p: CalendarProposal) => p.projectId === projectId)
            .map((p: CalendarProposal) => (
              <article key={p.id} className="space-y-2 rounded-xl border p-4">
                <h3 className="font-bold">
                  {p.change.operation}: {p.change.summary}
                </h3>
                <p>
                  {time(p.change.start)} – {time(p.change.end)} (
                  {p.change.timezone}) · {p.status}
                </p>
                <p>{p.change.description}</p>
                {p.before && (
                  <details>
                    <summary>Before this change</summary>
                    <p>
                      {p.before.summary} · {time(p.before.start?.dateTime)} –{" "}
                      {time(p.before.end?.dateTime)}
                    </p>
                    <p>{p.before.description}</p>
                  </details>
                )}
                <p>
                  Source references:{" "}
                  {p.change.sourceIds?.join(", ") || "None selected"}
                </p>
                <p>
                  Review: {p.ask.prompt} · {p.ask.status}
                </p>
                {p.error && <p role="alert">{p.error}</p>}
                <div className="flex flex-wrap gap-2">
                  {(p.status === "review"
                    ? ["approve", "reject"]
                    : p.status === "approved"
                      ? ["execute"]
                      : ["running", "uncertain"].includes(p.status)
                        ? ["reconcile"]
                        : p.status === "verified" &&
                            p.context?.state !== "synced"
                          ? ["sync_context"]
                          : []
                  ).map((operation) => (
                    <button
                      key={operation}
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          mutate({
                            operation,
                            proposalId: p.id,
                            expectedRevision: p.revision,
                            hash: p.hash,
                          }),
                        )
                      }
                    >
                      {
                        {
                          approve: "Approve exact proposal",
                          reject: "Decline",
                          execute: "Apply approved change",
                          reconcile: "Reconcile provider outcome",
                          sync_context: "Retry context sync",
                        }[operation]
                      }
                    </button>
                  ))}
                </div>
                {p.receipt && (
                  <p>
                    Provider: {p.receipt.status} at {time(p.receipt.observedAt)}{" "}
                    · {p.receipt.eventId}
                  </p>
                )}
                {p.context && (
                  <p>
                    Communications context: {p.context.state}
                    {p.context.error ? " · " + p.context.error : ""}
                  </p>
                )}
              </article>
            ))}
        </>
      )}
    </section>
  );
}
