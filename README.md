# HyperFlow (ProjectFlow)

Project management on a visual flow canvas: projects are a graph of nodes (linked via dependencies), combining human milestones with automated actions, decisions, and loops.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill in the keys you need:
   - `GEMINI_API_KEY` — AI project generation, brainstorming, report nodes
   - `RESEND_API_KEY` — email nodes / task emails
   - `BLAND_API_KEY` — AI phone call nodes
   - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` — SMS nodes (leave blank for stub mode, which logs instead of sending)
3. Run the app: `npm run dev` (http://localhost:3000)

## Node Types

Every node on the project map has a type (hover a node → gear button → Node Configuration). The default is **Milestone**; the others make the flow executable:

| Type | What it does |
|---|---|
| **Milestone** | Standard milestone with subtasks. Complete when all subtasks are complete. |
| **Decision** | Branches the flow. Each outgoing link is a branch with a label and conditions checked against Project Data (e.g. `[{"variable": "proposal_interest", "equals": true}]`). First matching branch wins; a branch with no conditions is the default. Unselected branches are skipped. |
| **Loop** | Repeats a section. Pick a "loop back to" node, exit conditions, and max iterations. When reached without the exit conditions met, everything between the start node and the loop resets and runs again. |
| **Email** | Sends an email via Resend. Template: `{"to", "subject", "body"}`. |
| **SMS** | Sends an SMS via Twilio (or stub mode without credentials). Template: `{"to", "body"}`. |
| **Phone Call** | Places an AI voice call via Bland AI. Template: `{"to", "prompt"}`. |
| **Webhook** | Calls an external HTTP endpoint. Template: `{"url", "method", "headers", "payload"}`. |
| **Report** | Generates a report with Gemini (draft → evaluate → revise). Template: `{"prompt", "sop", "template", "eval_criteria"}`. |

Action templates support `{{variable}}` substitution from Project Data. On success, an action's output is merged back into Project Data, so downstream decisions and loops can branch on it (e.g. `sms_sent`, `webhook_status`).

### Running the flow

- **Run Now** — hover an action node and press the green play button (or use the config modal).
- **Advance Flow** (toolbar) — evaluates ready decision nodes, iterates/exits ready loop nodes, and runs any ready action nodes marked **auto-execute**. A node is ready when all its dependencies are resolved and at least one completed (skipped branches don't block joins).

Flow engine logic lives in `lib/flowEngine.ts`; action execution is handled by `POST /api/tasks/execute` in `server.ts`.
