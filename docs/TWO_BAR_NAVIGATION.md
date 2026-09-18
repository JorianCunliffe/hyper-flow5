# Workspace navigation

The first bar selects All projects or one project. Search changes context without changing the current view. Settings and account actions are utilities, not daily work destinations.

The second bar places options on the left and seven views on the right:

| View | Options |
| --- | --- |
| Overview | Summary, Decisions |
| Work | Projects / map, Task board, Commitments, Quick capture |
| Calendar | Project calendars |
| Communications | Messages, Meetings, History |
| Documents | Create & review, Publishing |
| Automations | Flows & runs |
| Reports | Progress, Current state |

Page-specific display controls share the second bar. Compact screens use an Options popover and a named view selector. No third row, pinned shortcuts, category menus, or bottom dock is used.

Each view remembers its last option during the session. The URL retains the project and existing page identifiers for refresh and deep links. Account changes clear project context. Selecting another project clears record-specific deep links.

Lists follow the selected project, including communication jobs, digests, meetings, and paginated flow summaries. All projects includes unassigned records where supported. Calendar and document creation require a project, so their All projects screen offers a project directory rather than an ambiguous creation target. Project context is a display filter; server permissions remain authoritative.

## Verification

Run `npm run lint`, `npm test`, and `npm run build`. Start Vite on a free local port and open `/tests/ui/project-context.html?view=kanban` in an isolated browser session. The fixture contains two local projects and mocks provider requests. Pipe `tests/ui/project-context-check.js` into `agent-browser eval --stdin` at a desktop viewport. It covers every view, cross-project filtering, option memory, and the two-row layout. Also check the mobile Options menu, project search, reload, and settings navigation.

The fixture writes sample data to local storage on its origin. Keep it separate from any real local workspace. It does not connect to live providers.
