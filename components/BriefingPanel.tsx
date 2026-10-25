import React, { useEffect, useState, useCallback } from "react";
import { firebaseService } from "../services/firebaseService";
import { SubtaskStatus } from "../types";

const button =
  "rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-40";
const inputClass = "rounded border border-slate-300 bg-white px-2 py-2 text-sm";
type Settings = {
  enabled: boolean;
  allowTaskUpdates: boolean;
  allowApprovals: boolean;
  sections: string[];
  reportSubject: string;
  reportType: string;
  reportDays: number;
  projectIds?: string[] | null;
};
export function BriefingPanel({
  orgId,
  projectId,
  request = firebaseService.authorizedFetch,
}: {
  orgId: string;
  projectId?: string;
  request?: typeof firebaseService.authorizedFetch;
}) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [subjects, setSubjects] = useState<
      Array<{ id: string; name: string; kind?: string }>
    >([]);
  const [subject, setSubject] = useState("me"),
    [view, setView] = useState("list_tasks"),
    [reportType, setReportType] = useState("workload");
  const [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [thisProject, setThisProject] = useState(false);
  const [data, setData] = useState<any>(null),
    [pending, setPending] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [status, setStatus] = useState<string>(SubtaskStatus.COMPLETE),
    [note, setNote] = useState("");
  const [mappingName, setMappingName] = useState(""),
    [mappingUid, setMappingUid] = useState("");
  const [checks, setChecks] = useState<Record<string, Record<string, boolean>>>(
    {},
  );
  const [readiness, setReadiness] = useState<any>(null);
  const call = useCallback(
    async (method: string, body: any) => {
      const url =
        "/api/briefings" +
        (method === "GET" ? "?" + new URLSearchParams(body) : "");
      const response = await request(url, {
        method,
        ...(method === "GET"
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Briefing unavailable");
      return value;
    },
    [request],
  );
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    setSettings(null);
    setData(null);
    setPending(null);
    setError("");
    Promise.all([
      call("GET", { operation: "settings" }),
      call("GET", { operation: "subjects" }),
    ])
      .then(([s, u]) => {
        if (active) {
          setSettings(s.settings);
          setSubjects(u.subjects);
          setSubject(s.settings.reportSubject);
          setReportType(s.settings.reportType);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [orgId, call]);
  const refresh = async (after?: string) => {
    const result = await call("POST", {
      operation: view,
      subject,
      reportType,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      projectId: thisProject ? projectId : undefined,
      after,
    });
    setData(result);
    setPending(null);
    const h = await call("GET", { operation: "changes" });
    setHistory(h.items);
  };
  const propose = async (item: any, action: string) => {
    const current = await call("POST", {
      operation: "read_item",
      itemId: item.id,
    });
    if (current.item.version !== item.version)
      throw new Error(
        "This item changed. Load / refresh and review it again before preparing a change.",
      );
    const result = await call("POST", {
      operation: "prepare_change",
      itemId: item.id,
      version: item.version,
      action,
      status,
      note,
      ...checks[item.id],
      requestId: crypto.randomUUID(),
    });
    setPending(result);
  };
  return (
    <section
      className="space-y-3 rounded-xl border border-indigo-200 bg-white p-4"
      aria-label="Daily briefing"
    >
      <div>
        <h3 className="font-bold text-slate-900">Daily briefing</h3>
        <p className="text-sm text-slate-600">
          Review assigned work, decisions and reports here or during your
          coaching call. Voice access requires a verification code sent to your
          enrolled number.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-green-800">
          {message}
        </p>
      )}
      <button
        type="button"
        className={button}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setReadiness(await call("GET", { operation: "readiness" }));
          })
        }
      >
        Check call readiness
      </button>
      {readiness && (
        <div role="status" className="text-sm">
          <strong>
            {readiness.ready
              ? "Live briefing is ready"
              : "Briefing setup needs attention"}
          </strong>
          <ul>
            {readiness.checks.map((c: any) => (
              <li key={c.name}>
                {c.ready ? "Ready" : "Needs attention"} · {c.name}: {c.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {settings && (
        <details>
          <summary className="cursor-pointer font-medium">
            Call settings and permissions
          </summary>
          <div className="mt-3 space-y-3">
            {(
              [
                ["enabled", "Enable live briefing"],
                ["allowTaskUpdates", "Allow confirmed task updates"],
                ["allowApprovals", "Allow confirmed approval decisions"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="mr-4 inline-flex items-center gap-2 text-sm"
              >
                <input
                  disabled={busy}
                  type="checkbox"
                  checked={settings[key]}
                  onChange={(e) =>
                    setSettings({ ...settings, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
            <div className="flex flex-wrap gap-2">
              <label className="text-sm">
                Section order{" "}
                <select
                  disabled={busy}
                  className={inputClass}
                  value={settings.sections.join(",")}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      sections: e.target.value.split(","),
                    })
                  }
                >
                  <option value="tasks,approvals,reports">
                    Tasks, approvals, reports
                  </option>
                  <option value="approvals,tasks,reports">
                    Approvals, tasks, reports
                  </option>
                  <option value="reports,tasks,approvals">
                    Reports, tasks, approvals
                  </option>
                </select>
              </label>
              <label className="text-sm">
                Default report subject{" "}
                <select
                  disabled={busy}
                  className={inputClass}
                  value={settings.reportSubject}
                  onChange={(e) =>
                    setSettings({ ...settings, reportSubject: e.target.value })
                  }
                >
                  <option value="me">Me</option>
                  <option value="all">Everyone I can access</option>
                </select>
              </label>
              <label className="text-sm">
                Report type{" "}
                <select
                  disabled={busy}
                  className={inputClass}
                  value={settings.reportType}
                  onChange={(e) =>
                    setSettings({ ...settings, reportType: e.target.value })
                  }
                >
                  <option value="workload">Workload</option>
                  <option value="progress">Progress</option>
                  <option value="approvals">Approvals</option>
                </select>
              </label>
              <label className="text-sm">
                Report days{" "}
                <input
                  disabled={busy}
                  className={inputClass}
                  type="number"
                  min={1}
                  max={365}
                  value={settings.reportDays}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      reportDays: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            {projectId && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  disabled={busy}
                  type="checkbox"
                  checked={
                    settings.projectIds?.length === 1 &&
                    settings.projectIds[0] === projectId
                  }
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      projectIds: e.target.checked ? [projectId] : null,
                    })
                  }
                />
                Limit the call briefing to this project
              </label>
            )}
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await call("PUT", {
                    operation: "settings",
                    ...settings,
                  });
                  setSettings(r.settings);
                  setMessage(
                    "Briefing settings saved. SMS verification is required during each call.",
                  );
                })
              }
            >
              Save briefing settings
            </button>
          </div>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="text-sm">
          Review{" "}
          <select
            disabled={busy}
            className={inputClass}
            value={view}
            onChange={(e) => {
              setView(e.target.value);
              setData(null);
              setPending(null);
            }}
          >
            <option value="list_tasks">Assigned tasks</option>
            <option value="list_approvals">Waiting for approval</option>
            <option value="report">Reports</option>
          </select>
        </label>
        <label className="text-sm">
          User{" "}
          <select
            disabled={busy}
            className={inputClass}
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setData(null);
              setPending(null);
            }}
          >
            <option value="me">Me</option>
            <option value="all">Everyone I can access</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {projectId && (
          <label className="flex items-center gap-2 text-sm">
            <input
              disabled={busy}
              type="checkbox"
              checked={thisProject}
              onChange={(e) => setThisProject(e.target.checked)}
            />
            This project
          </label>
        )}
        {view === "report" && (
          <>
            <label className="text-sm">
              Report{" "}
              <select
                disabled={busy}
                className={inputClass}
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
              >
                <option value="workload">Workload</option>
                <option value="progress">Progress</option>
                <option value="approvals">Approvals</option>
              </select>
            </label>
            <label className="text-sm">
              From{" "}
              <input
                disabled={busy}
                aria-label="Report start date"
                type="date"
                className={inputClass}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="text-sm">
              To{" "}
              <input
                disabled={busy}
                aria-label="Report end date"
                type="date"
                className={inputClass}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          className={button}
          onClick={() => void run(() => refresh())}
        >
          {busy ? "Loading…" : "Load / refresh"}
        </button>
      </div>
      {data && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            As of {new Date(data.asOf).toLocaleString()} · {data.total} matching
            items{data.incomplete ? " · Incomplete coverage" : ""}
          </p>
          {data.notices?.map((n: string) => (
            <p key={n} className="text-sm text-amber-800">
              {n}
            </p>
          ))}
          {data.text && <p className="text-sm">{data.text}</p>}
          {!data.items?.length && (
            <p className="text-sm">
              No matching items were returned
              {data.incomplete ? "; some sources are unavailable." : "."}
            </p>
          )}
          {data.items?.some((i: any) => i.actions.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {data.items.some((i: any) =>
                i.actions.includes("set_status"),
              ) && (
                <label className="text-sm">
                  New task status{" "}
                  <select
                    disabled={busy}
                    className={inputClass}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {(data.statusOptions || Object.values(SubtaskStatus)).map(
                      (s: string) => (
                        <option key={s}>{s}</option>
                      ),
                    )}
                  </select>
                </label>
              )}
              <label className="text-sm">
                Evidence / note{" "}
                <input
                  disabled={busy}
                  className={inputClass}
                  value={note}
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>
          )}
          <ul className="divide-y">
            {data.items?.map((item: any) => (
              <li key={item.id} className="space-y-1 py-3">
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-slate-600">
                  {item.projectName || "Personal work"} ·{" "}
                  {item.source.replaceAll("_", " ")} · {item.status}
                  {item.assigneeLabel
                    ? " · assigned to " + item.assigneeLabel
                    : ""}
                  {item.dueAt
                    ? " · due " + new Date(item.dueAt).toLocaleString()
                    : ""}
                </p>
                {item.notice && (
                  <p className="text-sm text-amber-800">{item.notice}</p>
                )}
                {item.details && (
                  <details>
                    <summary className="text-sm">Details</summary>
                    <p className="whitespace-pre-wrap text-sm">
                      {item.details}
                    </p>
                  </details>
                )}
                {item.requiredChecks?.map((check: string) => (
                  <label
                    key={check}
                    className="mr-3 inline-flex items-center gap-2 text-sm"
                  >
                    <input
                      disabled={busy}
                      type="checkbox"
                      checked={checks[item.id]?.[check] || false}
                      onChange={(e) =>
                        setChecks({
                          ...checks,
                          [item.id]: {
                            ...checks[item.id],
                            [check]: e.target.checked,
                          },
                        })
                      }
                    />
                    {check === "visualChecked"
                      ? "I inspected this file layout"
                      : check === "contentChecked"
                        ? "I checked this file against its sources"
                        : "I checked this exact content is permitted for public use"}
                  </label>
                ))}
                <div className="flex flex-wrap gap-2">
                  {item.actions.map((action: string) => (
                    <button
                      type="button"
                      key={action}
                      className={button}
                      disabled={busy}
                      onClick={() => void run(() => propose(item, action))}
                    >
                      {action === "set_status"
                        ? "Change status"
                        : action === "submit"
                          ? "Submit evidence"
                          : action.charAt(0).toUpperCase() + action.slice(1)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {data.next && (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => void run(() => refresh(data.next))}
            >
              Next page
            </button>
          )}
          {data.truncated && (
            <p className="text-sm text-amber-800">
              This report shows the first 100 items. Narrow the report to see
              the remaining detail.
            </p>
          )}
        </div>
      )}
      {pending && (
        <div
          role="region"
          aria-label="Confirm briefing change"
          className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3"
        >
          <p>{pending.readback}</p>
          <button
            type="button"
            className={button}
            disabled={busy || pending.status !== "prepared"}
            onClick={() =>
              void run(async () => {
                const r = await call("POST", {
                  operation: "confirm_change",
                  id: pending.id,
                  confirmed: true,
                });
                setPending(r);
                setMessage(
                  r.status === "completed"
                    ? "Change saved."
                    : `Change ${r.status}. ${r.error || "Check the saved outcome before retrying."}`,
                );
                await refresh();
              })
            }
          >
            Confirm exact change
          </button>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {history.length > 0 && (
        <details>
          <summary>Recent briefing actions</summary>
          <ul>
            {history.map((h) => (
              <li key={h.id} className="py-2 text-sm">
                {h.readback} <strong>{h.status}</strong>
                {h.error && <p>{h.error}</p>}
                {["processing", "uncertain"].includes(h.status) && (
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await call("GET", {
                          operation: "change_result",
                          id: h.id,
                        });
                        setHistory(
                          history.map((old) =>
                            old.id === h.id ? { ...old, ...r } : old,
                          ),
                        );
                        setMessage(`Saved outcome: ${r.status}`);
                      })
                    }
                  >
                    Check saved outcome
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary className="cursor-pointer text-sm">
          Correct an assignee mapping
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="text-sm">
            Existing assignee name{" "}
            <input
              disabled={busy}
              className={inputClass}
              value={mappingName}
              onChange={(e) => setMappingName(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Verified user{" "}
            <select
              disabled={busy}
              className={inputClass}
              value={mappingUid}
              onChange={(e) => setMappingUid(e.target.value)}
            >
              <option value="">Choose a user</option>
              {subjects
                .filter((s) => s.kind !== "assignee")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !mappingName.trim() || !mappingUid}
            className={button}
            onClick={() =>
              void run(async () => {
                await call("POST", {
                  operation: "map_assignee",
                  name: mappingName.trim(),
                  userId: mappingUid,
                });
                setMessage(
                  "Assignee mapping saved. Refresh the briefing to review the result.",
                );
              })
            }
          >
            Save mapping
          </button>
        </div>
      </details>
    </section>
  );
}
