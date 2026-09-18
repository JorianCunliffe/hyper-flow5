import { useProjectScope } from './ProjectScope';
import React, { useEffect, useState } from "react";
import type { Project } from "../types";
import type {
  MeetingInput,
  MeetingRecord,
  MeetingTopic,
} from "../lib/communications/meetingTypes";
import type { CommitmentSource } from "../lib/commitments/model";
import { firebaseService } from "../services/firebaseService";
const field =
  "w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900";
const button =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40";
const blank = (): MeetingInput => ({
  source: "generic",
  externalId: "",
  sourceVersion: "1",
  title: "",
  occurredAt: "",
  attendees: [],
  topics: [{ id: "topic-1", title: "", projectId: "", segments: [] }],
});
async function api(url: string, body?: unknown) {
  const response = await firebaseService.authorizedFetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "Meeting request failed"), {
      details: result.details,
    });
  return result;
}
export const MeetingsPanel: React.FC<{
  orgId: string;
  projects: Project[];
  onOpenObligations: () => void;
}> = ({ orgId, projects, onOpenObligations }) => {
  const scope = useProjectScope();
  const inContext = (row: MeetingRecord) => !scope?.projectId || row.metadata.topics.some(topic => topic.projectId === scope.projectId);
  const newDraft = () => { const draft = blank(); if (scope?.projectId) draft.topics[0].projectId = scope.projectId; return draft; };
  const [rows, setRows] = useState<MeetingRecord[]>([]),
    [next, setNext] = useState<number | null>(null),
    [selected, setSelected] = useState<MeetingRecord | null>(null);
  const [draft, setDraft] = useState<MeetingInput>(newDraft),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [duplicate, setDuplicate] = useState(false);
  const [candidates, setCandidates] = useState<
    Array<CommitmentSource & { projectId: string }>
  >([]);
  const load = async (offset = 0) => {
    const result = await api(`/api/meetings?offset=${offset}`);
    setRows((old) => (offset ? [...old, ...result.data] : result.data));
    setNext(result.next);
  };
  useEffect(() => {
    let active = true;
    setBusy(true);
    setRows([]);
    setSelected(null);
    setDraft(newDraft());
    setError("");
    setCandidates([]);
    api("/api/meetings")
      .then((result) => {
        if (active) {
          setRows(result.data);
          setNext(result.next);
        }
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
  }, [orgId]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
      setDuplicate(e.details?.status === "needs_duplicate_review");
    } finally {
      setBusy(false);
    }
  };
  const choose = (row: MeetingRecord | null) => {
    setSelected(row);
    setDraft(
      row
        ? { ...row.metadata, expectedVersion: row.metadata.version }
        : blank(),
    );
    setCandidates([]);
    setDuplicate(false);
    setMessage("");
  };
  const save = (separate = false) =>
    run(async () => {
      const result = await api("/api/meetings", {
        ...draft,
        duplicateDecision: separate ? "separate" : null,
      });
      choose(result.item);
      await load();
      setMessage(
        result.receipt.duplicate
          ? "This source revision was already imported. No duplicate evidence was created."
          : "Meeting saved in Communications. Action evidence may take time to enrich.",
      );
    });
  const changeTopic = (index: number, patch: Partial<MeetingTopic>) =>
    setDraft({
      ...draft,
      topics: draft.topics.map((topic, i) =>
        i === index ? { ...topic, ...patch } : topic,
      ),
    });
  const setTranscript = (index: number, text: string) =>
    changeTopic(index, {
      segments: text
        .split("\n")
        .filter((line) => line.trim())
        .map((line, i) => {
          const match = /^([^:]{1,100}):\s*(.*)$/.exec(line);
          const speaker = match?.[1].trim() || "Unknown speaker";
          const person = draft.attendees.find(
            (p) => p.name.toLowerCase() === speaker.toLowerCase(),
          );
          return {
            id: `line-${i + 1}`,
            speakerId: person?.id || null,
            speaker,
            text: match ? match[2] : line,
          };
        }),
    });
  const readFile = (file?: File) =>
    run(async () => {
      if (!file) return;
      if (file.size > 1_000_000)
        throw new Error("Choose a transcript smaller than 1 MB.");
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text);
        if (
          !Array.isArray(parsed.topics) ||
          !parsed.topics.length ||
          parsed.topics.length > 20 ||
          !Array.isArray(parsed.attendees) ||
          parsed.attendees.length > 100 ||
          parsed.attendees.some(
            (p: any) => typeof p?.id !== "string" || typeof p.name !== "string",
          ) ||
          parsed.topics.some(
            (t: any) =>
              typeof t?.id !== "string" ||
              typeof t.title !== "string" ||
              typeof t.projectId !== "string" ||
              !Array.isArray(t.segments) ||
              t.segments.length > 1000 ||
              t.segments.some((s: any) => typeof s?.text !== "string"),
          ) ||
          ["source", "externalId", "sourceVersion", "title", "occurredAt"].some(
            (key) => typeof parsed[key] !== "string",
          )
        )
          throw new Error(
            "Choose a valid meeting file with source details, attendees and transcript topics.",
          );
        setSelected(null);
        setDraft(parsed);
        setMessage("File loaded for review. Nothing has been imported yet.");
      } else {
        setTranscript(0, text);
        setMessage(
          "Transcript loaded into the first topic. Split unrelated matters before importing.",
        );
      }
    });
  return (
    <section
      className="h-full overflow-auto bg-slate-50 p-4 md:p-8"
      aria-label="Transcribed meetings"
    >
      <h1 className="text-2xl font-bold">Meetings and action evidence</h1>
      <p className="my-2 text-sm text-slate-600">
        Import notes that are already transcribed. Keep separate matters in
        separate topics. Contact matches identify attendees; they do not prove
        who spoke.
      </p>
      <div className="my-4 flex gap-2">
        <button
          className={button}
          disabled={busy}
          onClick={() => run(() => load())}
        >
          Refresh meetings
        </button>
        <button className={button} disabled={busy} onClick={() => choose(null)}>
          New meeting
        </button>
        <button className={button} onClick={onOpenObligations}>
          Open obligations
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mb-3 rounded-lg bg-indigo-50 p-3">
          {message}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          {!rows.filter(inContext).length && !busy && <p>No meetings in this permitted page.</p>}
          {rows.filter(inContext).map((row) => (
            <button
              key={row.id}
              className="mb-3 w-full rounded-xl border bg-white p-4 text-left"
              onClick={() =>
                run(async () => {
                  const result = await api(
                    `/api/meetings?id=${encodeURIComponent(row.id)}`,
                  );
                  choose(result.item);
                })
              }
            >
              <strong className="block">{row.title}</strong>
              <span className="text-sm">
                {new Date(row.recorded_at).toLocaleString()} · Revision{" "}
                {row.metadata.version} · {row.metadata.topics.length} topics
              </span>
            </button>
          ))}
          {next !== null && (
            <button
              className={button}
              disabled={busy}
              onClick={() => run(() => load(next))}
            >
              Load more meetings
            </button>
          )}
          {selected && (
            <div className="rounded-xl border bg-white p-4">
              <h2 className="font-bold">Attendee identity evidence</h2>
              {selected.metadata.attendees.map((person) => (
                <div key={person.id} className="my-2 text-sm">
                  <p>
                    {person.name}:{" "}
                    {person.identityStatus === "matched_exact"
                      ? "Matched an existing contact identity"
                      : "Unresolved — no identity assumption"}
                  </p>
                  {person.contact && (
                    <p>
                      {[
                        person.contact.name,
                        person.contact.email,
                        person.contact.phone_number,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              ))}
              <p className="text-sm">
                Source speaker attribution remains a claim, including for
                matched contacts.
              </p>
              <button
                className={`${button} mt-3`}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const found = [];
                    for (const topic of selected.metadata.topics) {
                      const result = await api(
                        `/api/commitments?view=candidates&projectId=${encodeURIComponent(topic.projectId)}&threadId=${encodeURIComponent(topic.threadId || "")}`,
                      );
                      found.push(
                        ...result.data
                          .filter((row: CommitmentSource) =>
                            row.communicationIds.includes(
                              topic.communicationId || "",
                            ),
                          )
                          .map((row: CommitmentSource) => ({
                            ...row,
                            projectId: topic.projectId,
                          })),
                      );
                    }
                    setCandidates(found);
                    if (!found.length)
                      setMessage(
                        "No current promise evidence is available yet. Enrichment may be pending; nothing has been accepted.",
                      );
                  })
                }
              >
                Find proposed actions
              </button>
              {candidates.map((candidate) => (
                <div key={candidate.id} className="mt-3 border-t pt-3">
                  <blockquote>{candidate.wording}</blockquote>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api("/api/commitments", {
                          projectId: candidate.projectId,
                          threadId: candidate.threadId,
                          sourceId: candidate.id,
                        });
                        setMessage(
                          "Action is a review candidate. Open Obligations to clarify and accept it.",
                        );
                      })
                    }
                  >
                    Create action for review
                  </button>
                </div>
              ))}
              <details className="mt-3">
                <summary>Source revision history</summary>
                {selected.history?.map((h) => (
                  <p key={h.version} className="text-sm">
                    Revision {h.version} · source {h.source_version} ·{" "}
                    {new Date(h.created_at).toLocaleString()}
                  </p>
                ))}
              </details>
            </div>
          )}
        </div>
        <fieldset
          disabled={busy}
          className="space-y-3 rounded-xl border bg-white p-5"
        >
          <h2 className="text-lg font-bold">
            {selected
              ? "Review or correct meeting notes"
              : "Prepare a meeting import"}
          </h2>
          <label className="block">
            Load transcribed notes
            <input
              type="file"
              accept=".json,.txt"
              className={field}
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
          </label>
          <label className="block">
            Meeting title
            <input
              className={field}
              value={draft.title || ""}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="block">
            Source name
            <input
              className={field}
              value={draft.source || ""}
              placeholder="generic, Plaud, or your transcript provider"
              onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            />
          </label>
          <label className="block">
            Meeting reference
            <input
              className={field}
              value={draft.externalId || ""}
              placeholder="A stable reference for this meeting"
              onChange={(e) =>
                setDraft({ ...draft, externalId: e.target.value })
              }
            />
          </label>
          <label className="block">
            Source revision
            <input
              className={field}
              value={draft.sourceVersion || ""}
              onChange={(e) =>
                setDraft({ ...draft, sourceVersion: e.target.value })
              }
            />
          </label>
          <p className="text-xs text-slate-600">
            Use the provider revision or assign one to your upload. Change it
            when correcting notes; reuse it when retrying the same import.
          </p>
          <label className="block">
            Meeting time including timezone offset
            <input
              className={field}
              value={draft.occurredAt || ""}
              placeholder="2026-09-08T09:00:00+10:00"
              onChange={(e) =>
                setDraft({ ...draft, occurredAt: e.target.value })
              }
            />
          </label>
          <details>
            <summary>Source references</summary>
            {(["calendarEventId", "sourceUrl", "recordingUrl"] as const).map(
              (key) => (
                <label key={key} className="block">
                  {key === "calendarEventId"
                    ? "Linked calendar event reference"
                    : key === "sourceUrl"
                      ? "Original notes URL"
                      : "Recording reference URL"}
                  <input
                    className={field}
                    value={draft.references?.[key] || ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        references: {
                          ...draft.references,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              ),
            )}
          </details>
          <h3 className="font-semibold">Attendees</h3>
          {draft.attendees.map((person, index) => (
            <div key={person.id} className="grid grid-cols-2 gap-2">
              <label>
                Name
                <input
                  className={field}
                  value={person.name}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attendees: draft.attendees.map((p, i) =>
                        i === index ? { ...p, name: e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Email or leave unresolved
                <input
                  className={field}
                  value={person.email || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      attendees: draft.attendees.map((p, i) =>
                        i === index ? { ...p, email: e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}
          <button
            className={button}
            onClick={() =>
              setDraft({
                ...draft,
                attendees: [
                  ...draft.attendees,
                  { id: `attendee-${crypto.randomUUID()}`, name: "" },
                ],
              })
            }
          >
            Add attendee
          </button>
          {draft.topics.map((topic, index) => (
            <div key={topic.id} className="space-y-2 rounded-lg border p-3">
              <h3 className="font-bold">Topic {index + 1}</h3>
              {draft.topics.length > 1 && (
                <button
                  className={button}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      topics: draft.topics.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove topic {index + 1} from this revision
                </button>
              )}
              <label className="block">
                Topic title
                <input
                  className={field}
                  value={topic.title || ""}
                  onChange={(e) =>
                    changeTopic(index, { title: e.target.value })
                  }
                />
              </label>
              <label className="block">
                Topic project
                <select
                  className={field}
                  value={topic.projectId || ""}
                  onChange={(e) =>
                    changeTopic(index, { projectId: e.target.value })
                  }
                >
                  <option value="">Choose project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Transcript for this topic
                <textarea
                  rows={6}
                  className={field}
                  value={topic.segments
                    .map(
                      (s) =>
                        `${s.speaker || draft.attendees.find((p) => p.id === s.speakerId)?.name || "Unknown speaker"}: ${s.text}`,
                    )
                    .join("\n")}
                  onChange={(e) => setTranscript(index, e.target.value)}
                />
              </label>
              <label className="block">
                Existing thread reference, optional
                <input
                  className={field}
                  value={topic.threadId || ""}
                  onChange={(e) =>
                    changeTopic(index, { threadId: e.target.value })
                  }
                />
              </label>
              <p className="text-xs text-slate-600">
                A new topic gets its own thread unless you explicitly link an
                existing one. Use the Thread Register to correct an existing
                association.
              </p>
            </div>
          ))}
          <button
            className={button}
            onClick={() =>
              setDraft({
                ...draft,
                topics: [
                  ...draft.topics,
                  {
                    id: `topic-${crypto.randomUUID()}`,
                    title: "",
                    projectId: "",
                    segments: [],
                  },
                ],
              })
            }
          >
            Add separate topic
          </button>
          <p className="text-sm">
            Review these source notes before importing. Instructions within the
            transcript cannot approve work or grant permissions. No audio is
            downloaded and no messages are sent.
          </p>
          <button className={button} onClick={() => void save()}>
            Import reviewed transcript
          </button>
          {duplicate && (
            <div className="rounded-lg bg-amber-50 p-3">
              <p>
                Review the existing meetings before creating a separate import.
              </p>
              <label>
                Why this is a separate meeting
                <textarea
                  className={field}
                  value={draft.duplicateReason || ""}
                  onChange={(e) =>
                    setDraft({ ...draft, duplicateReason: e.target.value })
                  }
                />
              </label>
              <button
                className={button}
                disabled={!draft.duplicateReason?.trim()}
                onClick={() => void save(true)}
              >
                Confirm separate meeting
              </button>
            </div>
          )}
        </fieldset>
      </div>
    </section>
  );
};
