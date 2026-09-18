import { useProjectScope, useScopedProject } from './ProjectScope';
import React, { useEffect, useState } from "react";
import type { Project } from "../types";
import type { FlowPlan, FlowRecord } from "../lib/visibleFlows/model";
import { firebaseService } from "../services/firebaseService";
import { Markdown } from "./Markdown";
const field =
  "w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900";
const button =
  "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40";
async function api(body?: unknown, path = "/api/flows") {
  const response = await firebaseService.authorizedFetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Flow request failed");
  return result;
}
export const VisibleFlowsPanel: React.FC<{ projects: Project[] }> = ({
  projects,
}) => {
  const [items, setItems] = useState<any[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<FlowRecord | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Record<string, any>>({});
  const scope = useProjectScope();
  const [projectId, setProjectId] = useScopedProject();
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<FlowPlan | null>(null);
  const [selectedId, setSelectedId] = useState(
    new URLSearchParams(window.location.search).get("flow") || "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [runKeys, setRunKeys] = useState<Record<string, string>>({});
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const selected = selectedRecord?.id === selectedId ? selectedRecord : null;
  const latest = selected?.versions[selected.versions.length - 1];
  useEffect(() => {
    let active = true;
    api(undefined, "/api/flows?shape=summary")
      .then((r) => {
        if (active) {
          setItems((r.items || []).filter((row: FlowRecord) => !scope?.projectId || row.projectId === scope.projectId));
          setNextPage(r.next || null);
          setCatalog(r.catalog);
          const focused = r.items.find(
            (row: FlowRecord) => row.id === selectedId,
          );
          if (focused && !scope) setProjectId(focused.projectId);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setSelectedRecord(null);
    if (selectedId)
      api(undefined, `/api/flows?id=${encodeURIComponent(selectedId)}`)
        .then((r) => {
          if (live) {
            if (scope?.projectId && r.item.projectId !== scope.projectId) throw new Error('This flow belongs to a different project.');
            setSelectedRecord(r.item);
            if (!scope) setProjectId(r.item.projectId);
            setItems((old) =>
              old.some((i) => i.id === r.item.id) ? old : [...old, r.item],
            );
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [selectedId]);
  const perform = async (body: any) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(body);
      if (result.proposal) {
        setSelectedId("");
        setProposal(result.proposal);
        setNotice("Proposal only. Review each step and supply missing inputs.");
      }
      if (result.item) {
        setSelectedRecord(result.item);
        setItems((old) => [
          ...old.filter((i) => i.id !== result.item.id),
          result.item,
        ]);
        setSelectedId(result.item.id);
        setNotice(
          result.notice || "Saved. Each run keeps its approved version.",
        );
      }
      return result;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const command = (operation: string, extra: Record<string, unknown> = {}) =>
    perform({
      operation,
      id: selected?.id,
      expectedRevision: selected?.revision,
      version: latest?.version,
      hash: latest?.hash,
      ...extra,
    });
  const edit = (index: number, change: any) =>
    setProposal((old) =>
      old
        ? {
            ...old,
            steps: old.steps.map((s, i) =>
              i === index ? { ...s, ...change } : s,
            ),
          }
        : old,
    );
  return (
    <section className="mx-auto max-w-6xl space-y-5 p-6">
      <h1 className="text-2xl font-bold">Automations</h1>
      <p>
        Describe the busy work, review the steps, then approve a version. Email
        actions create drafts. SMS and phone steps make real contact when
        permitted.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="grid gap-4 rounded-xl border p-4">
        {!scope && <>
        <label>
          Project
          <select
            className={field}
            value={projectId}
            disabled={busy}
            onChange={(e) => {
              setProjectId(e.target.value);
              setProposal(null);
              setSelectedId("");
            }}
          >
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        </>}
        {scope && !projectId && <p className="text-sm text-slate-600">Viewing flows across all projects. Select a project above to propose a new flow.</p>}
        <label>
          What should this flow do?
          <textarea
            className={field}
            value={prompt}
            maxLength={8000}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Chase missing supplier updates and prepare my weekly report"
          />
        </label>
        <button
          className={button}
          disabled={busy || !projectId || !prompt.trim()}
          onClick={() => perform({ operation: "compile", projectId, prompt })}
        >
          Propose a flow
        </button>
      </div>
      <label>
        Saved flow
        <select
          className={field}
          value={selectedId}
          disabled={busy}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setProposal(null);
            const row = items.find((i) => i.id === e.target.value);
            if (row && !scope) setProjectId(row.projectId);
          }}
        >
          <option value="">Choose a saved flow</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name || i.versions?.at(-1)?.plan.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className={button}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await api(undefined, "/api/flows?shape=summary");
            setItems((result.items || []).filter((row: FlowRecord) => !scope?.projectId || row.projectId === scope.projectId));
            setNextPage(result.next || null);
            if (selectedId) {
              const detail = await api(
                undefined,
                `/api/flows?id=${encodeURIComponent(selectedId)}`,
              );
              setSelectedRecord(detail.item);
              setItems((old) =>
                old.some((i) => i.id === detail.item.id)
                  ? old
                  : [...old, detail.item],
              );
            }
            setCatalog(result.catalog);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Refresh receipts
      </button>
      {nextPage && (
        <button
          className={button}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await api(
                undefined,
                `/api/flows?shape=summary&after=${encodeURIComponent(nextPage)}`,
              );
              setItems((old) => [
                ...old,
                ...result.items.filter(
                  (row: any) => (!scope?.projectId || row.projectId === scope.projectId) && !old.some((item) => item.id === row.id),
                ),
              ]);
              setNextPage(result.next || null);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Load more flows
        </button>
      )}
      {proposal && (
        <div className="space-y-4 rounded-xl border p-4">
          <label>
            Flow name
            <input
              className={field}
              value={proposal.name}
              onChange={(e) =>
                setProposal({ ...proposal, name: e.target.value })
              }
            />
          </label>
          {proposal.steps.map((step, index) => (
            <article key={step.id} className="space-y-3 rounded-xl border p-4">
              <h2 className="font-bold">
                Step {index + 1}: {catalog[step.action]?.label || step.action}
              </h2>
              <p>{catalog[step.action]?.effect}</p>
              <label>
                Step name
                <input
                  className={field}
                  value={step.name}
                  onChange={(e) => edit(index, { name: e.target.value })}
                />
              </label>
              <label>
                Owner
                <input
                  className={field}
                  value={step.owner}
                  onChange={(e) => edit(index, { owner: e.target.value })}
                />
              </label>
              <label>
                Wait for steps (identities separated by commas)
                <input
                  className={field}
                  value={step.dependsOn.join(", ")}
                  onChange={(e) =>
                    edit(index, {
                      dependsOn: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <p className="text-xs">This step’s identity: {step.id}</p>
              {(catalog[step.action]?.required || []).map((key: string) => (
                <label key={key} className="block">
                  {key}
                  <textarea
                    className={field}
                    value={step.inputs[key] || ""}
                    onChange={(e) =>
                      edit(index, {
                        inputs: { ...step.inputs, [key]: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
              <p>
                Sources:{" "}
                {step.sources.join(", ") || "No source references supplied"}
              </p>
            </article>
          ))}
          <button
            className={button}
            disabled={busy}
            onClick={async () => {
              const result = selected
                ? await command("revise", { plan: proposal })
                : await perform({
                    operation: "create",
                    projectId,
                    plan: proposal,
                  });
              if (result) setProposal(null);
            }}
          >
            Save for review
          </button>
        </div>
      )}
      {latest && (
        <div className="space-y-4 rounded-xl border p-4">
          <h2 className="text-xl font-bold">
            {latest.plan.name} · Version {latest.version}
          </h2>
          <ol className="space-y-3">
            {latest.plan.steps.map((s) => (
              <li key={s.id} className="rounded-lg bg-slate-50 p-3">
                <strong>{s.name}</strong>
                <p>
                  {catalog[s.action]?.effect} · Owner:{" "}
                  {s.owner || "Needs clarification"}
                </p>
                <p>
                  Waits for: {s.dependsOn.join(", ") || "Start"} · Sources:{" "}
                  {s.sources.join(", ") || "None supplied"}
                </p>
                {Object.entries(s.inputs).map(([k, v]) => (
                  <p key={k} className="whitespace-pre-wrap break-words">
                    {k}: {v || "Needs clarification"}
                  </p>
                ))}
              </li>
            ))}
          </ol>
          <p>{latest.ask.prompt}</p>
          <p>
            Ask: {latest.ask.status} ·{" "}
            {latest.approvedBy ? "Approved" : "Awaiting review"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={busy}
              onClick={() => setProposal(structuredClone(latest.plan))}
            >
              Edit as a new version
            </button>
            {latest.ask.status === "open" && !latest.missing.length && (
              <>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => command("approve")}
                >
                  Approve these exact steps and inputs
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => command("reject")}
                >
                  Reject this version
                </button>
              </>
            )}
            {latest.approvedBy && (
              <button
                className={button}
                disabled={busy}
                onClick={async () => {
                  const key =
                    runKeys[latest.hash] ||
                    crypto.randomUUID().replace(/-/g, "");
                  setRunKeys((old) => ({ ...old, [latest.hash]: key }));
                  const result = await command("start", { runKey: key });
                  if (result) {
                    setRunKeys((old) => {
                      const next = { ...old };
                      delete next[latest.hash];
                      return next;
                    });
                    setNotice(
                      "Run created. Advance it to execute the approved steps.",
                    );
                  }
                }}
              >
                Create a run of this version
              </button>
            )}
          </div>
          <details>
            <summary>Version history</summary>
            {selected!.versions.map((v) => (
              <p key={v.version}>
                Version {v.version}: {v.plan.name} ·{" "}
                {v.approvedBy ? "Approved" : "Not approved"} ·{" "}
                {new Date(v.createdAt).toLocaleString()}
              </p>
            ))}
          </details>
          <div className="space-y-2 rounded-lg border p-3">
            <h3 className="font-bold">Daily routine</h3>
            <label>
              Local run time
              <input
                type="time"
                className={field}
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
              />
            </label>
            <p>
              Uses your configured timezone and this exact approved version.
              Channel limits still apply.
            </p>
            {latest.approvedBy && (
              <button
                className={button}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const r = await api(
                      {
                        operation: "schedule",
                        definitionId: selected!.id,
                        projectId: selected!.projectId,
                        version: latest.version,
                        hash: latest.hash,
                        localTime: scheduleTime,
                        enabled: true,
                      },
                      "/api/cockpit",
                    );
                    setNotice(r.notice);
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Enable daily routine for this version
              </button>
            )}
            <button
              className={button}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await api(
                    {
                      operation: "schedule",
                      definitionId: selected!.id,
                      projectId: selected!.projectId,
                      enabled: false,
                    },
                    "/api/cockpit",
                  );
                  setNotice(r.notice);
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Disable daily routine
            </button>
          </div>
          {selected!.runs.map((run) => (
            <article key={run.id} className="space-y-3 rounded-lg border p-4">
              <h3 className="font-bold">
                Run · Version {run.version} · {run.status}
              </h3>
              <p className="text-xs">{run.id}</p>
              {run.snapshot.milestones.map((m) => (
                <details key={m.id}>
                  <summary>
                    {m.name}: {m.actionConfig?.lastRun?.status || "Not started"}
                  </summary>
                  <p>{m.actionConfig?.lastRun?.error}</p>
                  {m.actionConfig?.lastRun?.output?.publication_id && (
                    <div className="my-3 space-y-2">
                      <a
                        className="underline"
                        href={`/?view=publishing&project=${encodeURIComponent(run.projectId)}`}
                      >
                        Open publication and its approval
                      </a>
                      {m.actionConfig.lastRun.status === "pending" &&
                        run.status !== "cancelled" && (
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() =>
                              void command("reconcile_publication", {
                                runId: run.id,
                                nodeId: m.id,
                              })
                            }
                          >
                            Verify current publication
                          </button>
                        )}
                    </div>
                  )}
                  {m.actionConfig?.lastRun?.output?.artifact_job_id && (
                    <div className="my-3 space-y-2">
                      <a
                        className="underline"
                        href={`/?view=artifacts&project=${encodeURIComponent(run.projectId)}&artifact=${encodeURIComponent(m.actionConfig.lastRun.output.artifact_job_id)}`}
                      >
                        Open report inputs and file review
                      </a>
                      {m.actionConfig.lastRun.status === "pending" &&
                        run.status !== "cancelled" && (
                          <button
                            className={button}
                            onClick={() =>
                              void command("reconcile_artifact", {
                                runId: run.id,
                                nodeId: m.id,
                              })
                            }
                          >
                            Verify completed file review
                          </button>
                        )}
                    </div>
                  )}
                  {m.actionConfig?.lastRun?.status === "pending" &&
                    m.actionConfig.lastRun.output?.ask?.status === "open" &&
                    run.status !== "cancelled" && (
                      <form
                        className="space-y-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          void command("answer_update", {
                            runId: run.id,
                            nodeId: m.id,
                            askId: m.actionConfig!.lastRun!.output.ask.id,
                            note: String(data.get("note") || ""),
                          });
                        }}
                      >
                        <p>{m.actionConfig.lastRun.output.ask.prompt}</p>
                        <label>
                          Reviewed update
                          <textarea
                            className={field}
                            name="note"
                            required
                            maxLength={4000}
                          />
                        </label>
                        <button className={button} disabled={busy}>
                          Save response to this Ask
                        </button>
                      </form>
                    )}
                  {typeof m.actionConfig?.lastRun?.output?.report_content ===
                    "string" && (
                    <Markdown
                      content={m.actionConfig.lastRun.output.report_content}
                    />
                  )}
                  {m.actionConfig?.lastRun?.status === "pending" &&
                    ["send_sms", "outgoing_call"].includes(
                      run.plan.steps.find((s) => s.id === m.id)?.action || "",
                    ) && (
                      <form
                        className="my-3 space-y-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          void command("reconcile", {
                            runId: run.id,
                            nodeId: m.id,
                            communicationId: String(
                              data.get("communicationId") || "",
                            ),
                          });
                        }}
                      >
                        <label>
                          Communication receipt identity
                          <input
                            className={field}
                            name="communicationId"
                            defaultValue={
                              m.actionConfig.lastRun.externalId || ""
                            }
                          />
                        </label>
                        <button className={button} disabled={busy}>
                          Check provider receipt
                        </button>
                        <p>
                          This checks the saved provider outcome without sending
                          again.
                        </p>
                      </form>
                    )}
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(
                      m.actionConfig?.lastRun || { waitingFor: m.dependsOn },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ))}
              <div className="flex flex-wrap gap-2">
                {run.status === "running" && (
                  <>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => command("advance", { runId: run.id })}
                    >
                      Advance run
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => command("pause", { runId: run.id })}
                    >
                      Pause
                    </button>
                  </>
                )}
                {run.status === "paused" && (
                  <>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => command("resume", { runId: run.id })}
                    >
                      Resume
                    </button>
                    <button
                      className={button}
                      disabled={busy || !latest.approvedBy}
                      onClick={() => command("migrate", { runId: run.id })}
                    >
                      Use approved latest version before dispatch
                    </button>
                  </>
                )}
                {["running", "paused"].includes(run.status) && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => command("cancel", { runId: run.id })}
                  >
                    Cancel remaining steps
                  </button>
                )}
                {run.status === "completed" && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      command(run.reviewedBy ? "promote" : "review", {
                        runId: run.id,
                      })
                    }
                  >
                    {run.reviewedBy
                      ? "Promote reviewed inputs to a new version"
                      : "Mark output reviewed"}
                  </button>
                )}
              </div>
              <p className="text-sm">
                Pause and cancel stop new steps. They do not recall messages,
                calls or other effects already dispatched. Pending receipts
                require reconciliation; advancing again does not repeat them.
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
