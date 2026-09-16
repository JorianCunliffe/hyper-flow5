# HyperFlow implementation programme status

Last updated: 16 September 2026.

## 16 September repository and live-readiness update

- Main includes durable FlowRun execution/holds, dynamic Ask schemas and stepped SMS Ask delivery.
- Mailbox draft-update integration PR40 is merged. The live Communications service is healthy at v2.8.2/build `9e3e2d0ae799`, but its draft PATCH route still returns route-not-found. The separate Communications release is blocked by Replit's database-publishing step; source integration is not live provider acceptance.
- PR41 adds `Project.emailSendingEnabled`, default off, to Edit Project Settings. The shared server client checks the saved tenant/project on each email dispatch, beneath the organization policy ceiling. Drafts remain available; copies start disabled. No live project was enabled and no email was sent for this work.
- The signed-in Diary now successfully lists the CEO Google calendars. The older missing-calendar-read-consent observation below is superseded. No configured calendar was shown; project/calendar booking policy and a controlled create/update/cancel test remain pending. Read access does not establish write access.
- The older phase records below retain their dated evidence. Full Phase11/12 acceptance remains open.

**Current state:** Phases 01–09 implementations are merged and deployed. Phase 06's controlled live request compilation, approval, evidence/report execution and version-promotion checks pass. Phase 07 cockpit reads accepted live work; Phase 08 live calendar booking acceptance awaits consent and policy; Phase 09 controlled live slide-report generation and review pass; live Google export awaits a target. SMS and call receipt were confirmed by the user; the fresh human call and final spoken turn are verified in P12. Historical baseline observations below remain dated snapshots.

**Current scope:** two existing applications. Communications Service retains its existing memory, search and enrichment. No memory extraction or third memory application.

**First customer:** CEO. Email draft-only; SMS and phone permitted within configured authority. Diary mutations and public publishing need their own policies.

## Programme documents

- [Master implementation plan](HYPERFLOW_IMPLEMENTATION_PLAN.md)
- [Codex phase goal and evidence template](CODEX_PHASE_GOAL_TEMPLATE.md)
- [Product model](HYPERFLOW_PRODUCT_MODEL.md) — broader vision; the master plan supersedes its separate-memory/new-wiki direction for this programme.
- [Existing integrated acceptance plan](OMNICHANNEL_ACCEPTANCE_TEST_PLAN.md)

## Verified Phase 00 baseline

- HyperFlow HEAD observed at `6b9acf5`, with existing tracked modifications and untracked Thread Register work.
- Communications HEAD observed at `7ba163a`, with a clean status at inspection.
- A second Communications checkout at `C:/Users/joria/OneDrive/Documents/ChatGPT/communications-service` is at `8c8b9d2` with extensive uncommitted threading changes, migration 018 and pending migration 019. Its `v1.js` contains Thread Register/candidate/rethread endpoints missing from the first checkout. Phase 00 must reconcile these sources without losing work.
- Communications already has memory search, facts, extracted commitments, enrichment, calendar context and Gmail/Outlook adapters. These remain there.
- HyperFlow: 434 tests, 30 database rules checks, type-check and build passed. Newer Communications: 234 unit and 19 database tests passed. Older Communications: 212 unit tests passed.
- Fetched remote HyperFlow main is `2a54acb` (additional acceptance documentation), verified READY in production. Remote Communications main is `1fabe2c` (voice `end_call` improvement), which must be preserved when integrating local threading changes.
- Communications health reports `v2.3.0`, build `5d14bcff6ad6`; exact deployed commit, migrations, mailbox grants and live targets remain unverified. No live calls/messages were made.

## Phase ledger

