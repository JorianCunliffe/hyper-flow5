import React, { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Ellipsis,
  FileText,
  Inbox,
  Layers,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  UserRound,
  Workflow,
  X,
} from "lucide-react";
import {
  WORKSPACE_VIEWS,
  workspaceViewFor,
  type AppView,
  type WorkspaceView,
} from "../lib/appView";
import { openAssistant } from "./AssistantOverlay";
import { ThemeControl } from "./ThemeControl";
import "./GlassNavigation.css";
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
type Panel = "search" | "profile" | "settings" | "more";
const pages = WORKSPACE_VIEWS.flatMap((section) =>
  section.modes.map((mode) => ({ ...mode, section: section.label })),
);
/** Phone tab bar: the four daily destinations plus More (documents, automations, reports, settings). */
const TABS: { id: WorkspaceView | "more"; label: string; Icon: typeof Sun }[] = [
  { id: "overview", label: "Today", Icon: Sun },
  { id: "work", label: "Work", Icon: Layers },
  { id: "communications", label: "Inbox", Icon: Inbox },
  { id: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "more", label: "More", Icon: Ellipsis },
];
const MORE_SECTIONS: { id: WorkspaceView; Icon: typeof Sun; hint: string }[] = [
  { id: "documents", Icon: FileText, hint: "Create, review and publish" },
  { id: "automations", Icon: Workflow, hint: "Flows and runs" },
  { id: "reports", Icon: BarChart3, hint: "Progress and time" },
];
const PANEL_TITLES: Record<Panel, string> = {
  search: "Find a project or view",
  settings: "Settings",
  profile: "Your account",
  more: "More",
};
export function GlassNavigation(p: Props) {
  const section = workspaceViewFor(p.activeView);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  useEffect(() => setOptionsOpen(false), [p.activeView, p.selectedProjectId]);
  const [query, setQuery] = useState("");
  const remembered = useRef<Partial<Record<WorkspaceView, AppView>>>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (section) remembered.current[section.id] = p.activeView;
  }, [section, p.activeView]);
  useEffect(() => {
    if (panel) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
      trigger.current?.focus();
    }
  }, [panel]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        trigger.current = document.activeElement as HTMLElement;
        setQuery("");
        setPanel("search");
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  const open = (next: Panel, element: HTMLElement) => {
    trigger.current = element;
    setQuery("");
    setPanel(next);
  };
  const go = (view: AppView) => {
    setPanel(null);
    p.onNavigate(view);
  };
  const goSection = (id: WorkspaceView) => {
    const next = WORKSPACE_VIEWS.find((v) => v.id === id)!;
    go(remembered.current[id] || next.modes[0].id);
  };
  const action = (fn: () => void) => {
    setPanel(null);
    fn();
  };
  const needle = query.trim().toLowerCase();
  const matchingPages = pages.filter((page) =>
    `${page.label} ${page.section}`.toLowerCase().includes(needle),
  );
  const matchingProjects = p.projects.filter((project) =>
    project.name.toLowerCase().includes(needle),
  );
  const moreActive =
    !section || MORE_SECTIONS.some((entry) => entry.id === section.id);
  const settingsActions = (
    <>
      <button onClick={() => action(p.onSettings)}>
        <span>Workspace preferences</span>
        <small>Channels, AI workers and permissions</small>
      </button>
      <button onClick={() => go("tenant")}>
        <span>Account operations</span>
        <small>Members, lifecycle and recovery</small>
      </button>
    </>
  );
  const accountActions = p.signedIn ? (
    <>
      <button onClick={() => action(p.onInvite)}>Invite a colleague</button>
      <button onClick={() => action(p.onLogout)}>Sign out</button>
    </>
  ) : (
    <p>Local workspace</p>
  );
  return (
    <>
      <header className="hf-shell" aria-label="Workspace navigation">
        <div className="hf-context-bar">
          <button
            className="hf-brand"
            onClick={() => go("cockpit")}
            aria-label="HyperFlow overview"
          >
            <Layers size={23} />
            <strong>HyperFlow</strong>
          </button>
          <label className="hf-project">
            <span>Project context</span>
            <select
              aria-label="Project context"
              value={p.selectedProjectId || ""}
              onChange={(event) =>
                event.target.value === "__new__"
                  ? p.onNewProject()
                  : p.onProject(event.target.value || null)
              }
            >
              <option value="">All projects</option>
              {p.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
              <option value="__new__">+ New project...</option>
            </select>
          </label>
          <div className="hf-utilities">
            <button
              className="hf-ask"
              aria-label="Ask HyperFlow"
              title="Ask HyperFlow (Ctrl / Cmd J)"
              onClick={() => openAssistant()}
            >
              <Sparkles size={18} />
              <span>Ask</span>
            </button>
            <button
              aria-label="Search projects and views"
              title="Search (Ctrl / Cmd K)"
              onClick={(event) => open("search", event.currentTarget)}
            >
              <Search size={19} />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="hf-desktop-only"
              aria-label="Settings"
              onClick={(event) => open("settings", event.currentTarget)}
            >
              <Settings size={19} />
            </button>
            <button
              className="hf-desktop-only"
              aria-label="Your account"
              onClick={(event) => open("profile", event.currentTarget)}
            >
              <UserRound size={19} />
            </button>
          </div>
        </div>
        <div className="hf-view-bar">
          <button
            className="hf-options-toggle"
            aria-expanded={optionsOpen}
            aria-controls="hf-view-options"
            onClick={() => setOptionsOpen((value) => !value)}
          >
            Options
          </button>
          <div
            id="hf-view-options"
            className="hf-view-options"
            data-open={optionsOpen}
            aria-label="View options"
            onChange={() => setOptionsOpen(false)}
          >
            {section && section.modes.length > 1 ? (
              <label className="hf-mode-select">
                <span className="hf-sr-only">{section.label} options</span>
                <select
                  aria-label={`${section.label} options`}
                  value={p.activeView}
                  onChange={(event) => go(event.target.value as AppView)}
                >
                  {section.modes.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.label}
                      {mode.id === "approvals" && p.approvals
                        ? ` (${p.approvals})`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="hf-option-label">
                {section?.modes[0].label || "Workspace settings"}
              </span>
            )}
            <div id="hf-extra-options" />
            {section?.id === "work" && (
              <button className="hf-add" onClick={p.onNewProject}>
                <Plus size={16} />
                <span>Project</span>
              </button>
            )}
          </div>
          {section && section.modes.length > 1 && (
            <nav className="hf-mode-pills" aria-label={`${section.label} views`}>
              {section.modes.map((mode) => (
                <button
                  key={mode.id}
                  aria-current={p.activeView === mode.id ? "page" : undefined}
                  onClick={() => go(mode.id)}
                >
                  {mode.label}
                  {mode.id === "approvals" && p.approvals > 0 && (
                    <span className="hf-count">{p.approvals}</span>
                  )}
                </button>
              ))}
            </nav>
          )}
          <nav className="hf-views" aria-label="Views">
            {WORKSPACE_VIEWS.map((view) => (
              <button
                key={view.id}
                aria-current={section?.id === view.id ? "page" : undefined}
                onClick={() => goSection(view.id)}
              >
                {view.label}
                {view.id === "overview" && p.approvals > 0 && (
                  <span
                    className="hf-count"
                    aria-label={`${p.approvals} decisions waiting`}
                  >
                    {p.approvals}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <label className="hf-mobile-view">
            <span className="hf-sr-only">View</span>
            <select
              aria-label="Workspace view"
              value={section?.id || ""}
              onChange={(event) =>
                goSection(event.target.value as WorkspaceView)
              }
            >
              {!section && <option value="">Settings</option>}
              {WORKSPACE_VIEWS.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.label}
                  {view.id === "overview" && p.approvals
                    ? ` (${p.approvals})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <nav className="hf-tabbar" aria-label="Main">
        {TABS.map(({ id, label, Icon }) => {
          const active = id === "more" ? moreActive : section?.id === id;
          return (
            <button
              key={id}
              aria-current={active ? "page" : undefined}
              onClick={(event) =>
                id === "more"
                  ? open("more", event.currentTarget)
                  : goSection(id)
              }
            >
              <span className="hf-tab-icon">
                <Icon size={24} strokeWidth={active ? 2.2 : 1.7} />
                {id === "overview" && p.approvals > 0 && (
                  <span
                    className="hf-tab-badge"
                    aria-label={`${p.approvals} decisions waiting`}
                  >
                    {p.approvals}
                  </span>
                )}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      <dialog
        ref={dialog}
        className="hf-nav-dialog"
        data-panel={panel || undefined}
        aria-labelledby="hf-panel-title"
        onCancel={() => setPanel(null)}
        onClose={() => setPanel(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const r = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              setPanel(null);
          }
        }}
      >
        <div className="hf-dialog-heading">
          <h2 id="hf-panel-title">{panel ? PANEL_TITLES[panel] : ""}</h2>
          <button aria-label="Close menu" onClick={() => setPanel(null)}>
            <X size={20} />
          </button>
        </div>
        {panel === "search" ? (
          <>
            <input
              autoFocus
              aria-label="Search projects and views"
              placeholder="Project name, tasks, reports..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="hf-results">
              <button onClick={() => action(() => p.onProject(null))}>
                <span>All projects</span>
                <small>Context</small>
              </button>
              {matchingProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => action(() => p.onProject(project.id))}
                >
                  <span>{project.name}</span>
                  <small>Project context</small>
                </button>
              ))}
              {matchingPages.map((page) => (
                <button key={page.id} onClick={() => go(page.id)}>
                  <span>{page.label}</span>
                  <small>{page.section}</small>
                </button>
              ))}
              {!matchingProjects.length && !matchingPages.length && (
                <p>No matching projects or views.</p>
              )}
            </div>
          </>
        ) : panel === "settings" ? (
          <>
            <ThemeControl />
            <div className="hf-results">{settingsActions}</div>
          </>
        ) : panel === "more" ? (
          <>
            <h3 className="hf-group-label">Workspace</h3>
            <div className="hf-results hf-grouped">
              {MORE_SECTIONS.map(({ id, Icon, hint }) => {
                const entry = WORKSPACE_VIEWS.find((v) => v.id === id)!;
                return (
                  <button
                    key={id}
                    aria-current={section?.id === id ? "page" : undefined}
                    onClick={() => goSection(id)}
                  >
                    <span className="hf-row-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span>{entry.label}</span>
                    <small>{hint}</small>
                  </button>
                );
              })}
            </div>
            <ThemeControl />
            <h3 className="hf-group-label">Settings</h3>
            <div className="hf-results hf-grouped">{settingsActions}</div>
            <h3 className="hf-group-label">Account</h3>
            <div className="hf-results hf-grouped">{accountActions}</div>
          </>
        ) : (
          <div className="hf-results">{accountActions}</div>
        )}
      </dialog>
    </>
  );
}
