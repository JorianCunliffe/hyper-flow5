import { useProjectScope, useScopedProject, ProjectDirectory } from './ProjectScope';
import React, { useEffect, useState } from "react";
import { firebaseService } from "../services/firebaseService";
const field =
  "rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900";
const button =
  "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40";
export function PublishingPanel() {
  const scope = useProjectScope();
  const [projectId, setProject] = useScopedProject(new URLSearchParams(window.location.search).get('project') || '');
  const [projects, setProjects] = useState<any[]>([]),
    [data, setData] = useState<any>({ items: [], targets: [], adapters: [] }),
    [item, setItem] = useState<any>(null),
    [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [notes, setNotes] = useState(""),
    [kind, setKind] = useState("social"),
    [targetId, setTarget] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function request(body?: any, id?: string) {
    const q = new URLSearchParams({
      ...(projectId ? { projectId } : {}),
      ...(id ? { id } : {}),
    });
    const r = await firebaseService.authorizedFetch(
      "/api/publishing?" + q,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, ...body }),
          }
        : {},
    );
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || "Publishing request failed");
    return value;
  }
  function select(p: any) {
    setItem(p);
    setTitle(p.content.title);
    setText(p.content.text);
    setNotes(p.sourceNotes);
    setKind(p.kind);
    setChecked(false);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function action(operation: string, extra: any = {}) {
    await run(async () => {
      const r = await request({
        operation,
        id: item.id,
        revision: item.revision,
        contentHash: item.contentHash,
        ...extra,
      });
      select(r.item);
      setData(await request());
    });
  }
  useEffect(() => {
    let live = true;
    firebaseService
      .authorizedFetch("/api/publishing")
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load permitted projects");
        return r.json();
      })
      .then((r) => {
        if (live) setProjects(r.projects || []);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setItem(null);
    setTitle("");
    setText("");
    setNotes("");
    setTarget("");
    setChecked(false);
    setData({ items: [], targets: [], adapters: [] });
    if (projectId)
      request()
        .then((r) => {
          if (live) setData(r);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [projectId]);
  const dirty =
    !!item &&
    (title !== item.content.title ||
      text !== item.content.text ||
      notes !== item.sourceNotes);
  const editable =
    !item ||
    ["draft", "rejected", "awaiting_approval", "approved"].includes(item.state);
  return (
    <section className="overflow-auto p-6 space-y-5 bg-slate-50 text-slate-900">
      <h1 className="text-2xl font-bold">Publishing</h1>
      <p>
        Write a social update or website change, inspect its exact version, then
        obtain public-use approval before publication. Source notes remain
        internal.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {scope ? <ProjectDirectory purpose="Select a project to create and review its documents and publishing work." /> : <>
      <label>
        Project{" "}
        <select
          className={field}
          value={projectId}
          disabled={busy}
          onChange={(e) => setProject(e.target.value)}
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
      {projectId && (
        <>
          <p className="rounded border border-slate-300 p-3">
            {data.adapters.length
              ? "Publication needs a configured target and its own approval."
              : "No publishing provider is configured. Drafts can be prepared here; provider selection, connection and target permission are required before publication."}
          </p>
          <div className="flex flex-wrap gap-3">
            <label>
              Content type{" "}
              <select
                className={field}
                value={kind}
                disabled={busy || !!item}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="social">Social update</option>
                <option value="website">Website change</option>
              </select>
            </label>
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                setItem(null);
                setTitle("");
                setText("");
                setNotes("");
                setChecked(false);
              }}
            >
              New draft
            </button>
          </div>
          <label className="block">
            Title
            <input
              className={field + " block w-full"}
              maxLength={160}
              value={title}
              disabled={busy || !editable}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block">
            Proposed public text
            <textarea
              className={field + " block w-full"}
              rows={8}
              maxLength={12000}
              value={text}
              disabled={busy || !editable}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label className="block">
            Internal source notes and public-use restrictions
            <textarea
              className={field + " block w-full"}
              rows={3}
              maxLength={4000}
              value={notes}
              disabled={busy || !editable}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <p className="text-sm text-slate-600">
            This screen does not automatically import private communications or
            project-only brand assets into public content. Review rights and
            confidential information before approval. Text previews display
            literal content; website formatting depends on the selected adapter.
          </p>
          <button
            className={button}
            disabled={busy || !editable || !text.trim() || !notes.trim()}
            onClick={() =>
              item
                ? action("edit", {
                    content: { title, text },
                    sourceNotes: notes,
                  })
                : run(async () => {
                    const r = await request({
                      operation: "create",
                      requestId: crypto.randomUUID(),
                      kind,
                      content: { title, text },
                      sourceNotes: notes,
                    });
                    select(r.item);
                    setData(await request());
                  })
            }
          >
            {item ? "Save a new version" : "Save draft"}
          </button>
          <nav aria-label="Publication drafts" className="flex flex-wrap gap-2">
            {data.items.map((p: any) => (
              <button
                key={p.id}
                className={button}
                disabled={busy}
                onClick={() =>
                  run(async () => select((await request(undefined, p.id)).item))
                }
              >
                {p.title || "Untitled update"} · {p.state}
              </button>
            ))}
          </nav>
          {item && (
            <article className="border rounded-lg p-4 space-y-3">
              <h2 className="text-xl font-semibold">Review and publication</h2>
              <button
                className={button}
                disabled={busy || dirty}
                onClick={() =>
                  run(async () => {
                    const r = await request({
                      operation: "draft_flow",
                      id: item.id,
                      revision: item.revision,
                      contentHash: item.contentHash,
                    });
                    location.href = `/?view=flows&flow=${encodeURIComponent(r.item.id)}`;
                  })
                }
              >
                Create visible review flow
              </button>
              <ol className="list-decimal pl-5">
                <li>Save versioned content and internal source notes</li>
                <li>
                  Read the configured target and inspect before/after text
                </li>
                <li>Answer the public-content approval Ask</li>
                <li>Publish the exact approved version</li>
                <li>Read the provider result and verify its content</li>
              </ol>
              <p>
                Status: {item.state}. Content version: {item.revision}.
              </p>
              <p className="text-sm">
                Saving, approving or publishing content does not automatically
                fulfill an operational promise.
              </p>
              {editable && (
                <>
                  <label>
                    Publication target{" "}
                    <select
                      className={field}
                      value={targetId}
                      disabled={busy}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Choose a configured target</option>
                      {data.targets
                        .filter((t: any) => t.enabled && t.kind === item.kind)
                        .map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    className={button}
                    disabled={
                      busy ||
                      !targetId ||
                      text !== item.content.text ||
                      title !== item.content.title ||
                      notes !== item.sourceNotes
                    }
                    onClick={() => action("preview", { targetId })}
                  >
                    Prepare exact preview
                  </button>
                </>
              )}
              {item.target && (
                <>
                  <p>
                    Target: {item.target.label}. Grant version:{" "}
                    {item.target.revision}.
                  </p>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <h3 className="font-semibold">Before</h3>
                      <pre className="whitespace-pre-wrap break-words text-sm">
                        {item.baseline
                          ? item.baseline.content.title +
                            "\n" +
                            item.baseline.content.text
                          : "New publication"}
                      </pre>
                    </div>
                    <div>
                      <h3 className="font-semibold">Proposed public version</h3>
                      <pre className="whitespace-pre-wrap break-words text-sm">
                        {item.content.title + "\n" + item.content.text}
                      </pre>
                    </div>
                  </div>
                  <p className="text-xs break-all">
                    Content fingerprint: {item.contentHash}
                  </p>
                </>
              )}
              {item.state === "awaiting_approval" && (
                <>
                  <p>
                    The administrator who granted this target must answer this
                    Ask.
                  </p>
                  <label className="block">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                    />{" "}
                    I checked this exact content and its sources and confirm it
                    is permitted for public use.
                  </label>
                  <button
                    className={button}
                    disabled={busy || dirty || !checked}
                    onClick={() =>
                      action("approve", { publicUseChecked: true })
                    }
                  >
                    Approve exact public content
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => action("reject")}
                  >
                    Reject public content
                  </button>
                </>
              )}
              {item.state === "approved" && (
                <button
                  className={button}
                  disabled={busy || dirty}
                  onClick={() => action("publish")}
                >
                  Publish approved version
                </button>
              )}
              {["dispatching", "uncertain", "verified"].includes(
                item.state,
              ) && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => action("reconcile")}
                >
                  Verify provider result
                </button>
              )}
              {item.error && <p role="status">{item.error}</p>}
              {item.receipt && (
                <p>
                  Last verified result:{" "}
                  <a
                    className="underline"
                    href={item.receipt.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.receipt.id}
                  </a>
                  . Current status: {item.state}.
                </p>
              )}
              <p className="text-sm">
                Uncertain operations are held for read-only reconciliation.
                Existing provider edits are not overwritten. Automatic rollback
                is not available; prepare a separately approved change if the
                selected provider supports it.
              </p>
              {!!item.history?.length && (
                <details>
                  <summary>Previous content and approvals</summary>
                  {item.history.map((h: any) => (
                    <div key={h.revision} className="border-t py-3">
                      <p>
                        Version {h.revision}; Ask{" "}
                        {h.ask?.status || "not raised"}.
                      </p>
                      <pre className="whitespace-pre-wrap break-words">
                        {h.content.title + "\n" + h.content.text}
                      </pre>
                    </div>
                  ))}
                </details>
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}
