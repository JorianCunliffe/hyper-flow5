import React, { useEffect, useRef, useState } from "react";
import { firebaseService } from "../services/firebaseService";
import type { ReceptionConfig, ReceptionProject } from "../lib/reception/model";

const request = async (url: string, body?: any) => {
  const response = await firebaseService.authorizedFetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Reception request failed");
  return result;
};
export default function ReceptionistsPanel({
  projectId,
  onClose,
  transport = request,
}: {
  key?: string;
  projectId?: string;
  onClose?: () => void;
  transport?: typeof request;
}) {
  const [snapshot, setSnapshot] = useState<any>();
  const [config, setConfig] = useState<ReceptionConfig>();
  const [review, setReview] = useState<any>();
  const [reviewKind, setReviewKind] = useState("prepare");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(projectId || "");
  const [resources, setResources] = useState<any[]>([]),
    [people, setPeople] = useState<any[]>([]);
  const [availability, setAvailability] = useState("[]");
  const [preview, setPreview] = useState<any>();
  const [notice, setNotice] = useState("");
  // Keep the exact request across a lost response; never invent a replacement ID.
  const pendingRequest = useRef<{ signature: string; body: any }>();
  const load = async () => {
    const data = await transport("/api/reception");
    setSnapshot(data);
    setConfig(data.config);
  };
  useEffect(() => {
    let active = true;
    transport("/api/reception")
      .then((data) => {
        if (active) {
          setSnapshot(data);
          setConfig(data.config);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    transport("/api/integrations")
      .then((data) => {
        if (active) setPeople(data.people || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [transport]);
  useEffect(() => {
    let active = true;
    setResources([]);
    if (selected)
      transport(
        `/api/workspace/resources?projectId=${encodeURIComponent(selected)}`,
      )
        .then((data) => {
          if (active) setResources(data.resources || []);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected, transport]);
  const change = (next: ReceptionConfig) => {
    setConfig(next);
    setReview(undefined);
    setPreview(undefined);
  };
  const run = async (operation: string, extra: any = {}) => {
    if (busy || !config) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = {
        operation,
        expectedRevision: snapshot.config.revision,
        config,
        reviewHash: review?.reviewHash,
        ...extra,
      };
      const signature = JSON.stringify(body);
      if (pendingRequest.current?.signature !== signature)
        pendingRequest.current = {
          signature,
          body: { ...body, requestId: `reception_${crypto.randomUUID()}` },
        };
      const result = await transport(
        "/api/reception",
        pendingRequest.current.body,
      );
      pendingRequest.current = undefined;
      setNotice(
        result.notice ||
          (result.status ? `Operation status: ${result.status}` : ""),
      );
      if (["prepare", "review_activation"].includes(operation)) {
        setReview(result);
        setReviewKind(operation);
      } else if (operation === "preview") setPreview(result);
      else {
        await load();
        setReview(undefined);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const project = config?.projects.find((p) => p.projectId === selected);
  const updateProject = (patch: Partial<ReceptionProject>) =>
    change({
      ...config!,
      projects: config!.projects.map((p) =>
        p.projectId === selected ? { ...p, ...patch } : p,
      ),
    });
  const field = "border border-slate-300 rounded px-3 py-2 w-full";
  return (
    <section
      aria-label="Receptionists"
      className="bg-white text-slate-900 rounded-xl p-6 space-y-5 max-w-5xl mx-auto [&_button]:rounded [&_button]:border [&_button]:border-slate-300 [&_button]:px-3 [&_button]:py-2 [&_button]:text-sm [&_button]:font-medium"
    >
      <div className="flex justify-between">
        <h2 className="text-xl font-bold">
          {projectId ? "Inbound reception" : "Receptionists"}
        </h2>
        {onClose && <button onClick={onClose}>Close</button>}
      </div>
      <p>
        Each incoming number serves only its enabled services. Saving pauses
        reception; activation requires a separate administrator review. Existing
        outbound settings do not publish a service.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!config ? (
        <p>Loading reception configuration…</p>
      ) : (
        <>
          <p>
            Routing: {snapshot.mode}. Feature:{" "}
            {snapshot.enabled ? "available" : "disabled"}. Revision{" "}
            {snapshot.config.revision}.
          </p>
          <fieldset disabled={busy} className="space-y-4">
            <legend className="font-semibold">Incoming numbers</legend>
            {config.lines.map((line, index) => (
              <div key={line.id} className="border rounded p-4 space-y-2">
                <label>
                  <input
                    type="checkbox"
                    checked={line.enabled}
                    onChange={(e) =>
                      change({
                        ...config,
                        lines: config.lines.map((l, i) =>
                          i === index ? { ...l, enabled: e.target.checked } : l,
                        ),
                      })
                    }
                  />{" "}
                  Enable on activation
                </label>
                <label className="block">
                  <input type="checkbox" checked={line.smsEnabled === true}
                    onChange={e => change({ ...config, lines: config.lines.map((l, i) =>
                      i === index ? { ...l, smsEnabled: e.target.checked } : l) })} />{" "}
                  Handle inbound SMS (requires separate SMS send permission)
                </label>
                {(
                  [
                    "identity",
                    "name",
                    "greeting",
                    "timezone",
                    "inboxOwner",
                  ] as const
                ).map((key) => (
                  <label key={key} className="block">
                    {
                      {
                        identity: "Phone number (E.164)",
                        name: "Receptionist public name",
                        greeting: "Greeting",
                        timezone: "Timezone",
                        inboxOwner: "Unassigned inbox owner (member ID)",
                      }[key]
                    }
                    <input
                      className={field}
                      value={line[key]}
                      onChange={(e) =>
                        change({
                          ...config,
                          lines: config.lines.map((l, i) =>
                            i === index ? { ...l, [key]: e.target.value } : l,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <label className="block">
                  Operating hours (optional JSON: days 0–6, start and end HH:mm)
                  <input
                    className={field}
                    defaultValue={line.hours ? JSON.stringify(line.hours) : ""}
                    onBlur={(e) => {
                      try {
                        const hours = e.target.value
                          ? JSON.parse(e.target.value)
                          : undefined;
                        change({
                          ...config,
                          lines: config.lines.map((l, i) =>
                            i === index ? { ...l, hours } : l,
                          ),
                        });
                      } catch {
                        setError("Operating hours must be valid JSON.");
                      }
                    }}
                  />
                </label>
                <label className="block">After-hours replies<select value={line.afterHoursMode||'reply'} onChange={e=>change({...config,lines:config.lines.map((l,i)=>i===index?{...l,afterHoursMode:e.target.value as any}:l)})}><option value="reply">Inherit workspace reply permission</option><option value="acknowledge">Acknowledgement only</option><option value="queue">Queue silently</option></select></label>
                <p>Services on this number</p>
                {config.projects.map((p) => (
                  <label key={p.projectId} className="block">
                    <input
                      type="checkbox"
                      checked={line.projectIds.includes(p.projectId)}
                      onChange={(e) =>
                        change({
                          ...config,
                          lines: config.lines.map((l, i) =>
                            i === index
                              ? {
                                  ...l,
                                  projectIds: e.target.checked
                                    ? [...l.projectIds, p.projectId]
                                    : l.projectIds.filter(
                                        (id) => id !== p.projectId,
                                      ),
                                }
                              : l,
                          ),
                        })
                      }
                    />{" "}
                    {p.label}
                  </label>
                ))}
                <button
                  onClick={() => run("preview", { identity: line.identity })}
                >
                  Public routing preview
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                change({
                  ...config,
                  lines: [
                    ...config.lines,
                    {
                      id: `line_${crypto.randomUUID()}`,
                      identity: "",
                      enabled: false,
                      name: "",
                      greeting: "",
                      timezone: "Australia/Brisbane",
                      projectIds: [],
                      inboxOwner: "",
                    },
                  ],
                })
              }
            >
              Add incoming number
            </button>
          </fieldset>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="font-semibold">Project inbound reception</legend>
            <label className="block">
              Project
              <select
                className={field}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Select project</option>
                {snapshot.projects.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {selected && !project && (
              <button
                onClick={() =>
                  change({
                    ...config,
                    projects: [
                      ...config.projects,
                      {
                        projectId: selected,
                        enabled: false,
                        label: "",
                        aliases: [],
                        visibility: "public",
                        knowledge: "",
                        historySourceProjectIds: [selected],
                        intakeOwner: "",
                        actions: [],
                      },
                    ],
                  })
                }
              >
                Configure this project's reception
              </button>
            )}
            {project && (
              <>
                <label className="block">Project after-hours replies<select value={project.afterHoursMode||'reply'} onChange={e=>updateProject({afterHoursMode:e.target.value as any})}><option value="reply">Inherit number and workspace</option><option value="acknowledge">Acknowledgement only</option><option value="queue">Queue silently</option></select></label>
                <label className="block">Additional project hours (JSON, optional)<input key={project.projectId} defaultValue={project.hours?JSON.stringify(project.hours):''} onBlur={e=>{try{updateProject({hours:e.target.value?JSON.parse(e.target.value):undefined});}catch{setError('Project hours must be valid JSON.');}}}/></label>
                <fieldset><legend>Authorized actions available after hours</legend>{project.actions.map(a=><label key={a} className="block"><input type="checkbox" checked={project.afterHoursActions?.includes(a)||false} onChange={e=>updateProject({afterHoursActions:e.target.checked?[...(project.afterHoursActions||[]),a]:(project.afterHoursActions||[]).filter(v=>v!==a)})}/>{a}</label>)}</fieldset>
                <label>
                  <input
                    type="checkbox"
                    checked={project.enabled}
                    onChange={(e) =>
                      updateProject({ enabled: e.target.checked })
                    }
                  />{" "}
                  Allow inbound reception through enabled number bindings
                </label>
                <label className="block">
                  Public service name
                  <input
                    className={field}
                    value={project.label}
                    onChange={(e) => updateProject({ label: e.target.value })}
                  />
                </label>
                <label className="block">
                  Aliases (comma separated)
                  <input
                    className={field}
                    value={project.aliases.join(",")}
                    onChange={(e) =>
                      updateProject({
                        aliases: e.target.value.split(",").filter(Boolean),
                      })
                    }
                  />
                </label>
                <label className="block">
                  Visibility
                  <select
                    className={field}
                    value={project.visibility}
                    onChange={(e) =>
                      updateProject({ visibility: e.target.value as any })
                    }
                  >
                    <option value="public">Public help and intake</option>
                    <option value="recognized">
                      Recognized associated callers only
                    </option>
                  </select>
                </label>
                <label className="block">
                  Intake owner (member ID)
                  <input
                    className={field}
                    value={project.intakeOwner}
                    onChange={(e) =>
                      updateProject({ intakeOwner: e.target.value })
                    }
                  />
                </label>
                <label className="block">
                  Approved public information
                  <textarea
                    className={field}
                    rows={5}
                    value={project.knowledge}
                    onChange={(e) =>
                      updateProject({ knowledge: e.target.value })
                    }
                  />
                </label>
                <p>Caller-only history sources</p>
                {snapshot.projects.map((p: any) => (
                  <label key={p.id} className="block">
                    <input
                      type="checkbox"
                      checked={project.historySourceProjectIds.includes(p.id)}
                      onChange={(e) =>
                        updateProject({
                          historySourceProjectIds: e.target.checked
                            ? [...project.historySourceProjectIds, p.id]
                            : project.historySourceProjectIds.filter(
                                (id) => id !== p.id,
                              ),
                        })
                      }
                    />{" "}
                    {p.name}
                  </label>
                ))}
                <p>Permitted actions</p>
                {(["availability", "booking", "resume_ask"] as const).map(
                  (action) => (
                    <label key={action} className="block">
                      <input
                        type="checkbox"
                        checked={project.actions.includes(action)}
                        onChange={(e) =>
                          updateProject({
                            actions: e.target.checked
                              ? [...project.actions, action]
                              : project.actions.filter((a) => a !== action),
                          })
                        }
                      />{" "}
                      {
                        {
                          availability: "Check room availability",
                          booking: "Book confirmed inspections",
                          resume_ask: "Resume verified staff questions",
                        }[action]
                      }
                    </label>
                  ),
                )}
                {project.actions.includes("availability") && (
                  <label className="block">
                    Named availability connection
                    <input
                      className={field}
                      value={project.availabilityConnection || ""}
                      onChange={(e) =>
                        updateProject({
                          availabilityConnection: e.target.value,
                        })
                      }
                    />
                  </label>
                )}
                {project.actions.includes("booking") && !project.booking && (
                  <button
                    onClick={() =>
                      updateProject({
                        booking: {
                          resourceName: "",
                          staffPersonId: "",
                          durationMinutes: 15,
                          travelMinutes: 5,
                          properties: [],
                          columns: {
                            date: 0,
                            time: 1,
                            property: 2,
                            attendees: 3,
                            groupSize: 4,
                            status: 5,
                          },
                        },
                      })
                    }
                  >
                    Configure inspection diary
                  </button>
                )}
                {project.booking && (
                  <>
                    <label className="block">
                      Named diary
                      <select
                        className={field}
                        value={project.booking.resourceName}
                        onChange={(e) =>
                          updateProject({
                            booking: {
                              ...project.booking!,
                              resourceName: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="">Select a diary resource</option>
                        {resources
                          .filter((r) => r.permissions?.includes("append"))
                          .map((r) => (
                            <option key={r.name} value={r.name}>
                              {r.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block">
                      Inspection staff
                      <select
                        className={field}
                        value={project.booking.staffPersonId}
                        onChange={(e) =>
                          updateProject({
                            booking: {
                              ...project.booking!,
                              staffPersonId: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="">Select person</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name || p.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      Properties (one per line)
                      <textarea
                        className={field}
                        value={project.booking.properties.join("\n")}
                        onChange={(e) =>
                          updateProject({
                            booking: {
                              ...project.booking!,
                              properties: e.target.value.split("\n"),
                            },
                          })
                        }
                      />
                    </label>
                    <p>
                      Inspections: {project.booking.durationMinutes} minutes.
                      Travel: {project.booking.travelMinutes} minutes. No
                      attendee cap. Martyn Street preference 16:00; other
                      properties around 15:30, subject to staff and diary
                      availability.
                    </p>
                    <label className="block">
                      Diary column indexes (zero based JSON)
                      <input
                        className={field}
                        defaultValue={JSON.stringify(project.booking.columns)}
                        onBlur={(e) => {
                          try {
                            updateProject({
                              booking: {
                                ...project.booking!,
                                columns: JSON.parse(e.target.value),
                              },
                            });
                          } catch {
                            setError("Column indexes must be valid JSON.");
                          }
                        }}
                      />
                    </label>
                    <label className="block">
                      Staff-confirmed windows (JSON array of date, start, end,
                      properties)
                      <textarea
                        className={field}
                        value={availability}
                        onChange={(e) => setAvailability(e.target.value)}
                      />
                    </label>
                    <button
                      onClick={() => {
                        try {
                          run("confirm_availability", {
                            projectId: selected,
                            confirmed: true,
                            windows: JSON.parse(availability),
                          });
                        } catch {
                          setError("Availability must be valid JSON.");
                        }
                      }}
                    >
                      I confirmed these windows with staff
                    </button>
                  </>
                )}
              </>
            )}
          </fieldset>
          <div className="flex gap-4">
            <button disabled={busy} onClick={() => run("prepare")}>
              Review configuration
            </button>
            <button disabled={busy} onClick={() => run("review_activation")}>
              Review activation
            </button>
          </div>
          {preview && (
            <pre
              className="whitespace-pre-wrap border p-3"
              aria-label="Public preview"
            >
              {JSON.stringify(preview, null, 2)}
            </pre>
          )}
          {review && (
            <div className="border p-4 space-y-3">
              <h3 className="font-semibold">
                {reviewKind === "prepare"
                  ? "Configuration review — saves with reception paused"
                  : "Activation review — enables real inbound effects"}
              </h3>
              <p>Enabled services and actions:</p>
              <pre className="whitespace-pre-wrap">
                {JSON.stringify(
                  { effects: review.effects, checks: review.checks },
                  null,
                  2,
                )}
              </pre>
              <details>
                <summary>Complete reviewed configuration</summary>
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(review.config, null, 2)}
                </pre>
              </details>
              <button
                disabled={busy}
                onClick={() =>
                  run(reviewKind === "prepare" ? "apply" : "activate")
                }
              >
                {reviewKind === "prepare"
                  ? "Apply reviewed configuration"
                  : "Activate reviewed reception"}
              </button>
            </div>
          )}
          <h3 className="font-semibold">SMS operations</h3>
          {snapshot.smsOperations?.map((operation: any) => (
            <article key={operation.communicationId} className="border p-3">
              <p>{operation.communicationId}: {operation.status}</p>
              <p>{operation.result?.reason || operation.error || "Inspect the owning communication receipt before retrying."}</p>
              {operation.result?.responseId && <p>Reply receipt: {operation.result.responseId}</p>}
            </article>
          ))}
          <h3 className="font-semibold">Reception enquiries</h3>
          {snapshot.enquiries.map((e: any) => (
            <article key={e.id} className="border p-3">
              <p>
                {e.name || "Caller"} —{" "}
                {e.projectId
                  ? config.projects.find((p) => p.projectId === e.projectId)
                      ?.label || "Selected service"
                  : "Unassigned"}{" "}
                — {e.status}
              </p>
              <p>{e.request}</p>
              <p>{e.callbackPreference}</p>
              <button
                disabled={busy}
                onClick={() =>
                  run("review_enquiry", {
                    id: e.id,
                    expectedUpdatedAt: e.updatedAt,
                    status: "closed",
                  })
                }
              >
                Mark reviewed and closed
              </button>
            </article>
          ))}
          {snapshot.askOperations
            ?.filter((o: any) => o.kind === "outbound")
            .map((o: any) => (
              <article key={o.id}>
                <p>Unresolved Ask delivery: {o.askId}</p>
                <button
                  disabled={busy}
                  onClick={() => run("reconcile_ask", { id: o.id })}
                >
                  Reconcile owning Ask receipt
                </button>
              </article>
            ))}
          {snapshot.bookingOperations?.map((o: any) => (
            <article key={o.owner}>
              <p>
                Booking operation {o.operationId}: {o.status}
              </p>
              {o.status === "pending" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run("reconcile_booking", { id: "booking_dispatch" })
                  }
                >
                  Reconcile stored diary result
                </button>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
