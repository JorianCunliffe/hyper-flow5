import { ViewOptions } from './ViewOptions';
import React, { useEffect, useState } from "react";
import type { OperatingSnapshot, CockpitView } from "../lib/cockpit/model";
import type { ContactWindow } from "../lib/cockpit/contactPolicy";
import { firebaseService } from "../services/firebaseService";
const field =
  "w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900";
const button =
  "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40";
async function api(query: string, body?: unknown) {
  const response = await firebaseService.authorizedFetch(
    `/api/cockpit${query}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Cockpit is unavailable");
  return result;
}
export const CockpitPanel: React.FC<{ projectId: string | null }> = ({ projectId }) => {
  const [view, setView] = useState<CockpitView>("today");
  const [party, setParty] = useState("");
  const project = projectId || "";
  const [data, setData] = useState<
    | (OperatingSnapshot & {
        projects: Array<{ id: string; name: string }>;
        configuration: {
          primaryPersonId: string;
          receptionistEnabled: boolean;
          receptionistProjectId: string;
          contactWindow: ContactWindow;
        };
      })
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [createdFlow, setCreatedFlow] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [chaseChannel, setChaseChannel] = useState("email");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setData(null);
    setAnswer("");
    api(`?${new URLSearchParams({ view, party, projectId: project })}`)
      .then((result) => {
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
  }, [view, party, project, refresh]);
  const label = (id: string) =>
    id === `user:${data?.viewerUid}`
      ? "Me"
      : data?.contacts.find((p) => `contact:${p.id}` === id)?.name ||
        id ||
        "Not agreed";
  const act = async (body: unknown) => {
    setBusy(true);
    setError("");
    try {
      return await api("", body);
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mx-auto max-w-6xl space-y-5 p-6">
      <h1 className="text-2xl font-bold">Overview</h1>
      <p>
        Accepted work, decisions and follow-up in one place. Communications
        remain source evidence; only explicit review changes what is owed.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      <ViewOptions><select aria-label="Overview filter" value={view} disabled={busy} onChange={event => { setView(event.target.value as CockpitView); setAnswer(''); }}>
        <option value="today">Today</option><option value="decisions">Decisions</option><option value="produce">To produce</option><option value="waiting">Waiting on</option><option value="contacts">Contacts</option><option value="flows">Active flows</option><option value="all">All work</option>
      </select></ViewOptions>

      <div className="grid gap-3 md:grid-cols-2">
        <label>
          Person
          <select
            className={field}
            value={party}
            onChange={(e) => {
              setParty(e.target.value);
              setAnswer("");
            }}
          >
            <option value="">All permitted parties</option>
            <option value={`user:${data?.viewerUid}`}>Me</option>
            {data?.contacts.map((p) => (
              <option key={p.id} value={`contact:${p.id}`}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await act({
            operation: "question",
            question,
            party,
            projectId: project,
          });
          if (result)
            setAnswer(
              `${result.answer}${result.incomplete ? "\nThis answer is incomplete; more records may exist." : ""}`,
            );
        }}
      >
        <label className="flex-1">
          Ask about your work
          <input
            className={field}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What do I owe today? Who am I waiting on?"
          />
        </label>
        <button className={button} disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
      {answer && (
        <p
          role="status"
          className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4"
        >
          {answer}
        </p>
      )}
      <button
        className={button}
        disabled={busy}
        onClick={() => setRefresh((n) => n + 1)}
      >
        Refresh current records
      </button>
      {data && (
        <>
          <p className="text-sm">
            Read at {new Date(data.asOf).toLocaleString()} · {data.timezone}
          </p>
          {data.notices.map((notice, i) => (
            <p key={i} role="status">
              {notice}
            </p>
          ))}
          {view === "flows"
            ? data.flows.map((flow) => (
                <article key={flow.id} className="rounded-lg border p-4">
                  <strong>{flow.name}</strong>
                  <p>
                    Version {flow.version} · {flow.status}
                  </p>
                  <a href="/?view=flows" className="underline">
                    Open flows and receipts
                  </a>
                </article>
              ))
            : data.items.map((row) => (
                <article
                  key={row.id}
                  className="space-y-2 rounded-lg border p-4"
                >
                  <h2 className="font-bold">
                    {row.deliverable || "Terms need clarification"}
                  </h2>
                  <p>
                    {label(row.owner)} owes {label(row.beneficiary)} ·{" "}
                    {row.state.replaceAll("_", " ")}
                  </p>
                  <p>
                    Due:{" "}
                    {row.dueAt
                      ? `${new Date(row.dueAt).toLocaleString(undefined, { timeZone: row.timezone || data.timezone })} (${row.timezone || data.timezone})`
                      : "Not agreed"}
                  </p>
                  {row.needsDecision && (
                    <p>Decision waiting for the assigned reviewer.</p>
                  )}
                  {row.sourceCommunicationIds.length > 0 && (
                    <p className="text-sm">
                      Evidence: {row.sourceCommunicationIds.join(", ")}
                    </p>
                  )}
                  <a
                    href={`/?view=obligations&obligation=${encodeURIComponent(row.id)}`}
                    className="underline"
                  >
                    Open obligation, source evidence and Ask
                  </a>
                </article>
              ))}
          {!(view === "flows" ? data.flows.length : data.items.length) && (
            <p>No matching records in this view.</p>
          )}
        </>
      )}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-bold">Repeatable routines</h2>
        <p>
          Create a morning brief flow, inspect its steps, and approve it before
          enabling a daily schedule.
        </p>
        <button
          className={button}
          disabled={busy || !project}
          onClick={async () => {
            const result = await act({
              operation: "template",
              template: "morning_brief",
              projectId: project,
            });
            if (result?.item) setCreatedFlow(result.item.id);
          }}
        >
          Create morning brief for this project
        </button>
        {createdFlow && (
          <a
            href={`/?view=flows&flow=${encodeURIComponent(createdFlow)}`}
            className="block underline"
          >
            Review the new routine
          </a>
        )}
      </div>
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-bold">Supplier follow-up</h2>
        <p>
          Select a project and contact above. The routine uses up to twenty
          accepted open obligations, then waits for your review of the actual
          reply. It does not treat delivery as fulfillment.
        </p>
        <label>
          Follow-up channel
          <select
            className={field}
            value={chaseChannel}
            onChange={(e) => setChaseChannel(e.target.value)}
          >
            <option value="email">Draft email only</option>
            <option value="sms">SMS after flow approval</option>
          </select>
        </label>
        <button
          className={button}
          disabled={busy || !project || !party.startsWith("contact:")}
          onClick={async () => {
            const result = await act({
              operation: "template",
              template: "supplier_chase",
              projectId: project,
              personId: party.slice(8),
              channel: chaseChannel,
            });
            if (result?.item) setCreatedFlow(result.item.id);
          }}
        >
          Create supplier follow-up for review
        </button>
      </div>
      {data && (
        <details className="rounded-lg border p-4">
          <summary>CEO channel access and receptionist settings</summary>
          <form
            key={data.asOf}
            className="mt-3 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const result = await act({
                operation: "configure",
                primaryPersonId: String(form.get("primaryPersonId") || ""),
                receptionistEnabled: form.get("receptionistEnabled") === "on",
                receptionistProjectId: String(
                  form.get("receptionistProjectId") || "",
                ),
                contactWindow: {
                  startHour: Number(form.get("startHour")),
                  endHour: Number(form.get("endHour")),
                  maxPerDay: Number(form.get("maxPerDay")),
                  maxPerContact: Number(form.get("maxPerContact")),
                },
              });
              if (result) {
                setAnswer(result.notice);
                setRefresh((n) => n + 1);
              }
            }}
          >
            <p>
              Link a verified Communications contact to your read-only CEO
              channel access. Existing project grants still apply. Decisions and
              fulfillment continue to require authenticated review.
            </p>
            <label>
              My Communications contact
              <select
                className={field}
                name="primaryPersonId"
                defaultValue={data.configuration.primaryPersonId}
              >
                <option value="">CEO channel access disabled</option>
                {data.contacts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <input
                type="checkbox"
                name="receptionistEnabled"
                defaultChecked={data.configuration.receptionistEnabled}
              />{" "}
              Record receptionist messages and callback requests for review
            </label>
            <label>
              Receptionist review project
              <select
                className={field}
                name="receptionistProjectId"
                defaultValue={data.configuration.receptionistProjectId}
              >
                <option value="">Choose a project</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Unknown callers receive no project facts or diary details. Their
              requests become review candidates, with no callback time promised.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {(
                ["startHour", "endHour", "maxPerDay", "maxPerContact"] as const
              ).map((key) => (
                <label key={key}>
                  {
                    {
                      startHour: "Contact hours begin (0–23)",
                      endHour: "Contact hours end (1–24)",
                      maxPerDay: "Maximum contact attempts per day",
                      maxPerContact: "Maximum attempts per phone number per day",
                    }[key]
                  }
                  <input
                    className={field}
                    type="number"
                    name={key}
                    defaultValue={data.configuration.contactWindow[key]}
                    required
                  />
                </label>
              ))}
            </div>
            <p>
              Hours use {data.timezone}. SMS and phone share the contact budget.
              Repeated supplier follow-ups within an hour are held for review.
            </p>
            <button className={button} disabled={busy}>
              Save channel and contact policy
            </button>
          </form>
        </details>
      )}
    </section>
  );
};
