import React, { useEffect, useRef, useState } from "react";
import {
  Layers,
  Sun,
  Briefcase,
  MessagesSquare,
  Sparkles,
  MoreHorizontal,
  Search,
  Bell,
  UserRound,
  Pin,
  X,
  ChevronRight,
} from "lucide-react";
import { hasProjectContext, type AppView } from "../lib/appView";
import "./GlassNavigation.css";

const groups: { name: string; icon: typeof Sun; pages: [AppView, string][] }[] =
  [
    {
      name: "Today",
      icon: Sun,
      pages: [
        ["cockpit", "Cockpit"],
        ["approvals", "Approvals"],
      ],
    },
    {
      name: "Work",
      icon: Briefcase,
      pages: [
        ["projects", "Projects"],
        ["kanban", "Kanban"],
        ["obligations", "Obligations"],
        ["diary", "Diary"],
        ["flows", "Flows"],
      ],
    },
    {
      name: "Communications",
      icon: MessagesSquare,
      pages: [
        ["activity", "Activity"],
        ["meetings", "Meetings"],
        ["feed", "Feed"],
      ],
    },
    {
      name: "Create",
      icon: Sparkles,
      pages: [
        ["scratch", "Scratch"],
        ["reports", "Reports"],
        ["artifacts", "Office outputs"],
        ["publishing", "Publishing"],
      ],
    },
    {
      name: "More",
      icon: MoreHorizontal,
      pages: [["tenant", "Account operations"]],
    },
  ];
