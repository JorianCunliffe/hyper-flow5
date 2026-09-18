import { useProjectScope, useScopedProject, ProjectDirectory } from './ProjectScope';
import React, { useEffect, useState } from "react";
import { firebaseService } from "../services/firebaseService";
import type { ArtifactJob, ArtifactTemplate } from "../lib/artifacts/model";
const field =
  "rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900";
const button =
  "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40";
export function ArtifactsPanel() {
  const scope = useProjectScope();
  const [projectId, setProjectId] = useScopedProject(new URLSearchParams(window.location.search).get('project') || '');
  const [projects, setProjects] = useState<any[]>([]),
    [data, setData] = useState<any>({ items: [], templates: [] }),
    [selected, setSelected] = useState<any>(null),
    [template, setTemplate] = useState("weekly-docx@1"),
    [start, setStart] = useState(
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    ),
    [cutoff, setCutoff] = useState(new Date().toISOString().slice(0, 10)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [checked, setChecked] = useState(false),
    [notice, setNotice] = useState(""),
    [connectionId, setConnectionId] = useState(""),
    [resources, setResources] = useState<any[]>([]),
    [spreadsheetId, setSpreadsheetId] = useState("");
  async function request(body?: any, query = "") {
    const r = await firebaseService.authorizedFetch(
      "/api/artifacts?" +
        new URLSearchParams({
          shape: "summary",
          ...(projectId ? { projectId } : {}),
          ...Object.fromEntries(new URLSearchParams(query)),
        }),
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, ...body }),
          }
        : {},
    );
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || "Artifact request failed");
    return value;
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
  useEffect(() => {
    let live = true;
    firebaseService
      .authorizedFetch("/api/artifacts")
      .then((r) => {
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
    setSelected(null);
    setChecked(false);
    if (!projectId) return;
    let live = true;
    request()
      .then((r) => {
        if (live) setData(r);
        const params = new URLSearchParams(window.location.search),
          id = params.get("artifact");
        if (live && id && params.get("project") === projectId)
          request(undefined, "id=" + encodeURIComponent(id))
            .then((value) => {
              if (live) setSelected(value);
            })
            .catch((e) => {
              if (live) setError(e.message);
            });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [projectId]);
  async function open(id: string) {
    setChecked(false);
    setSelected(await request(undefined, "id=" + id));
  }
  async function mutate(operation: string) {
    const j: ArtifactJob = selected.item;
    await request({
      operation,
      id: j.id,
      revision: j.revision,
      inputHash: j.inputHash,
      ...(operation === "review"
        ? {
            fileHash: j.receipt?.sha256,
            visualChecked: checked,
            contentChecked: checked,
          }
        : {}),
    });
    setData(await request());
    await open(j.id);
  }
  async function download() {
    const r = await request(
        undefined,
        `id=${selected.item.id}&operation=download`,
      ),
      f = r.download;
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="mx-auto max-w-6xl space-y-5 p-6">
      <h1 className="text-2xl font-bold">Office outputs</h1>
      {notice && (
        <p role="status">
          {notice}{" "}
          <a className="underline" href="/?view=flows">
            Open Flows to inspect and approve it
          </a>
        </p>
      )}
      <p>
        Prepare a weekly report, slides or workbook from reviewed project work
        and communication evidence. Inspect each step and file before using it.
      </p>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {scope ? <ProjectDirectory purpose="Select a project to create and review its documents and publishing work." /> : <>
      <label className="block">
        Project{" "}
        <select
          aria-label="Project"
          disabled={busy}
          className={field}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
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
          <div className="flex flex-wrap gap-4">
            <label>
              Template{" "}
              <select
                aria-label="Template"
                className={field}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
              >
                {(data.templates || []).map((t: ArtifactTemplate) => (
                  <option
                    key={`${t.id}@${t.version}`}
                    value={`${t.id}@${t.version}`}
                  >
                    {t.name} · version {t.version}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Period starts UTC{" "}
              <input
                className={field}
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Cutoff UTC exclusive{" "}
              <input
                className={field}
                type="date"
                value={cutoff}
                onChange={(e) => setCutoff(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              className={button}
              onClick={() =>
                run(async () => {
                  const [templateId, v] = template.split("@");
                  const r = await request({
                    operation: "prepare",
                    requestId: crypto.randomUUID(),
                    templateId,
                    templateVersion: Number(v),
                    periodStart: start + "T00:00:00Z",
                    cutoff: cutoff + "T00:00:00Z",
                  });
                  setData(await request());
                  await open(r.item.id);
                })
              }
            >
              Prepare input preview
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const [templateId, v] = template.split("@");
                  await request({
                    operation: "create_flow",
                    templateId,
                    templateVersion: Number(v),
                  });
                  setNotice(
                    "Weekly report flow created with its approval still open.",
                  );
                })
              }
            >
              Create weekly report flow
            </button>
          </div>
          <p className="text-sm text-slate-600">
            Dates select the deadline period. Work states reflect when the
            records are read. All outputs initially remain private to this
            project.
          </p>
          <details>
            <summary>Google report spreadsheet</summary>
            <p>
              Grant creation of a new tab for each reviewed report. This is
              separate from existing project range grants. Export never
              overwrites an existing tab.
            </p>
            <label>
              Connected account{" "}
              <select
                className={field}
                value={connectionId}
                onChange={(e) => {
                  setConnectionId(e.target.value);
                  setResources([]);
                  setSpreadsheetId("");
                }}
              >
                <option value="">Choose an account</option>
                {(data.connections || []).map((c: any) => (
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
                run(async () =>
                  setResources(
                    (
                      await request(
                        undefined,
                        "operation=sheet_resources&connectionId=" +
                          encodeURIComponent(connectionId),
                      )
                    ).resources,
                  ),
                )
              }
            >
              Load editable spreadsheets
            </button>
            <label>
              Spreadsheet{" "}
              <select
                className={field}
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
              >
                <option value="">Choose a spreadsheet</option>
                {resources
                  .filter((r) => r.canEdit)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className={button}
              disabled={busy || !spreadsheetId}
              onClick={() =>
                run(async () => {
                  await request({
                    operation: "configure_sheet",
                    revision: data.registryRevision,
                    connectionId,
                    spreadsheetId,
                    enabled: true,
                    allowNewTabs: true,
                  });
                  setData(await request());
                })
              }
            >
              Allow reviewed reports to create new tabs
            </button>
            {data.sheetTarget && (
              <p>
                {data.sheetTarget.name}:{" "}
                {data.sheetTarget.enabled ? "enabled" : "disabled"}{" "}
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await request({
                        operation: "configure_sheet",
                        revision: data.registryRevision,
                        enabled: false,
                      });
                      setData(await request());
                    })
                  }
                >
                  Disable new exports
                </button>
              </p>
            )}
          </details>
          <details>
            <summary>Register a document template and brand</summary>
            <form
              className="mt-3 flex flex-wrap gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void run(async () => {
                  const logo = form.get("logo") as File;
                  let encoded: string | undefined;
                  if (logo?.size) {
                    if (logo.size > 130000)
                      throw new Error("PNG logo must be smaller than 130 KB");
                    encoded = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () =>
                        resolve(String(reader.result).split(",")[1]);
                      reader.onerror = reject;
                      reader.readAsDataURL(logo);
                    });
                  }
                  await request({
                    operation: "save_template",
                    revision: data.registryRevision,
                    template: {
                      id: form.get("id"),
                      name: form.get("name"),
                      format: form.get("format"),
                      brand: {
                        name: form.get("brand"),
                        accent: String(form.get("colour")).replace("#", ""),
                        font: form.get("font"),
                        ...(encoded ? { logo: { base64: encoded } } : {}),
                      },
                    },
                  });
                  setData(await request());
                });
              }}
            >
              <label>
                Template identity{" "}
                <input
                  name="id"
                  required
                  pattern="[a-z][a-z0-9-]{2,60}"
                  className={field}
                />
              </label>
              <label>
                Name{" "}
                <input name="name" required maxLength={100} className={field} />
              </label>
              <label>
                Format{" "}
                <select name="format" className={field}>
                  <option>docx</option>
                  <option>pptx</option>
                  <option>xlsx</option>
                </select>
              </label>
              <label>
                Brand name{" "}
                <input name="brand" required maxLength={80} className={field} />
              </label>
              <label>
                Accent{" "}
                <input type="color" name="colour" defaultValue="#234e70" />
              </label>
              <label>
                Font{" "}
                <select name="font" className={field}>
                  <option>Arial</option>
                  <option>Calibri</option>
                </select>
              </label>
              <label>
                PNG logo <input name="logo" type="file" accept="image/png" />
              </label>
              <button className={button} disabled={busy}>
                Save new template version
              </button>
              <p className="w-full text-sm">
                Administrator registration permits this brand for internal
                project reports. Every version retains the overview, accepted
                work, evidence and source notes. It does not grant public
                publishing rights.
              </p>
            </form>
          </details>
          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <nav aria-label="Artifact jobs" className="space-y-2">
              {(data.items || []).map((j: ArtifactJob) => (
                <button
                  key={j.id}
                  className={button + " block w-full text-left"}
                  onClick={() => run(() => open(j.id))}
                >
                  {j.template.name}
                  <br />
                  {j.status} · {new Date(j.createdAt).toLocaleString()}
                </button>
              ))}
              {data.next && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const page = await request(
                        undefined,
                        "after=" + encodeURIComponent(data.next),
                      );
                      setData((old: any) => ({
                        ...page,
                        items: [
                          ...old.items,
                          ...page.items.filter(
                            (row: any) =>
                              !old.items.some((i: any) => i.id === row.id),
                          ),
                        ],
                      }));
                    })
                  }
                >
                  Load more report jobs
                </button>
              )}
            </nav>
            {selected && (
              <article className="space-y-4 rounded-xl border bg-white p-5">
                <h2 className="text-xl font-bold">
                  {selected.item.template.name}
                </h2>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Read accepted work and permitted source context</li>
                  <li>Freeze the report period, input versions and template</li>
                  <li>Review and approve these inputs</li>
                  <li>Generate the file and retain its fingerprint</li>
                  <li>Inspect the file and answer the output review Ask</li>
                </ol>
                <p>Status: {selected.item.status}. Delivery: none.</p>
                {selected.item.error && (
                  <p role="alert">{selected.item.error}</p>
                )}
                {selected.preview?.map((s: any) => (
                  <section key={s.title}>
                    <h3 className="font-bold">{s.title}</h3>
                    {s.paragraphs.map((p: string, i: number) => (
                      <p
                        key={i}
                        className="my-2 whitespace-pre-wrap break-words text-sm"
                      >
                        {p}
                      </p>
                    ))}
                  </section>
                ))}
                {selected.item.status === "proposed" && (
                  <div className="flex gap-3">
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => run(() => mutate("approve"))}
                    >
                      Approve exact inputs
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => run(() => mutate("reject"))}
                    >
                      Reject inputs
                    </button>
                  </div>
                )}
                {selected.item.status === "approved" && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => run(() => mutate("generate"))}
                  >
                    Generate draft file
                  </button>
                )}
                {["building", "failed"].includes(selected.item.status) && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => run(() => mutate("reconcile"))}
                  >
                    Check for a saved file
                  </button>
                )}
                {selected.item.receipt && (
                  <>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => run(download)}
                    >
                      Download {selected.item.receipt.format.toUpperCase()} for
                      review
                    </button>
                    <p className="break-all text-xs">
                      File fingerprint {selected.item.receipt.sha256}
                    </p>
                    <p>
                      Structure: {selected.item.receipt.structure}. Visual
                      review: {selected.item.receipt.visual}.
                    </p>
                  </>
                )}
                {selected.item.status === "reviewed" && (
                  <div className="space-y-3">
                    <h3 className="font-bold">Optional handoff</h3>
                    {!selected.item.sheetExport && (
                      <button
                        className={button}
                        disabled={busy || !data.sheetTarget?.enabled}
                        onClick={() => run(() => mutate("propose_sheet"))}
                      >
                        Propose export to{" "}
                        {data.sheetTarget?.name || "a configured spreadsheet"}
                      </button>
                    )}
                    {selected.item.sheetExport && (
                      <div>
                        <p>{selected.item.sheetExport.ask.prompt}</p>
                        <p>Export: {selected.item.sheetExport.status}</p>
                        {selected.item.sheetExport.error && (
                          <p role="alert">{selected.item.sheetExport.error}</p>
                        )}
                        {selected.item.sheetExport.status === "proposed" && (
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() => run(() => mutate("approve_sheet"))}
                          >
                            Approve this spreadsheet export
                          </button>
                        )}
                        {selected.item.sheetExport.status === "approved" && (
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() => run(() => mutate("export_sheet"))}
                          >
                            Create and verify the report tab
                          </button>
                        )}
                        {["running", "uncertain", "verified"].includes(
                          selected.item.sheetExport.status,
                        ) && (
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() => run(() => mutate("reconcile_sheet"))}
                          >
                            Verify the existing export
                          </button>
                        )}
                        {selected.item.sheetExport.receipt?.url && (
                          <a
                            className="ml-3 underline"
                            href={selected.item.sheetExport.receipt.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open report tab
                          </a>
                        )}
                      </div>
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        void run(async () => {
                          await request({
                            operation: "draft_flow",
                            id: selected.item.id,
                            to: form.get("to"),
                          });
                          setNotice(
                            "Email draft flow created for approval. Attach the reviewed file manually before sending; the draft flow sends nothing.",
                          );
                        });
                      }}
                    >
                      <label>
                        Email recipient{" "}
                        <input
                          name="to"
                          type="email"
                          required
                          className={field}
                        />
                      </label>
                      <button className={button} disabled={busy}>
                        Create email draft flow
                      </button>
                    </form>
                  </div>
                )}
                {selected.item.status === "generated" && (
                  <>
                    <label className="block">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />{" "}
                      I opened this file and checked its content, source
                      references, formulas and layout.
                    </label>
                    <button
                      className={button}
                      disabled={busy || !checked}
                      onClick={() => run(() => mutate("review"))}
                    >
                      Approve reviewed file for use
                    </button>
                  </>
                )}
              </article>
            )}
          </div>
        </>
      )}
    </section>
  );
}