| Phase | Outcome | Status | Dependencies | Evidence |
|---|---|---|---|---|
| P00 | Current baseline and mismatch register | Baseline accepted | None | [HyperFlow record](implementation/P00.md); Communications records in each checkout's `docs/implementation/P00.md` |
| P01 | Ownership, authority and API/event contracts | Merged and deployed; later repair caveat above | P00 | [Record](implementation/P01.md); [HyperFlow PR](https://github.com/JorianCunliffe/hyper-flow5/pull/2); [Communications PR](https://github.com/JorianCunliffe/communications-service/pull/2) |
| P02 | Canonical cross-channel threads and register | Merged and deployed; SMS/call receipt confirmed | P01 | [Record](implementation/P02.md); [HyperFlow PR](https://github.com/JorianCunliffe/hyper-flow5/pull/3); [Communications PR](https://github.com/JorianCunliffe/communications-service/pull/3) |
| P03 | Safe use of existing Communications memory | Merged and deployed | P02 | [P03 record](implementation/P03.md); later baseline in [P04](implementation/P04.md) |
| P04 | HyperFlow commitments and Ask lifecycle | Merged, deployed and controlled live lifecycle verified | P03 | [P04 record](implementation/P04.md); [release and correction](implementation/P04_RELEASE.md) |
| P05 | Transcribed meeting ingestion and enrichment | Released; controlled live acceptance verified | P03, P04 | [P05 record](implementation/P05.md) |
| P06 | Visible reusable flows from requests | Released; controlled live acceptance verified | P04; P05 for meeting inputs | [P06 record](implementation/P06.md) |
| P07 | CEO cockpit, follow-up and receptionist | Released; controlled cockpit verified; fresh channels tracked in P12 | P06, P02–P04; P05 for meeting briefs | [P07 record](implementation/P07.md) |
| P08 | Diary and calendar execution | Released; live calendar grant and booking acceptance pending | P07, P01 | [P08 record](implementation/P08.md) |
| P09 | Reports, templates and office artifacts | Released; controlled live slide report reviewed; controlled Google export verified in P12 | P06; P04/P05 for operational inputs | [P09 record](implementation/P09.md) |
| P10 | Approved social and website publication | Internal workflow released and controlled live draft/flow verified; selected providers and live publication pending | P09 | [P10 record](implementation/P10.md) |
| P11 | Complete REST parity and SaaS operations | In progress: account APIs, recovery and database erasure live; private Sydney storage, Ask attachments and audited diagnostics verified live; full parity and provider recovery remain | Cross-cutting from P01; final audit after selected product phases | [P11](implementation/P11.md) |
| P12 | Integrated CEO acceptance and release | Controlled checks and fresh human voice delivery verified; controlled CEO journey, file restore and Google export passed; calendar/social/CMS and full programme acceptance remain | P00–P11 for full programme | [P12](implementation/P12.md) |

Replace “No phase record yet” with links to the actual per-app records when they are created. Do not pre-create pass results or mark a whole phase complete from one work package.

## Next goal

Implement and verify Phase 11 tenant operations and API parity, then repeat implementation, verification and release through Phase 12 under the user's continuing authorization. Preserve the application boundaries and existing channel authority. Generic transcript upload is the initial source; selected calendar/social/CMS/provider details are pending user clarification. Missing provider authority must not be replaced with invented grants or reported as passed live acceptance.

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-09-08 | Keep existing memory inside Communications Service; omit extraction and a new memory layer. | Explicit user scope correction. |
| 2026-09-08 | Keep Communications canonical threads/people separate from HyperFlow business state. | Preserve application boundaries and avoid conflicting authorities. |
| 2026-09-08 | Treat extracted promises as source evidence; put accepted operational obligations in HyperFlow using Asks. | Separate interpretation from acceptance and verified fulfillment. |
| 2026-09-08 | Phase the work into bounded Codex goals with per-app evidence records. | Support implementation and reliable handoff without a single unbounded goal. |

| 2026-09-08 | Email draft-only is an option for every organization; it is the default. The CEO is in the first organization. | User clarification; no special CEO tenant ID required. |

Phase 12 now has a pinned cross-service CI job and a combined contact, commitment, weekly report and recovery journey. Provider-target acceptance, backup restore and CEO signoff remain open; see [P12](implementation/P12.md).

9 September follow-up: the selected live CEO meeting-to-fulfillment journey and isolated provider file restore passed. Workbook clipping was fixed and deployed;585 tests and13 integrated scenarios pass. Google document access and report export work for the CEO account. Diary requires calendar-specific consent through its booking-access button. See the final controlled-journey record in [P12](implementation/P12.md).
