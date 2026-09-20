import React, { useEffect, useState } from "react";
import { firebaseService } from "../services/firebaseService";
const button =
  "rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
export function OperationalReviewPanel({
  orgId,
  projectId,
}: {
  orgId: string;
  projectId: string;
}) {
  const [session, setSession] = useState<any>(null),
    [answer, setAnswer] = useState(""),
    [instruction, setInstruction] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [work, setWork] = useState<any[]>([]),
    [pending, setPending] = useState<any>(null),
    [date, setDate] = useState(""),
    [actionType, setActionType] = useState("task"),
    [recipient, setRecipient] = useState(""),
    [subject, setSubject] = useState(""),
    [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const storageKey = `owner-review:v1:${orgId}:${projectId}`;
  const call = async (body: Record<string, any>) => {
    const r = await firebaseService.authorizedFetch("/api/commitments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "operational_review",
        projectId,
        ...body,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Review unavailable");
    return data;
  };
  const save = (s: any) => {
    setSession(s);
    if (s?.id) localStorage.setItem(storageKey, s.id);
  };
  useEffect(() => {
    let active = true;
    setSession(null);
    setError("");
    setPending(null);
    setWork([]);
    setPeople([]);
    const id = localStorage.getItem(storageKey);
    if (id)
      call({ operation: "read", session_id: id })
        .then((s) => {
          if (active) save(s);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    firebaseService
      .authorizedFetch("/api/commitments?view=parties")
      .then((r) => r.json())
      .then((r) => {
        if (active)
          setPeople(
            (r.data || []).filter((p: any) => p.id.startsWith("contact:")),
          );
      })
      .catch(() => {});
    call({ operation: "work" })
      .then((r) => {
        if (active) setWork(r.items);
      })
      .catch(() => {});
    const timer = setInterval(() => {
      call({ operation: "work" })
        .then((r) => {
          if (active) setWork(r.items);
        })
        .catch(() => {});
    }, 30000);
    return () => {
      clearInterval(timer);
      active = false;
    };
  }, [orgId, projectId]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review unavailable");
    } finally {
      setBusy(false);
    }
  };
  const respond = (intent: string, details?: Record<string, unknown>) =>
    run(async () => {
      const s = await call({
        operation: "respond",
        session_id: session.id,
        expected_revision: session.revision,
        review_item_id: session.next_item.id,
        request_id: crypto.randomUUID(),
        utterance:
          answer ||
          (
            {
              ACCEPT: "Yes, confirmed",
              REJECT: "No",
              DEFER: "Come back later",
            } as any
          )[intent],
        intent,
        details,
      });
      if (s.requires_clarification) throw new Error(s.question);
      save(s);
      setAnswer("");
    });
  return (
    <section
      aria-label="Owner review"
      className="mb-6 rounded-xl border border-slate-200 bg-white p-5"
    >
      <h2 className="text-lg font-bold">Owner review</h2>
      <p className="text-sm text-slate-600">
        Briefing, questions, then next actions.
      </p>
      {work
        .filter((r) => (r.due || r.type === "task") && r.status === "OPEN")
        .map((r) => (
          <p key={r.id} role="status" className="mt-2 text-amber-800">
            {r.type === "task" ? "Task" : "Reminder"}: {r.title}
          </p>
        ))}
      {error && (
        <p role="alert" className="my-3 text-red-700">
          {error}
        </p>
      )}
      {!session || session.stage === "COMPLETED" ? (
        <button
          className={`${button} mt-3`}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const requestKey = storageKey + ":start";
              let requestId = localStorage.getItem(requestKey);
              if (!requestId) {
                requestId = crypto.randomUUID();
                localStorage.setItem(requestKey, requestId);
              }
              save(await call({ operation: "start", request_id: requestId }));
              localStorage.removeItem(requestKey);
            })
          }
        >
          Start review
        </button>
      ) : (
        <>
          <p className="my-4 whitespace-pre-wrap">{session.prompt}</p>
          <p className="mb-3 text-sm text-slate-500">
            {
              session.review_queue.filter((q: any) => q.status === "PENDING")
                .length
            }{" "}
            questions remaining
          </p>
          {session.stage === "REVIEW" && session.next_item && (
            <>
              {session.next_item.proposal?.evidence?.quote && (
                <blockquote className="mb-3 border-l-2 pl-3 text-slate-600">
                  {session.next_item.proposal.evidence.quote}
                </blockquote>
              )}
              <label className="block text-sm">
                Your answer
                <input
                  className={`${button} my-2 block w-full`}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => respond("ACCEPT")}
                >
                  Confirm
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => respond("REJECT")}
                >
                  Reject
                </button>
                <button
                  className={button}
                  disabled={busy || !answer}
                  onClick={() => respond("PARTIAL")}
                >
                  Partly complete
                </button>
                <button
                  className={button}
                  disabled={busy || !answer || !session.next_item.promise_id}
                  onClick={() =>
                    respond("CORRECT", { patch: { description: answer } })
                  }
                >
                  Use answer as corrected description
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => respond("DEFER")}
                >
                  Come back later
                </button>
              </div>
              <label className="mt-3 block text-sm">
                Ask again at{" "}
                <input
                  type="datetime-local"
                  className={button}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <button
                className={`${button} mt-2`}
                disabled={busy || !date || !answer}
                onClick={() =>
                  respond("SNOOZE", {
                    snoozed_until: new Date(date).toISOString(),
                  })
                }
              >
                Snooze
              </button>
            </>
          )}
          {session.stage === "NEXT_ACTIONS" && (
            <>
              <label className="block text-sm">
                New instruction
                <textarea
                  className={`${button} my-2 block w-full`}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
              </label>
              <button
                className={button}
                disabled={busy || !instruction.trim()}
                onClick={() =>
                  run(async () => {
                    setPending(
                      await call({
                        operation: "action",
                        session_id: session.id,
                        request_id: crypto.randomUUID(),
                        instruction,
                      }),
                    );
                    save(
                      await call({ operation: "read", session_id: session.id }),
                    );
                  })
                }
              >
                Add instruction
              </button>
              {pending?.status === "NEEDS_CLARIFICATION" && (
                <div className="my-3 space-y-2">
                  <label className="block text-sm">
                    Action{" "}
                    <select
                      className={button}
                      value={actionType}
                      onChange={(e) => setActionType(e.target.value)}
                    >
                      <option value="task">Task</option>
                      <option value="reminder">Reminder here</option>
                      <option value="email">Email</option>
                    </select>
                  </label>
                  {actionType === "reminder" && (
                    <label className="block text-sm">
                      When{" "}
                      <input
                        type="datetime-local"
                        className={button}
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                  )}
                  {actionType === "email" && (
                    <>
                      <label className="block text-sm">
                        Recipient{" "}
                        <select
                          className={button}
                          value={recipient}
                          onChange={(e) => setRecipient(e.target.value)}
                        >
                          <option value="">Choose a person</option>
                          {people.map((p) => (
                            <option key={p.id} value={p.id.slice(8)}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm">
                        Subject{" "}
                        <input
                          className={button}
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                        />
                      </label>
                      <p className="text-sm">
                        The instruction above will be the email body. Confirm it
                        before sending.
                      </p>
                    </>
                  )}
                  <button
                    className={button}
                    disabled={
                      busy ||
                      !projectId ||
                      (actionType === "reminder" && !date) ||
                      (actionType === "email" && (!recipient || !subject))
                    }
                    onClick={() =>
                      run(async () => {
                        const parameters =
                          actionType === "task"
                            ? { title: instruction }
                            : actionType === "reminder"
                              ? {
                                  text: instruction,
                                  scheduled_at: new Date(date).toISOString(),
                                }
                              : {
                                  recipient_person_id: recipient,
                                  subject,
                                  body: instruction,
                                };
                        setPending(
                          await call({
                            operation: "action",
                            session_id: session.id,
                            request_id: crypto.randomUUID(),
                            replaces_action_id: pending.id,
                            instruction,
                            authorized: true,
                            proposal: {
                              version: "review-action.v1",
                              type: actionType,
                              project_id: projectId,
                              timezone:
                                Intl.DateTimeFormat().resolvedOptions()
                                  .timeZone,
                              parameters,
                            },
                          }),
                        );
                        save(
                          await call({
                            operation: "read",
                            session_id: session.id,
                          }),
                        );
                      })
                    }
                  >
                    Confirm action
                  </button>
                </div>
              )}
              {pending && (
                <p className="mt-2 text-sm">
                  {pending.status === "NEEDS_CLARIFICATION"
                    ? "This instruction needs an action type and resolved details before it can run."
                    : pending.status}
                </p>
              )}
            </>
          )}
          {session.stage !== "REVIEW" && (
            <button
              className={`${button} mt-3`}
              disabled={busy}
              onClick={() =>
                run(async () =>
                  save(
                    await call({
                      operation: "advance",
                      session_id: session.id,
                      expected_revision: session.revision,
                    }),
                  ),
                )
              }
            >
              {session.stage === "BRIEFING"
                ? "Begin questions"
                : session.stage === "NEXT_ACTIONS"
                  ? "Finish instructions"
                  : "Save and close"}
            </button>
          )}
          <button
            className={`${button} ml-2 mt-3`}
            disabled={busy}
            onClick={() =>
              run(async () =>
                save(await call({ operation: "read", session_id: session.id })),
              )
            }
          >
            Refresh review
          </button>
          {(session.action_results || []).map((a: any) => (
            <p key={a.id} className="mt-2 text-sm">
              {a.instruction}: {a.status.toLowerCase().replaceAll("_", " ")}{" "}
              {a.result?.summary || ""}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
