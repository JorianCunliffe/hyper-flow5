import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, RotateCcw, Sparkles, X } from "lucide-react";
import { firebaseService } from "../services/firebaseService";
import { enterFocusMode } from "./focusMode";
import "./AssistantOverlay.css";

/**
 * Ask HyperFlow — a focus-mode assistant over the cockpit question API.
 * Opening it moves focus into a modal dialog (the rest of the app becomes inert),
 * blurs and dims everything behind it, and returns focus to the launcher on close.
 * Any surface can open it with openAssistant(); Ctrl/Cmd+J opens it from anywhere.
 */
export const ASSISTANT_EVENT = "hyperflow:assistant";
export type AssistantSeed = { question?: string; party?: string; submit?: boolean };
export const openAssistant = (seed: AssistantSeed = {}) =>
  window.dispatchEvent(new CustomEvent<AssistantSeed>(ASSISTANT_EVENT, { detail: seed }));

type Turn = {
  id: number;
  question: string;
  answer?: string;
  incomplete?: boolean;
  error?: string;
  pending?: boolean;
};

const SUGGESTIONS = [
  "What do I owe today?",
  "Who am I waiting on?",
  "What is overdue?",
  "Which decisions need me?",
];
const MAX_QUESTION = 2000;

export function AssistantOverlay({
  projectId,
  projectName,
}: {
  projectId: string | null;
  projectName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [party, setParty] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const queued = useRef<string | null>(null);
  const nextId = useRef(1);
  const busy = turns.some((turn) => turn.pending);

  const ask = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      const id = nextId.current++;
      const settle = (patch: Partial<Turn>) =>
        setTurns((current) =>
          current.map((turn) => (turn.id === id ? { ...turn, ...patch, pending: false } : turn)),
        );
      setTurns((current) => [...current, { id, question, pending: true }]);
      setDraft("");
      try {
        const response = await firebaseService.authorizedFetch("/api/cockpit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "question", question, party, projectId: projectId || "" }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "HyperFlow could not answer right now.");
        settle({ answer: String(result.answer || ""), incomplete: !!result.incomplete });
      } catch (error: any) {
        settle({ error: error?.message || "HyperFlow could not answer right now." });
      }
    },
    [busy, party, projectId],
  );

  // Launch from anywhere: openAssistant() or Ctrl/Cmd+J.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const seed = (event as CustomEvent<AssistantSeed>).detail || {};
      if (!dialog.current?.open) opener.current = document.activeElement as HTMLElement | null;
      if (seed.party !== undefined) setParty(seed.party);
      if (seed.question) {
        if (seed.submit) queued.current = seed.question;
        else setDraft(seed.question);
      }
      setOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        openAssistant();
      }
    };
    window.addEventListener(ASSISTANT_EVENT, onOpen);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(ASSISTANT_EVENT, onOpen);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Take focus: modal dialog + blurred, inert background. Give it back on close.
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    if (!element.open) element.showModal();
    const release = enterFocusMode();
    requestAnimationFrame(() => input.current?.focus());
    return () => {
      release();
      if (element.open) element.close();
      opener.current?.focus?.();
      opener.current = null;
    };
  }, [open]);

  // A seeded question (e.g. from a launcher) is asked once the dialog is open.
  useEffect(() => {
    if (!open || !queued.current) return;
    const question = queued.current;
    queued.current = null;
    void ask(question);
  }, [open, ask]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  return createPortal(
    <dialog
      ref={dialog}
      className="hf-assistant"
      aria-labelledby="hf-assistant-title"
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="hf-assistant-panel">
        <span className="hf-assistant-grabber" aria-hidden="true" />
        <header className="hf-assistant-head">
          <span className="hf-assistant-mark" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <div className="hf-assistant-title">
            <h2 id="hf-assistant-title">Ask HyperFlow</h2>
            <p>
              {projectName || "All projects"}
              {party ? " · one person" : ""}
            </p>
          </div>
          {turns.length > 0 && (
            <button type="button" aria-label="Start a new conversation" onClick={() => setTurns([])} disabled={busy}>
              <RotateCcw size={18} />
            </button>
          )}
          <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)}>
            <X size={20} />
          </button>
        </header>

        <div className="hf-assistant-log" ref={log} aria-live="polite">
          {turns.length === 0 ? (
            <div className="hf-assistant-empty">
              <p>Ask about commitments, decisions and who you are waiting on. Answers come from your current, permitted records.</p>
              <div className="hf-assistant-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => void ask(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => (
              <div className="hf-assistant-turn" key={turn.id}>
                <p className="hf-assistant-q">{turn.question}</p>
                {turn.pending ? (
                  <p className="hf-assistant-a hf-assistant-thinking" role="status">
                    <span /><span /><span />
                    <span className="hf-sr-only">Reading your records</span>
                  </p>
                ) : turn.error ? (
                  <p className="hf-assistant-a hf-assistant-error" role="alert">{turn.error}</p>
                ) : (
                  <div className="hf-assistant-a">
                    <p>{turn.answer}</p>
                    {turn.incomplete && <p className="hf-assistant-note">This answer is incomplete; more records may exist.</p>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <form
          className="hf-assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(draft);
          }}
        >
          <label htmlFor="hf-assistant-input" className="hf-sr-only">Ask about your work</label>
          <textarea
            id="hf-assistant-input"
            ref={input}
            rows={1}
            maxLength={MAX_QUESTION}
            value={draft}
            placeholder="Ask about your work"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void ask(draft);
              }
            }}
          />
          <button type="submit" aria-label="Send question" disabled={busy || !draft.trim()}>
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </form>
        <p className="hf-assistant-hint">Read-only answers · nothing is sent or changed · Esc to close</p>
      </div>
    </dialog>,
    document.body,
  );
}
