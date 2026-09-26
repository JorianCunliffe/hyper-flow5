export type AppView =
  | "captures"
  | "projects"
  | "kanban"
  | "scratch"
  | "feed"
  | "approvals"
  | "reports"
  | "activity"
  | "obligations"
  | "meetings"
  | "flows"
  | "cockpit"
  | "diary"
  | "artifacts"
  | "publishing"
  | "tenant";

const APP_VIEWS = new Set<AppView>([
  "captures",
  "projects",
  "kanban",
  "scratch",
  "feed",
  "approvals",
  "reports",
  "activity",
  "obligations",
  "meetings",
  "flows",
  "cockpit",
  "diary",
  "artifacts",
  "publishing",
  "tenant",
]);

export const parseAppView = (value: string | null | undefined): AppView =>
  value && APP_VIEWS.has(value as AppView) ? (value as AppView) : "projects";

export type WorkspaceView =
  | "overview"
  | "work"
  | "calendar"
  | "communications"
  | "documents"
  | "automations"
  | "reports";
export const WORKSPACE_VIEWS: {
  id: WorkspaceView;
  label: string;
  modes: { id: AppView; label: string }[];
}[] = [
  {
    id: "overview",
    label: "Overview",
    modes: [
      { id: "cockpit", label: "Summary" },
      { id: "approvals", label: "Decisions" },
    ],
  },
  {
    id: "work",
    label: "Work",
    modes: [
      { id: "projects", label: "Projects / map" },
      { id: "kanban", label: "Task board" },
      { id: "obligations", label: "Commitments" },
      { id: "scratch", label: "Quick capture" },
      { id: "captures", label: "Unresolved Items" },
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    modes: [{ id: "diary", label: "Calendar" }],
  },
  {
    id: "communications",
    label: "Communications",
    modes: [
      { id: "activity", label: "Messages" },
      { id: "meetings", label: "Meetings" },
      { id: "feed", label: "History" },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    modes: [
      { id: "artifacts", label: "Create & review" },
      { id: "publishing", label: "Publishing" },
    ],
  },
  {
    id: "automations",
    label: "Automations",
    modes: [{ id: "flows", label: "Flows & runs" }],
  },
  {
    id: "reports",
    label: "Reports",
    modes: [{ id: "reports", label: "Reports" }],
  },
];
export const workspaceViewFor = (view: AppView) =>
  WORKSPACE_VIEWS.find((section) =>
    section.modes.some((mode) => mode.id === view),
  );
export const hasProjectContext = (view: AppView): boolean => view !== "tenant";
