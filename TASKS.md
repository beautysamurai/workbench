# Workbench Task Board

This is the living prioritized queue. Keep only one primary repair task in progress unless independent work is intentionally parallelized.

States: `pending` · `in progress` · `blocked` · `done`

## Current focus

### P0-001 — Fix critical error

- **State:** done
- **Objective:** To enable this application to start a workspace to enhance oneself.
- **Reported or observed symptom:** ![alt text](image-1.png),![alt text](image-2.png)
- **Acceptance criteria:**
  - [x] This error goes away.
  - [x] We can start a workspace to enhance this app.
  - [x] Doesn't report reasoning status in the log like above.
- **Evidence:** Codex CLI 0.150.1 reproduced JSON-RPC `-32600` for invalid `onRequest` and `workspaceWrite` thread-start values. After boundary serialization was corrected, the same installed app-server created an ephemeral thread in `/home/kabes/repository/workbench`. The renderer now excludes both hydrated reasoning items and streamed `item/reasoning/*` notifications while retaining agent messages; focused regression tests, `npm run check`, the production build, and a bounded Electron launch passed.
- **Hypothesis:** Confirmed root causes: Workbench sent UI/domain spellings unchanged across a Codex app-server boundary whose approval and top-level thread-sandbox values use different wire spellings, and the renderer promoted empty internal reasoning lifecycle items into visible transcript rows.
- **Next action:** P0-002 — GUI enhancement for coding projects.
- **Blocker:** None established.

### P0-002 — GUI enhancement for coding projects

- **State:** done
- **Objective:** To make coding projects user-friendly.
- **Reported or observed symptom:** Hard to use the app.
- **Acceptance criteria:**
  - [x] Model should be selected easily.
  - [x] For a coding project, it should load markdown system and also create such a system by default. And should have a clear and easy slot to write tasks and pop/offer task queues not from markdowns directly but on GUI.
  - [x] Should display the rest usage limit.
- **Evidence:** The installed Codex catalog now populates workspace-level model and reasoning controls, and the selected values flow into thread/resume/turn requests. New workspaces default to safe, non-overwriting setup of `AGENTS.md`, `TASKS.md`, and `WORKBENCH_PROGRESS.md`; the dashboard parses the queue, adds tasks through a GUI form, and offers them to the Codex composer. Primary remaining usage and reset time load from app-server responses and rolling notifications. Focused tests, strict checks, production build, live launch, and an offscreen production-renderer journey all passed.
- **Hypothesis:** Confirmed. A typed metadata bridge plus a fixed-filename, `realpath`-guarded Markdown service provides the requested UX without making renderer file access broad or replacing Markdown as the durable project record.
- **Next action:** P0-003 — Establish a trustworthy automated verification baseline.
- **Blocker:** None established.

### P1-004 — GUI bugfix

- **State:** pending
- **Objective:** To fix GUI bugs
- **Reported or observed symptom:** Full screen mode doesn't work well.
- **Acceptance criteria:**
  - [ ] Full screen, a small window can be switched to each other without problem.
- **Evidence:** 
- **Hypothesis:** 
- **Next action:** 
- **Blocker:** 


## Queue

| Priority | ID | State | Task | Completion evidence |
|---|---|---|---|---|
| P0 | P0-003 | in progress | Establish a trustworthy automated verification baseline | Script inventory plus exact type/test/lint/build results; add only high-value missing checks |
| P0 | P0-004 | pending | Review main/preload/renderer and IPC security | Applicable Electron-security checklist items evidenced or explicitly unavailable; focused tests where practical |
| P1 | P1-001 | pending | Verify terminal and process lifecycle | Applicable terminal checklist items evidenced or explicitly unavailable, including CWD, I/O, cancel, restart, and cleanup |
| P1 | P1-002 | pending | Verify workspace behavior and path handling | Applicable workspace checklist items evidenced or explicitly unavailable, including path boundaries and platform forms |
| P1 | P1-003 | pending | Review Codex integration end to end | Applicable Codex checklist items evidenced or explicitly unavailable, including security and stale-process events |
| P2 | P2-001 | pending | Review and improve core UI/UX | Applicable UI/UX checklist items evidenced or explicitly unavailable across primary, empty, error, keyboard, resize, and reload states |
| P2 | P2-002 | pending | Reconcile setup, user, and architecture documentation | Documentation matches verified behavior, commands, environment, and limitations |
| P2 | P2-003 | done | Add pull-request delivery and automated Copilot reflection workflow | Workflow covers safe synchronization, feature-branch push, PR review, finding disposition, fixes, and automatic re-review |

## New task template

### P?-NNN — Short outcome

- **State:** pending
- **Objective:**
- **Reported or observed symptom:**
- **Scope:**
- **Out of scope:**
- **Acceptance criteria:**
  - [ ]
- **Evidence:**
- **Hypothesis:**
- **Next action:**
- **Blocker:** None established.

## Maintenance rules

- Promote a task to `in progress` only when active work begins.
- Mark it `done` only when every applicable acceptance criterion has evidence.
- If a criterion is unavailable, state why and record the smallest remaining verification.
- Use `blocked` only under the genuine-blocker rules in `AGENTS.md`.
- Split broad discoveries into small outcome-based tasks instead of silently expanding scope.
- Do not use this board as the evidence log; append detailed session evidence to `WORKBENCH_PROGRESS.md`.