const pages = groups.flatMap((g) =>
  g.pages.map(([id, label]) => ({ id, label, group: g.name })),
);
const defaults: AppView[] = ["diary", "obligations", "approvals"];
type Props = {
  key?: string;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  approvals: number;
  projects: { id: string; name: string }[];
  selectedProjectId: string | null;
  onProject: (id: string | null) => void;
  onNewProject: () => void;
  onSettings: () => void;
  onInvite: () => void;
  onLogout: () => void;
  signedIn: boolean;
  storageKey: string;
};
export function GlassNavigation(p: Props) {
  const [panel, setPanel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pins, setPins] = useState<AppView[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(p.storageKey) || "null");
      return Array.isArray(value)
        ? ([
            ...new Set(
              value.filter((id: AppView) => pages.some((v) => v.id === id)),
            ),
          ].slice(0, 3) as AppView[])
        : defaults;
    } catch {
      return defaults;
    }
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const activeIndex = Math.max(
    0,
    groups.findIndex((g) => g.pages.some(([id]) => id === p.activeView)),
  );
  const current = pages.find((v) => v.id === p.activeView)!;
  const projectScoped = hasProjectContext(p.activeView);
  useEffect(() => {
    if (panel) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      trigger.current?.focus();
    }
  }, [panel]);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        trigger.current = document.activeElement as HTMLElement;
        setQuery("");
        setPanel("search");
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  const open = (name: string, element: HTMLElement) => {
    trigger.current = element;
    setQuery("");
    setPanel(name);
  };
  const go = (view: AppView) => {
    setPanel(null);
    p.onNavigate(view);
  };
  const action = (fn: () => void) => {
    setPanel(null);
    fn();
  };
  const togglePin = (id: AppView) =>
    setPins((old) => {
      const next = old.includes(id)
        ? old.filter((v) => v !== id)
        : [...old.slice(-2), id];
      try {
        localStorage.setItem(p.storageKey, JSON.stringify(next));
      } catch {
        /* Navigation remains usable when storage is unavailable. */
      }
      return next;
    });
  return (
    <>
      <header className="hf-glass-header">
        <div className="hf-glass-bar">
          <button
            className="hf-brand"
            onClick={() => go("cockpit")}
            aria-label="HyperFlow home"
          >
            <span>
              <Layers size={22} />
            </span>
            <strong>HyperFlow</strong>
          </button>
          <nav className="hf-groups" aria-label="Main navigation">
            <span
              className="hf-active-pill"
              style={{ transform: `translateX(${activeIndex * 100}%)` }}
            />
            {groups.map((g, i) => (
              <button
                key={g.name}
                aria-current={i === activeIndex ? "true" : undefined}
                aria-haspopup="dialog"
                onClick={(e) => open(g.name, e.currentTarget)}
              >
                <g.icon size={19} />
                <span className="hf-desktop-label">{g.name}</span>
                <span className="hf-mobile-label">
                  {g.name === "Communications" ? "Comms" : g.name}
                </span>
              </button>
            ))}
          </nav>
          <div className="hf-utilities">
            <button
              aria-label="Search pages and projects"
              title="Go to… (Ctrl / ⌘ K)"
              onClick={(e) => open("search", e.currentTarget)}
            >
              <Search size={20} />
            </button>
            <button
              aria-label={`Approvals, ${p.approvals} pending`}
              onClick={() => go("approvals")}
            >
              <Bell size={20} />
              {p.approvals > 0 && (
                <span className="hf-badge">
                  {p.approvals > 99 ? "99+" : p.approvals}
                </span>
              )}
            </button>
            <button
              aria-label="Profile and settings"
              aria-haspopup="dialog"
              onClick={(e) => open("profile", e.currentTarget)}
            >
              <UserRound size={20} />
            </button>
          </div>
        </div>
        <div className="hf-context">
          <div className="hf-breadcrumb">
            <span>{current.group}</span>
            <ChevronRight size={13} />
            <strong>{current.label}</strong>
          </div>
          {projectScoped ? <label className="hf-project">
            <span className="sr-only">Switch project</span>
            <select
              aria-label="Switch project"
              value={p.selectedProjectId || ""}
              onChange={(e) => p.onProject(e.target.value || null)}
            >
              <option value="">All projects</option>
              {p.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label> : <span className="hf-workspace-scope">Workspace-wide view</span>}
          <nav className="hf-pins" aria-label="Pinned shortcuts">
            {pins.map((id) => (
              <button
                key={id}
                aria-current={p.activeView === id ? "page" : undefined}
                onClick={() => go(id)}
              >
                {pages.find((v) => v.id === id)?.label}
              </button>
            ))}
          </nav>
        </div>
        <nav className="hf-section-pages" aria-label={`${current.group} pages`}>
          {groups[activeIndex].pages.map(([id, label]) => (
            <button key={id} aria-current={p.activeView === id ? "page" : undefined} onClick={() => go(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <dialog
        ref={dialog}
        className="hf-nav-dialog"
        aria-labelledby="hf-panel-title"
        onCancel={() => setPanel(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              setPanel(null);
          }
        }}
      >
        <div className="hf-panel-heading">
          <h2 id="hf-panel-title">
            {panel === "search"
              ? "Go to…"
              : panel === "profile"
                ? "Your workspace"
                : panel}
          </h2>
          <button aria-label="Close navigation" onClick={() => setPanel(null)}>
            <X size={20} />
          </button>
        </div>
        {panel === "search" ? (
          <>
            <input
              autoFocus
              aria-label="Search pages and projects"
              placeholder="Find a page or project…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="hf-search"
            />
            <div className="hf-results">
              {pages
                .filter((v) =>
                  `${v.label} ${v.group}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((v) => (
                  <button key={v.id} onClick={() => go(v.id)}>
                    <span>{v.label}</span>
                    <small>{v.group}</small>
                  </button>
                ))}
              {p.projects
                .filter((v) =>
                  v.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((v) => (
                  <button
                    key={v.id}
                    onClick={() => action(() => { p.onProject(v.id); p.onNavigate("projects"); })}
                  >
                    <span>{v.name}</span>
                    <small>Project</small>
                  </button>
                ))}
              {!pages.some((v) =>
                `${v.label} ${v.group}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              ) &&
                !p.projects.some((v) =>
                  v.name.toLowerCase().includes(query.toLowerCase()),
                ) && <p>No matching pages or projects.</p>}
            </div>
          </>
        ) : panel === "profile" ? (
          <div className="hf-results">
            <button onClick={() => action(p.onSettings)}>Settings</button>
            <button onClick={() => action(p.onNewProject)}>New project</button>
            {p.signedIn && (
              <>
                <button onClick={() => action(p.onInvite)}>
                  Invite a colleague
                </button>
                <button onClick={() => action(p.onLogout)}>Sign out</button>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="hf-panel-hint">
              Choose a page. Pin up to three shortcuts for quick access.
            </p>
            <div className="hf-page-grid">
              {groups
                .find((g) => g.name === panel)
                ?.pages.map(([id, label]) => (
                  <div className="hf-page-row" key={id}>
                    <button
                      aria-current={p.activeView === id ? "page" : undefined}
                      onClick={() => go(id)}
                    >
                      {label}
                      <ChevronRight size={16} />
                    </button>
                    <button
                      aria-label={`${pins.includes(id) ? "Unpin" : "Pin"} ${label}`}
                      aria-pressed={pins.includes(id)}
                      onClick={() => togglePin(id)}
                    >
                      <Pin size={16} />
                    </button>
                  </div>
                ))}
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
