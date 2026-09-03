# Workbench Engineering Progress

This file contains a mutable current-state summary followed by an append-only engineering evidence log. Update the summary when needed, but never rewrite or delete prior session entries. Do not include secrets, tokens, full environment dumps, or sensitive prompts.

Result vocabulary: `passed` · `failed` · `not run` · `unavailable`

## Current state

- **Active task:** P0-002 — GUI enhancement for coding projects (`in progress` at PR #5 exact-head review correction)
- **Next task:** P0-004 — Review main/preload/renderer and IPC security
- **Verified state:** P0-002 is locally complete with structured tasks, durable IDs, and safe image attachments, including bounded decoding of lossless WebP streams; merged P1-004 now also gives consistently scaled WSLg fullscreen exact host pointer coordinates, restores prior bounds, handles mixed or changing layouts safely, and keeps model/reasoning choices isolated per thread
- **Next action:** Publish the accepted image-stream exact-head review correction, then require fresh CI and automated re-review on PR #5
- **Genuine blocker:** None established

## Imported historical context — not current verification

- A previous WSL shell reported Node `v18.19.1`.
- During `npm run dev`, Electron installation reported `ERR_REQUIRE_ESM` for `@electron/get`, then reported a partial/failed Electron installation.
- The proposed lead was to use Node 22 or newer and reinstall dependencies in the same WSL environment.
- Codex must verify all of this against the current repository, lockfile, shell, and error output before changing anything.

---

## Session entry template

Copy this section to the end of the file for every work session.

### YYYY-MM-DD HH:MM TZ — Task ID and short outcome

**Environment**

- Platform / WSL distribution:
- Node version and executable:
- Package manager version and executable:
- Electron version:
- Commit / branch:
- Initial `git status --short` summary:

**Observed behavior**

- Goal or reported symptom:
- Reproduction command:
- Expected:
- Actual:
- Exit code and first meaningful error:

**Diagnosis**

- Classification:
- Evidence:
- Hypothesis:
- Disconfirming check:
- Root cause:

**Changes**

- Files changed:
- Rationale:
- User-visible effect:
- Security or compatibility considerations:

**Verification**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| not run | focused regression check | |
| not run | type check | |
| not run | tests | |
| not run | lint/static analysis | |
| not run | production build | |
| not run | Electron smoke test | |

**Closeout**

- Final `git status --short` / diff summary:
- Remaining risks or unverified behavior:
- Task-board update:
- Changelog/docs update:
- Next action:
- Blocker and smallest user action needed, if any:

---

## Session entries

Append new entries below this heading. Keep commands and outcomes exact; concise excerpts are preferable to pasted full logs.

### 2026-08-29 11:38 JST — P0-001 restored Codex thread startup

**Environment**

- Platform / WSL distribution: WSL2, Ubuntu-24.04, Linux x64 (`6.6.87.2-microsoft-standard-WSL2`)
- Node version and executable: `v22.23.2`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/node`
- Package manager version and executable: npm `10.9.8`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/npm`; npm selected from `package-lock.json`
- Electron version: `44.0.0` (`npm ls electron @electron/get --depth=1` passed)
- Codex version and executable: `codex-cli 0.150.1`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/codex`
- Commit / branch: `ccdb8df` / `master`
- Initial `git status --short` summary: modified `CHANGELOG.md`; untracked operating documents, screenshot, `package-lock.json`; no pre-existing source changes

**Observed behavior**

- Goal or reported symptom: selecting **Start a Codex thread** displayed `Invalid request: unknown variant onRequest` instead of creating a workspace thread.
- Reproduction command: bounded Node JSONL harness spawning `codex app-server`, completing `initialize` / `initialized`, then sending `thread/start` with `cwd: "/home/kabes/repository/workbench"`, `approvalPolicy: "onRequest"`, `sandbox: "workspaceWrite"`, and `serviceName: "workbench"`.
- Expected: a new thread rooted in the selected workspace.
- Actual: Codex rejected `onRequest`; after correcting that value alone, it rejected `workspaceWrite`.
- Exit code and first meaningful error: harness exit `0` for the expected first rejection, JSON-RPC `-32600` (`unknown variant onRequest`); corrected-policy smoke exit `2`, JSON-RPC `-32600` (`unknown variant workspaceWrite`). A first sandboxed reproduction attempt exited `1` before the request because the sandbox could not initialize Codex state under `~/.codex`; the same bounded harness was then run with approval outside that sandbox.

**Diagnosis**

- Classification: Codex app-server protocol serialization mismatch at the main-process IPC boundary.
- Evidence: the exact CLI-generated TypeScript schema accepts approval policies `untrusted`, `on-request`, a granular object, or `never`, and top-level thread sandbox modes `read-only`, `workspace-write`, or `danger-full-access`. Workbench passed camelCase UI/domain values directly at all approval call sites and used the nested sandbox-policy spelling for the top-level thread field.
- Hypothesis: translating Workbench approval settings explicitly and using the distinct thread sandbox wire value will unblock thread creation without migrating persisted settings.
- Disconfirming check: the same installed app-server would still reject a corrected ephemeral `thread/start` request.
- Root cause: confirmed. The corrected request returned a real ephemeral thread with `approvalPolicy: "on-request"`, `cwd: "/home/kabes/repository/workbench"`, and workspace-write sandboxing.

**Changes**

- Files changed: `src/main/codex-protocol.ts`, `src/main/ipc.ts`, `tests/codex-protocol.test.ts`, `tsconfig.test.json`, `README.md`, `docs/ARCHITECTURE.md`, `TASKS.md`, `WORKBENCH_PROGRESS.md`, `CHANGELOG.md`
- Rationale: keep stable UI/persisted values while explicitly serializing the protocol's non-uniform wire values at the narrow main-process boundary.
- User-visible effect: starting or resuming a Codex thread and starting a turn no longer fails because of invalid approval-policy or thread-sandbox enum values.
- Security or compatibility considerations: workspace-write isolation and disabled sandbox network access remain unchanged. The mapping covers the value intersection supported by both the reported Codex 0.147 behavior and the installed 0.150.1 schema; the nested `turn/start` sandbox policy intentionally remains `workspaceWrite`.

**Verification**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests` | Focused test compilation completed with exit `0`. |
| passed | `node --test dist-test/tests/codex-protocol.test.js` | Approval mappings and the thread sandbox mode passed. |
| passed | `npm run check` | Main and renderer strict type checks plus all five compiled test files passed; exit `0`. |
| unavailable | lint/static analysis | No lint script exists in `package.json`. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | bounded Node JSONL app-server smoke with `approvalPolicy: "on-request"`, `sandbox: "workspace-write"`, `ephemeral: true` | Installed Codex 0.150.1 returned a thread with `ephemeral: true`; harness exit `0`. |
| passed | `npm start -- --enable-logging=stderr`, then Ctrl+C after 10 seconds | Electron remained running under WSLg until the intentional SIGINT. DBus/GPU environment warnings were non-fatal. |
| passed | `pgrep -af '[e]lectron.*(/home/kabes/repository/workbench|electron \\.)'`; matching npm/smoke-process checks | Each returned exit `1` with no output after shutdown, confirming no test process remained. |

**Closeout**

- Final `git status --short` / diff summary: source changes are limited to the protocol adapter, three IPC call sites, and focused test inclusion; operating records and relevant docs were updated. Pre-existing untracked files and the user's changelog restructuring were preserved.
- Remaining risks or unverified behavior: the native Windows `wsl.exe` transport and a mouse-driven GUI click were not exercised in this WSL session; the shared JSONL payload itself was verified against the exact local Codex installation, and Electron launch was verified separately.
- Task-board update: P0-001 marked `done`; both acceptance criteria checked.
- Changelog/docs update: added the verified fix and corrected protocol spellings in README/architecture documentation.
- Next action: P0-002 — establish a trustworthy automated verification baseline.
- Blocker and smallest user action needed, if any: none.

### 2026-08-29 14:50 JST — P0-001 removed reasoning-status transcript noise

**Environment**

- Platform / WSL distribution: WSL2, Ubuntu-24.04, Linux x64 (`6.6.87.2-microsoft-standard-WSL2`)
- Node version and executable: `v22.23.2`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/node`
- Package manager version and executable: npm `10.9.8`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/npm`; npm selected from `package-lock.json`
- Electron version: `44.0.0`; `npm ls electron @electron/get --depth=1` reported Electron 44.0.0 with `@electron/get` 5.1.0
- Commit / branch: `ccdb8df` / `master`
- Initial `git status --short` summary: existing modified changelog, README, architecture, IPC, and test configuration; existing untracked operating records, screenshots, lockfile, protocol adapter, and protocol test

**Observed behavior**

- Goal or reported symptom: stop filling the Codex conversation log with repeated blank **Codex reasoning** status rows.
- Reproduction command: `npm run build`, followed by the current renderer-path trace in `src/renderer/main.ts` and inspection of `image-1.png`.
- Expected: internal reasoning lifecycle traffic stays out of the user transcript; user-facing commentary, commands, diffs, and final responses remain visible.
- Actual: every hydrated `reasoning` item normalized to a transcript entry, including empty summaries, and every `item/reasoning/summaryTextDelta` could create or extend another visible reasoning entry. Empty entries rendered as typing indicators.
- Exit code and first meaningful error: build exit `0`; this was a deterministic renderer-state defect rather than a command failure.

**Diagnosis**

- Classification: Codex event normalization and renderer transcript filtering.
- Evidence: `normalizeCodexItem` returned a `reasoning` entry without checking for visible content, the streaming handler independently upserted reasoning entries, and `renderCodexEntry` labeled them **Codex reasoning**. The supplied screenshot showed the resulting repeated empty rows.
- Hypothesis: filter reasoning items at both hydration and notification boundaries, leaving the existing single generic working indicator as progress feedback.
- Disconfirming check: a reasoning item or `item/reasoning/*` notification would still be considered transcript-visible, or an agent message would be filtered with it.
- Root cause: confirmed; internal reasoning protocol events were treated as user-facing transcript messages.

**Changes**

- Files changed: `src/renderer/codex-transcript.ts`, `src/renderer/main.ts`, `tests/codex-transcript.test.ts`, `tsconfig.test.json`, `TASKS.md`, `WORKBENCH_PROGRESS.md`, `CHANGELOG.md`
- Rationale: enforce the product decision at a small pure boundary shared by hydrated items and streaming notifications, and remove the now-unreachable reasoning presentation path.
- User-visible effect: Codex conversations no longer show repeated reasoning-status rows; the generic working indicator and public Codex messages remain.
- Security or compatibility considerations: no IPC, sandbox, preload, process, workspace, or Markdown-rendering behavior changed; unknown non-reasoning event types retain their prior behavior.

**Verification**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/codex-transcript.test.js` | Empty reasoning items and multiple reasoning notification forms were hidden; agent messages remained visible; exit `0`. |
| passed | `npm run check` | Strict main/renderer type checks and all six compiled test files passed; exit `0`. |
| unavailable | lint/static analysis | No lint script exists in `package.json`. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | `rg -n "Codex reasoning|type: 'reasoning'|item/reasoning|reasoningSummary" src tests dist/renderer -g '*.ts' -g '*.js'` | No reasoning role or entry construction remains in source/build output; only the deliberate filter and regression assertions matched. |
| passed | `npm start -- --enable-logging=stderr`, observed for 5 seconds, then Ctrl+C | Electron stayed running under WSLg until the intentional SIGINT. DBus/GPU environment warnings were non-fatal. |
| passed | `pgrep -ax electron`; `pgrep -ax npm`; `pgrep -ax codex` | Each returned exit `1` with no output after shutdown. |

**Closeout**

- Final `git status --short` / diff summary: the renderer change is limited to a pure two-rule transcript filter, removal of the reasoning presentation path, and focused tests; existing protocol-boundary changes and user files were preserved.
- Remaining risks or unverified behavior: a mouse-driven real-thread journey was not automated. Remote-debugging/background-controller attempts were unavailable because Chromium's Linux sandbox aborted under that controller, while the ordinary foreground Electron launch passed. Hydration and streaming behavior are covered deterministically by the new filter checks.
- Task-board update: P0-001 marked `done`; all three acceptance criteria have current evidence.
- Changelog/docs update: changelog records the user-visible transcript cleanup; no setup or architecture behavior changed.
- Next action: P0-002 — GUI enhancement for coding projects.
- Blocker and smallest user action needed, if any: none.

### 2026-08-29 16:19 JST — P0-002 added coding-project GUI workflow

**Environment**

- Platform / WSL distribution: WSL2, Ubuntu-24.04, Linux x64
- Node version and executable: `v22.23.2`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/node`
- Package manager version and executable: npm `10.9.8`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/npm`; npm selected from `package-lock.json`
- Electron version: `44.0.0`
- Codex version and executable: `codex-cli 0.150.1`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/codex`
- Commit / branch: `ccdb8df` / `master`
- Initial `git status --short` summary: preserved the active P0-001 source, documentation, test, screenshot, lockfile, and operating-record changes; P0-002 began without cleaning or resetting them

**Observed behavior**

- Goal or reported symptom: make coding workspaces easier to use by exposing model selection, a Markdown-backed task workflow, GUI task entry/offering, and remaining usage.
- Reproduction command: source search for `model/list`, account rate limits, and a project/task-system integration across `src` returned exit `1` before the change, while the existing `npm run check` baseline passed.
- Expected: those operations are available from the Workbench GUI and remain workspace-scoped.
- Actual: the dashboard and Codex UI previously had no model catalog, usage-limit state, project Markdown setup, or task queue controls.

**Diagnosis**

- Classification: renderer UX plus narrow preload/main-process integration.
- Evidence: official Codex app-server documentation and the installed 0.150.1 generated schema expose `model/list`, `account/rateLimits/read`, `account/rateLimits/updated`, and model/effort fields on thread and turn requests. Existing workspace persistence and IPC had no corresponding fields or handlers.
- Hypothesis: a typed metadata bridge plus a fixed-filename, `realpath`-guarded Markdown service can provide the requested GUI without broad renderer file access or replacing Markdown as the durable record.
- Disconfirming check: model/effort values would not reach Codex requests, existing Markdown would be overwritten, a symlink escape would be followed, usage would not update, or the production renderer journey would fail.
- Root cause: confirmed feature gap; the app had thread execution but no discovery/persistence/UI layer for these coding-project controls.

**Changes**

- Files changed: `src/shared/types.ts`, `src/main/store.ts`, `src/main/project-system.ts`, `src/main/ipc.ts`, `src/main/preload.ts`, `src/renderer/codex-metadata.ts`, `src/renderer/main.ts`, `src/renderer/mock-api.ts`, `src/renderer/styles.css`, focused tests and test configuration, `README.md`, `docs/ARCHITECTURE.md`, `TASKS.md`, `WORKBENCH_PROGRESS.md`, `CHANGELOG.md`
- Rationale: keep filesystem and Codex protocol operations in the main process, expose only task-specific typed methods, and make live metadata and Markdown state understandable in the renderer.
- User-visible effect: workspaces have model/reasoning selectors; the dashboard and Codex toolbar show remaining primary usage and reset time; new workspaces default to creating only missing `AGENTS.md`, `TASKS.md`, and `WORKBENCH_PROGRESS.md`; the dashboard loads the queue, adds tasks, and offers a selected task to the Codex composer.
- Security or compatibility considerations: renderer Node access remains disabled. Project operations use fixed filenames, resolve the workspace and targets with `realpath`, refuse out-of-root symlinks, normalize appended task text, and never replace existing files. Existing persisted workspaces migrate to null model/effort values and are repaired from the live catalog.

**Verification**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node dist-test/tests/project-system.test.js` | Parser, non-overwriting initialization/task append, and unsafe-symlink refusal passed; exit `0`. |
| passed | `npm run check` | Strict main/renderer type checks and all eight compiled test files passed; exit `0`. |
| unavailable | lint/static analysis | No lint script exists in `package.json`. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | `npm start -- --enable-logging=stderr`, observed and stopped with Ctrl+C | Electron stayed running under WSLg. The live installed Codex catalog loaded and persisted its default `gpt-5.6-sol` / `low` preference. A deliberately stale saved project root produced an IPC error without modifying files or crashing the app. DBus/GPU warnings were non-fatal. |
| passed | `node_modules/.bin/electron /tmp/workbench-renderer-smoke.cjs` | Offscreen production UI verified the default setup checkbox, GUI task submission, two model options, saved Terra/medium selection, 66% remaining usage in both views, and no horizontal overflow at 1180px; exit `0`, no renderer failures. |
| passed | visual inspection of `/tmp/workbench-renderer-overview.png` and `/tmp/workbench-renderer-codex.png` | Task queue, task-entry form, Send to Codex controls, model/reasoning selectors, and usage/reset display rendered legibly in the built application. |
| passed | `git diff --check` | No whitespace errors. |

**Closeout**

- Final `git status --short` / diff summary: P0-002 adds the project service, metadata helper, typed bridge/state fields, renderer controls, styles, and focused tests while preserving all prior P0-001 and user-created files.
- Remaining risks or unverified behavior: the native Windows `wsl.exe` transport and a mouse-driven authenticated turn using a newly selected model were not exercised in this WSL session. The exact installed schema, live catalog connection, IPC payload construction, deterministic production renderer, and persistence paths were verified.
- Task-board update: P0-002 marked `done`; all three acceptance criteria checked.
- Changelog/docs update: added the completed user-visible features and documented setup, behavior, trust boundaries, state, and failure handling.
- Next action: P0-003 — Establish a trustworthy automated verification baseline.
- Blocker and smallest user action needed, if any: none.

### 2026-08-29 JST — P2-003 added PR delivery and Copilot reflection workflow

**Observed behavior**

- Goal: extend the local closeout workflow through safe Git synchronization, feature-branch push, GitHub pull request review, and an automated Copilot re-review loop.
- Actual before change: the workflow stopped after local diff review and records; `AGENTS.md` prohibited commit/push without a separate explicit request and contained no remote review/reflection procedure.

**Changes**

- Files changed: `AGENTS.md`, `CODEX_WORKFLOW.md`, `REVIEW_CHECKLIST.md`, `.github/copilot-instructions.md`, `TASKS.md`, `WORKBENCH_PROGRESS.md`.
- Result: implementation work may be delivered through a scoped feature branch and pull request; the workflow now uses pull only for a safe fast-forward of its tracked branch, otherwise fetches and synchronizes deliberately, pushes without force, waits for CI and Copilot, dispositions every finding, fixes accepted findings, and repeats through automatic review of new pushes.
- GitHub configuration prerequisite: an administrator must enable an active branch ruleset with **Automatically request Copilot code review** and **Review new pushes**. Copilot comments remain advisory and do not replace human approval.

**Verification**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| passed | `git diff --check` | Documentation and instruction additions contain no whitespace errors. |
| passed | manual cross-reference review | Operating guide, workflow, checklist, Copilot instructions, task state, and progress record describe one consistent PR/reflection loop. |
| not run | remote push / pull request / Copilot review | This task changes the workflow; it does not authorize publishing the current dirty worktree or changing GitHub repository settings. |

**Closeout**

- Task-board update: P2-003 added as done.
- Changelog/docs update: no changelog entry; this is an engineering-process change rather than user-visible application behavior.
- Remaining action: a repository administrator enables the GitHub branch ruleset; subsequent remotely delivered tasks exercise and record the loop.

### 2026-08-29 20:25 JST — P0-002 completed structured task composition

**Environment**

- Platform / WSL distribution: WSL2, Ubuntu-24.04, Linux x64 (`6.6.87.2-microsoft-standard-WSL2`)
- Node version and executable: `v22.23.2`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/node`
- Package manager version and executable: npm `10.9.8`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/npm`; npm selected from `package-lock.json`
- Electron version: `44.0.0`
- Commit / branch: `4da6c4b` / `main`
- Initial `git status --short` summary: modified `TASKS.md` plus untracked user screenshot `image-3.png`; no pre-existing source changes

**Observed behavior**

- Goal or reported symptom: the task queue in `image-3.png` was flat, had no image-paste target or explicit priority field, exposed priority-like IDs, and did not automatically increase human-readable IDs.
- Reproduction command: `npm run build:tests && node --test dist-test/tests/project-system.test.js`, followed by a bounded Node probe importing the compiled `parseProjectTasks` and `formatProjectTask` functions with the `P?-NNN` template and a new example task.
- Expected: the placeholder is ignored; new IDs increase independently from priority; parent structure and task images are first-class fields.
- Actual: the existing focused tests passed, but the probe parsed `P?-NNN` as a task and formatted the example with a random `WB-74F63700`-style UUID fragment. The shared task model had no priority, parent, criteria, or attachment fields, and the renderer showed a flat title/objective form.
- Exit code and first meaningful error: exit `0`; this was a verified feature/data-model gap rather than a crashing command.

**Diagnosis**

- Classification: renderer UX, Markdown schema, main-process persistence, and cross-process ID integrity.
- Evidence: `ProjectTask` only modeled ID/title/state/objective; `formatProjectTask` used `randomUUID`; the heading parser accepted the template; `runWslCommand` had no stdin path; and the renderer did not retain task-composer fields across normal rerenders.
- Hypothesis: explicit structured Markdown fields plus a derived tree can keep `TASKS.md` human-editable, while main-process byte validation, fixed workspace paths, and durable locked sequence metadata can safely support images and monotonic IDs.
- Disconfirming check: a placeholder or metadata-looking criterion would still become structure, simultaneous processes would receive the same ID, deletion would reuse an ID, an unsafe symlink would be written, failed appends would leave silent image orphans, a background refresh would erase the draft/caret, or the production renderer journey would fail.
- Root cause: confirmed feature gap. The original task representation, UUID allocator, broad parser, and flat ephemeral form could not express or safely persist the requested workflow.

**Changes**

- Files changed: `src/shared/types.ts`, `src/main/project-system.ts`, `src/main/wsl.ts`, `src/renderer/main.ts`, `src/renderer/project-tasks.ts`, `src/renderer/mock-api.ts`, `src/renderer/icons.ts`, `src/renderer/styles.css`, `tests/project-system.test.ts`, `tests/project-tasks.test.ts`, `tsconfig.test.json`, `README.md`, `docs/ARCHITECTURE.md`, `TASKS.md`, `WORKBENCH_PROGRESS.md`, and `CHANGELOG.md`. User-created `image-3.png` was preserved unchanged.
- Rationale: keep priority separate from identity, store a flat parent-ID model in Markdown, derive the hierarchy in a pure renderer helper, and keep all filesystem mutation behind the existing narrow project IPC boundary.
- User-visible effect: the composer exposes P0–P3 priority, optional parent, objective, acceptance criteria, and a keyboard-focusable paste/drop/file image slot with retained previews. Tasks render as arbitrary-depth semantic nested lists, receive durable `WB-NNN` IDs, and send priority/parent/criteria/image context to Codex.
- Security or compatibility considerations: legacy `P0-001` IDs remain readable and infer priority when no explicit field exists. New IDs reserve an atomic `.workbench/task-sequence` high-water value under a stable `flock`; duplicate/missing/cyclic parent chains are rejected for new children. The main process limits image count and bytes, checks container signatures/structure/dimensions, generates filenames, rejects unsafe or non-regular metadata paths, streams bytes via a non-profile shell's stdin, and surfaces cleanup failures.

**Verification**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js dist-test/tests/project-tasks.test.js` | Structured parse/format, placeholder exclusion, parent tree/cycle/orphan handling, byte-exact PNG persistence, invalid metadata/images, unsafe symlinks, append cleanup, deletion high-water behavior, and same-process/multiprocess ID contention passed. |
| passed | `npm run check` | Strict main/renderer type checks and all nine compiled test files passed; exit `0`. |
| unavailable | lint/static analysis | No lint script exists in `package.json`. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | `node_modules/.bin/electron /tmp/workbench-structured-task-smoke.cjs` | Production renderer showed four priorities and automatic IDs, retained every draft field plus objective caret through refresh, previewed a pasted PNG, nested `WB-103` under its parent, advanced to `WB-104`, re-enabled controls, and included priority/parent/image context in the Codex prompt; exit `0`, no renderer failures or horizontal overflow at 1180px. |
| passed | visual inspection of `/tmp/workbench-structured-task-overview.png` | Priority controls, labeled structure fields, paste target, nested task rows, and actions rendered legibly in the built application. |
| passed | `npm start -- --enable-logging=stderr`, observed for 10 seconds, then Ctrl+C | Electron remained running under WSLg until the intentional SIGINT. DBus/GPU environment warnings were non-fatal. |
| passed | post-launch `pgrep` checks for the Electron app, npm start, and `codex app-server` | Each returned exit `1` with no output; no smoke process remained. |
| passed | `git diff --check` | No whitespace errors. |

**Closeout**

- Final `git status --short` / diff summary: task-scoped source, test, documentation, task-board, progress, and changelog changes remain uncommitted on `main`; the user's `image-3.png`, P1-004 acceptance criterion, and queue renumbering are preserved.
- Remaining risks or unverified behavior: real Windows Snipping Tool clipboard input and the native `wsl.exe` byte transport were not available in this WSL session. Cross-process locking passed on the current Linux filesystem; coordination for two distributions simultaneously addressing the same DrvFS directory was not exercised. A local process that maliciously swaps checked paths at syscall boundaries remains outside the current shell-based hardening model.
- Task-board update: P0-002 remains `done`; both newly supplied acceptance criteria are checked with current evidence.
- Changelog/docs update: README and architecture describe task fields, images, sequence metadata, utilities, storage, and trust boundaries; the changelog records the completed user-visible and security changes.
- Next action: P0-004 — establish a trustworthy automated verification baseline.
- Blocker and smallest user action needed, if any: none.

### 2026-08-29 21:27 JST — P2-003 made pull-request delivery opt-out rather than opt-in

**Observed behavior**

- Goal: make branch creation, scoped commit/push, pull-request creation, CI inspection, and automated review the default closeout for repository-changing tasks.
- Actual before change: `AGENTS.md` described a pull request as normal but `CODEX_WORKFLOW.md` applied publishing only “when remote delivery is in scope,” so the absence of a separate push/PR request was treated as no authorization.
- Existing worktree: completed but uncommitted P0-002 source/docs/tests plus user-created `image-3.png`; all were preserved and excluded from this delivery.

**Changes**

- Branch / pull request: `codex/automate-pr-delivery`; https://github.com/beautysamurai/workbench/pull/1.
- Files delivered: `AGENTS.md`, `CODEX_WORKFLOW.md`, `REVIEW_CHECKLIST.md`, and this scoped `WORKBENCH_PROGRESS.md` entry only.
- Result: repository-changing tasks now default to an early feature branch and the scoped commit/push/PR/review loop unless the user explicitly opts out or a genuine blocker remains. Merge, release, branch deletion, force-push, and protection overrides remain separately authorized.
- Audit refinements: required CI must pass; preserved dirty work has an auxiliary-worktree delivery path; follow-up task records are review metadata but their implementation uses a separate branch; and review of the final task commit is reported without creating an endless evidence-only push/re-review cycle.

**Verification and review**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `git diff --check -- AGENTS.md CODEX_WORKFLOW.md REVIEW_CHECKLIST.md` | No whitespace errors. |
| passed | scoped branch/commit review against `origin/main` | Original commit `ac1b895` changed exactly the three workflow Markdown files; unrelated working-tree files remained unstaged and unpublished. |
| passed | GitHub automated review of `ac1b895` | Completed with no review comments or unresolved threads. |
| passed | independent workflow-doc audit | Five ambiguities were accepted and corrected: review-loop termination, genuine-blocker scope, dirty-worktree synchronization, CI success semantics, and follow-up-task scope. |
| failed — pre-existing baseline | Windows workflow runs `33241495957` on base `4da6c4b` and `33252200480` on the PR | Both fail the same two unchanged WSL-dependent project-system tests because the hosted runner has no `Local Linux` distribution; `dist:win` is skipped. P0-004 already tracks the verification-baseline repair. |

**Closeout**

- Task-board update: no new queue item; this clarifies the completed P2-003 workflow, and the unrelated CI baseline remains P0-004.
- Changelog/docs update: no changelog entry because this is an engineering-process change, not user-visible application behavior.
- Delivery state: pull request open; the final follow-up commit requires automated re-review. Required Windows CI remains a recorded genuine blocker to delivery completion until P0-004 fixes the baseline and the PR reruns successfully.

**Automated review follow-up**

- Review of `efac13d` accepted one P2 finding: the published task board calls the verification-baseline task P0-003, while the preserved unpublished P0-002 work renumbers it to P0-004.
- The pull-request record is corrected to the published P0-003 identifier without staging the unrelated task-board renumbering. The correction commit requires one final automated re-review; its final state will be reported in the pull request and handoff without another evidence-only commit.
- Review of `d5df121` accepted two further P2 findings: the delivery inventory omitted this progress entry, and the synchronization procedure created the scoped commit after the step that required it. The inventory now lists all four delivered Markdown files, and commit creation now precedes rebase or auxiliary-worktree cherry-picking.

**Erratum**

- The P0-004 references in the closeout above reflect the preserved unpublished task-board renumbering that was present when this entry was drafted. The task published in this pull request's base is P0-003; use P0-003 for the Windows CI baseline repair.
- Required Windows CI remains failed and delivery remains incomplete pending that actionable P0-003 repair. It is not a genuine blocker under `AGENTS.md`, because no unavailable user input or external dependency prevents the repair.

### 2026-08-29 22:00 JST — P0-003 repaired the automated verification topology

**Environment**

- Platform / WSL distribution: WSL2, Ubuntu-24.04, Linux x64
- Node version: `v22.23.2`
- Package manager: npm `10.9.8`, selected from `package-lock.json`
- Base commit / branch: `4da6c4b` / `codex/fix-windows-ci-baseline`
- Working tree: clean auxiliary worktree created from `origin/main`; unrelated P0-002 and user-created changes in the primary worktree were not staged, stashed, or modified

**Observed behavior**

- Goal: restore meaningful repository CI for pull requests without weakening or skipping the project-system integration tests.
- Reproduction: GitHub Actions run `33253151035`, job `99102187447`, failed `npm run check` on Windows after 22 of 24 tests passed; `npm run dist:win` and artifact upload were skipped.
- Baseline evidence: the same two project-system tests failed on unchanged `main` commit `4da6c4b` in run `33241495957`, so the failure predates pull request #1.
- Expected: repository verification executes in an environment that provides the POSIX filesystem and Bash behavior used by the project-system service, while the Windows installer is still built on Windows.
- Actual: one Windows job ran the full test suite before packaging. The project fixture names a synthetic `Local Linux` distribution, causing production transport to call `wsl.exe -d "Local Linux"` on a hosted runner that does not provide it.

**Diagnosis**

- Classification: CI topology / platform-assumption defect.
- Root cause: the security-sensitive project-system tests exercise Bash, Linux paths, `realpath`, and symlink boundaries through the production WSL transport. Running them directly on an unprovisioned Windows host is neither portable nor representative, and their failure prevented independent installer evidence.
- Rejected shortcuts: no platform skip, mocked-success replacement, test weakening, or hosted-runner WSL installation was added.

**Changes**

- Files changed: `.github/workflows/build.yml`, `TASKS.md`, and this append-only progress record.
- The workflow now runs `npm ci` plus `npm run check` in an Ubuntu verification job.
- A separate Windows job runs `npm ci`, `npm run dist:win`, and artifact upload independently, so verification and installer evidence are both retained.
- P0-003 is marked `in progress` until the new remote jobs and final automated review complete.
- No changelog entry was added because this changes engineering verification, not application behavior.

**Verification**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm ci` | Clean lockfile-based dependency install completed; exit `0`. |
| passed | `npm run check` | Strict main/renderer type checks and all eight compiled test files passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | `node -e "const fs=require('node:fs'); const yaml=require('js-yaml'); yaml.load(fs.readFileSync('.github/workflows/build.yml','utf8')); console.log('workflow yaml parsed')"` | `.github/workflows/build.yml` parsed successfully; exit `0`. |
| passed | `git diff --check` | No whitespace errors; exit `0`. |
| unavailable locally | `npm run dist:win` | Native Windows packaging is assigned to the new Windows CI job; this WSL session is not recorded as Windows evidence. |
| pending | GitHub Actions and automated pull-request review | The focused branch has not yet been published at this point in the record. |

**Current state**

- Remaining risk: Ubuntu validates the real POSIX project-store behavior but not the Windows-to-WSL envelope or DrvFS semantics; those require a provisioned Windows+WSL runner or manual smoke environment.
- Repository policy gap: active ruleset `21797957` requests Copilot review and protects deletion/non-fast-forward updates, but does not currently require either workflow status context; the jobs provide CI evidence without being merge-required checks.
- Next action: publish the focused P0-003 pull request, verify both jobs, disposition automated review findings, then mark the task done if the final head is green.
- Blocker: none established.


### 2026-08-29 22:20 JST — P0-003 retained portable Windows test coverage

**Remote evidence before review fix**

- Pull request: `#2`, head `7faad0d40f75c662a97af57b6ea864cf9a337230`.
- GitHub Actions run `33254336533` completed successfully: `verify-linux` job `99105323437` passed `npm run check`; `package-windows` job `99105323518` passed `npm run dist:win` and artifact upload.
- Artifact `Workbench-Windows` (`9715349077`) was uploaded at 110,921,354 bytes with digest `sha256:6987ee0e8829121613d825b0749b255f855bf98b22a64608b60b2b6a663dd5b7`.
- Automated Codex review completed on `7faad0d` with one P2 finding: the Windows packaging job no longer ran Windows-compatible tests, so platform-specific regressions outside the WSL integration cases could escape.

**Review disposition and changes**

- Disposition: accepted. Linux-only execution is correct for the two tests that invoke the production WSL/Bash project transport, but it was too broad for the remaining portable suite.
- Moved only those two integration cases into `tests/wsl/project-system.test.ts`; the pure parser/formatter coverage remains in the root portable suite.
- Added reusable `typecheck`, `test:portable`, and `check:portable` package scripts. Full `test`/`check` now explicitly include the nested WSL suite.
- The Windows job now runs `npm run check:portable` before packaging. Root test discovery automatically includes future portable test files without conditionals, test-name exclusions, or an enumerated filename list.
- Updated `README.md` to distinguish native-Windows portable checks from full Linux/WSL checks and to warn against sharing `node_modules` across those environments.
- Files changed for the review fix: `.github/workflows/build.yml`, `package.json`, `tests/project-system.test.ts`, `tests/wsl/project-system.test.ts`, `README.md`, and `WORKBENCH_PROGRESS.md`.
- P0-003 remains in progress until the final Windows portable check, full Linux check, packaging job, and automated re-review pass. No changelog entry was added because the change affects engineering verification rather than application behavior.

**Verification**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run check` | Both TypeScript projects and nine compiled test files passed, including `dist-test/tests/wsl/project-system.test.js`; exit `0`. |
| passed | `npm run check:portable` | Both TypeScript projects and the eight root portable test files passed; the WSL-only file was not selected; exit `0`. |
| passed | `rg --files dist-test/tests` | Confirmed eight root test files and the isolated `dist-test/tests/wsl/project-system.test.js`. |
| passed | `npm run build` | Clean production compilation and asset copy completed after the script/test split; exit `0`. |
| passed | `git diff --check` | No whitespace errors; exit `0`. |
| pending | final GitHub Actions run and automated re-review | The accepted finding fix and completion records have not yet been published at this point in the append-only record. Final pushed-head evidence belongs in PR #2 and the delivery response without another evidence-only commit. |

**Current state**

- Coverage contract: portable type/tests run on both Ubuntu and Windows; WSL/Bash integration tests run for real on Ubuntu; the Windows installer builds and uploads independently.
- Remaining risk: actual `wsl.exe` and DrvFS behavior still require a provisioned Windows+WSL runner or manual smoke environment.
- Review thread: resolve the accepted finding only after the final branch includes this change; request automatic re-review of the new head.
- Merge: not performed; merge authorization remains separate from implementation delivery.
- Blocker: none established.

### 2026-08-29 22:33 JST — P0-003 made test selection explicit and non-vacuous

**Automated re-review finding**

- Re-review completed on PR #2 head `6e1106700d2ebe83b85b8e2c43b4057c7fd7fc13` with one new P2 concern: a shell might pass `dist-test/tests/*.test.js` literally and Node can exit successfully after selecting zero tests.
- Direct Windows evidence qualifies the finding: job `99107209399` ran the exact `npm run check:portable` script and reported tests `1..22`, `pass 22`, `fail 0`. The quoted zero-test reproduction therefore did not match the actual workflow invocation.
- Disposition: partially accepted as baseline hardening. The pushed command was not vacuous, but test selection should not depend on shell/platform glob behavior and an empty suite must fail explicitly.

**Changes**

- Added `scripts/run-tests.cjs`, which validates its mode, deterministically enumerates compiled `.test.js` files, prints the selected inventory, passes explicit paths to the Node test runner without a shell, and fails if no files are selected.
- Portable mode selects only root test files; full mode recursively includes the nested WSL integration suite.
- Full mode also fails if the expected WSL suite is absent, and `scripts/clean-tests.cjs` removes stale compiled tests before every test build.
- Updated `test:portable` and `test` to use the shared enumerator. Type-check and workflow commands remain unchanged.
- Files changed for this re-review response: `package.json`, `scripts/clean-tests.cjs`, `scripts/run-tests.cjs`, and `WORKBENCH_PROGRESS.md`.
- P0-003 remains in progress until both explicit-selection modes and the final remote jobs/re-review pass.

**Verification**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run check:portable` | Type-checked both projects, then printed and passed the eight selected root test files; exit `0`. |
| passed | `npm run check` | Printed all nine selected files, including `dist-test/tests/wsl/project-system.test.js`, then passed the full suite; exit `0`. |
| passed failure path | `node scripts/run-tests.cjs portable` with an empty `dist-test/tests` | Refused the empty selection with `No portable compiled test files found`; exit `1`. |
| passed failure path | `node scripts/run-tests.cjs full` after temporarily moving the generated WSL test file aside | Refused to report a full pass without a WSL integration file; exit `1`; the generated file was restored. |
| passed | create `dist-test/tests/stale.test.js`, then `npm run build:tests` and `test ! -e dist-test/tests/stale.test.js` | The test-only clean removed the stale compiled file before TypeScript rebuilt current sources; exits `0`. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | `node -e "const fs=require('node:fs'); const yaml=require('js-yaml'); yaml.load(fs.readFileSync('.github/workflows/build.yml','utf8')); console.log('workflow yaml parsed')"`; `git diff --check` | Workflow syntax parsed and the diff has no whitespace errors; exits `0`. |
| pending | final GitHub Actions run and automated re-review | Explicit-selection changes have not yet been published at this point in the append-only record. |

**Current state**

- P0-003 remains in progress pending final remote evidence on the explicit enumerator.
- Blocker: none established.

### 2026-08-29 22:43 JST — P0-003 aligned the native Windows setup path

**Remote evidence and review**

- PR #2 head `92718bd8ad75645469f4ca5fe57af3567a78d7e5` passed GitHub Actions run `33255596807`.
- Linux job `99108608271` printed nine explicit files including the WSL integration suite and passed 24 of 24 tests.
- Windows job `99108608213` printed eight explicit portable files and passed 22 of 22 tests, then built the installer and uploaded artifact `9715718791` with digest `sha256:b9514a3e2080bf3e01f32d6ca0d31e4b37b28e7de6e5070f72e098463d931428`.
- Automated re-review accepted the explicit enumerator but found that native `setup.ps1` still invoked full `npm run check`, contradicting the updated README and reintroducing the original WSL-only failure during setup.

**Disposition and change**

- Disposition: accepted. `setup.ps1` is a native Windows entry point and must use the same portable verification contract as the Windows CI job.
- Updated its verification command to `npm run check:portable` and made the setup status message explicit.
- Files changed for this review response: `setup.ps1` and `WORKBENCH_PROGRESS.md`.
- P0-003 remains in progress until the final Windows CI run and automated re-review pass on this setup-aligned head.

**Verification state**

- The exact `npm run check:portable` command passed on native Windows in job `99108608213` with 22 tests; local portable/full/failure/build checks remain green from the preceding entry.
- PowerShell syntax execution is unavailable in this WSL environment because `pwsh` is not installed; the change is a literal npm-command substitution and will be reviewed on the final head.
- Required next checks: `git diff --check`, final GitHub Actions Linux/Windows jobs, artifact upload, and automated re-review.
- Blocker: none established.

### 2026-08-29 22:49 JST — P0-003 completed the automated verification baseline

**Final task-head evidence**

- Pull request #2 task head `dfeacb84e2bcd9c10664a6da3b7683f6d743ec79` passed GitHub Actions run `33255824478`.
- Linux job `99109222700` completed `npm ci` and the full `npm run check` successfully.
- Windows job `99109222775` completed `npm ci`, `npm run check:portable`, `npm run dist:win`, and artifact upload successfully.
- Artifact `Workbench-Windows` (`9715782305`) was uploaded at 110,921,329 bytes with digest `sha256:5fefc23174ba3f2ea6066bc945e0a9724430b7b72e489301c698e9bb6bc68bb4`.
- Automated Codex re-review completed on `dfeacb8` with no new finding. All three earlier threads are resolved: retain Windows-compatible tests was accepted and fixed; shell-independent, fail-closed discovery was accepted as hardening while its zero-test premise was disproved by the Windows job; and native `setup.ps1` was aligned with the portable contract.

**Closeout**

- P0-003 is marked `done`. The baseline now gives independent evidence for full Linux/WSL verification and native-Windows portable verification, installer creation, and artifact upload without skipping or mocking the WSL integration cases.
- Files changed for this records-only closeout: `TASKS.md` and `WORKBENCH_PROGRESS.md`. No changelog entry was added because this is engineering verification rather than user-visible application behavior.
- `git diff --check` passes for the complete branch diff.
- Remaining risk: hosted CI still does not exercise the actual Windows-to-WSL `wsl.exe` envelope or DrvFS behavior; that needs a provisioned Windows+WSL runner or a manual environment. `package.json` has no lint script, so lint remains explicitly unavailable.
- Repository policy note: ruleset `21797957` does not currently require the workflow contexts, although the repository CI evidence is green.
- Merge was not performed; human approval and merge authorization remain separate. After this closeout commit is pushed, its CI and automated review must complete before PR #2 is handed off. Their final state belongs in the pull-request description and delivery response, not another evidence-only commit.
- Next task: P0-004 — Review main/preload/renderer and IPC security.
- Blocker: none established.

### 2026-08-29 23:29 JST — P0-003 reopened after push-event packaging exposed implicit publication

**Correction and reproduction**

- The preceding closeout was premature because it inspected only pull-request-event workflow run `33256164787`. The same head `8eafd1fcacc0d8d46264f8173b377e649cd5ef90` also had push-event run `33256162755`, which failed.
- In push job `99110138262`, `npm ci`, all 22 portable Windows tests, production compilation, NSIS installer creation, signing, and block-map creation succeeded. Electron-builder 26.15.3 then logged `Implicit publishing triggered by CI detection` and exited `1` because `GH_TOKEN` was absent; artifact upload was skipped.
- The duplicate pull-request job succeeded with the same source because that event did not trigger implicit publishing. The defect is therefore event-dependent publication behavior, not an installer-build failure.

**Diagnosis and change**

- `npm run dist:win` is documented and used as an installer-build command. It must not infer a release or require publishing credentials merely because it runs under CI.
- Updated `package.json` so `dist:win` invokes `electron-builder --win nsis --publish never`. The option is supported by the pinned electron-builder CLI and makes the non-publishing contract explicit in local, push, and pull-request environments.
- No token or workflow write permission was added: mapping a GitHub token into `GH_TOKEN` would authorize the unintended side effect instead of preventing it.
- Reopened P0-003 as `in progress` and corrected the mutable summary. The prior append-only entry remains intact as historical evidence.
- Files changed: `package.json`, `TASKS.md`, and `WORKBENCH_PROGRESS.md`. No changelog entry was added because this is engineering verification behavior, not an application feature.

**Verification**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm pkg get scripts.dist:win` | Printed `npm run build && electron-builder --win nsis --publish never`; exit `0`. |
| passed | `./node_modules/.bin/electron-builder --version`; `./node_modules/.bin/electron-builder --help \| rg -n -- '--publish'` | Confirmed pinned version `26.15.3` and the supported `never` publish mode; exits `0`. |
| passed | `npm run check:portable` | Both TypeScript projects and the eight selected portable test files passed; exit `0`. |
| passed | `npm run check` | Both TypeScript projects and all nine selected files, including the WSL integration suite, passed; exit `0`. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | workflow YAML parse with installed `js-yaml`; `git diff --check` | Existing workflow parsed and the scoped diff has no whitespace errors; exits `0`. |
| pending | complete push- and pull-request-event workflows | Each correction-head run must pass full Linux verification plus portable Windows tests, packaging, and artifact upload without an implicit-publication message or `GH_TOKEN` error. |
| pending | automated re-review | The corrected head has not yet been published at this point in the append-only record. |

**Closeout state**

- P0-003 remains in progress until both workflow events and the automated review are green on the correction head. Then exactly one records-only commit will mark the task done; that commit's own dual-event runs and review belong in the PR body and final handoff, not another evidence-only commit.
- Merge attempt was rejected by the repository's one-write-reviewer approval rule; it did not change `main`. The user authorized the merge, but retry remains gated on repaired CI and the required write-access approval.
- Blocker: none established while the fix and remote verification remain actionable.

### 2026-08-29 23:36 JST — P0-003 passed push- and pull-request-event packaging verification

**Correction-head evidence**

- PR #2 correction head `ecbbbc7eb6417b7472d44ca7b472c57f44866d58` completed both workflow events successfully.
- Push run `33257917864`: Linux job `99114747056` selected nine files including the WSL integration suite and passed 24 of 24 tests. Windows job `99114746920` passed 22 of 22 portable tests, built with `electron-builder --win nsis --publish never`, and uploaded artifact `9716389292` at 110,921,352 bytes with digest `sha256:a37cdb6edd2c9d82db91003cf08b4d033ad85e2e456b6aa82196296648eae7fa`.
- Pull-request run `33257919584`: Linux job `99114751596` selected the same full suite and passed 24 of 24 tests. Windows job `99114751497` passed 22 of 22 portable tests, used the same explicit non-publishing command, and uploaded artifact `9716393960` at 110,921,302 bytes with digest `sha256:8f2d589ad84c9a528bd4a653e4e00ea02fedd12c2472db28e2f9688fa9bb1de1`.
- Neither Windows log contains `Implicit publishing triggered`, `GH_TOKEN`, or the prior missing-token error. Both artifact uploads completed successfully.
- Automated Codex re-review completed on `ecbbbc7` with no new finding. All three prior review threads remain resolved and zero unresolved threads remain.

**Closeout**

- P0-003 is marked `done` again with evidence from both event paths; the mutable summary advances to P0-004.
- Files changed for this records-only closeout: `TASKS.md` and `WORKBENCH_PROGRESS.md`. No changelog entry was added because this remains engineering verification behavior.
- `git diff --check origin/main` passes for the complete branch diff.
- The records-only closeout head must now complete its own push and pull-request workflows plus automated review. Their final state will be reported in PR #2 and the delivery handoff without another evidence-only commit.
- The user authorized merging PR #2, but repository rules still require an approval from a reviewer with write access. Merge retry remains gated on that approval and final green closeout evidence.
- Next task: P0-004 — Review main/preload/renderer and IPC security.
- Blocker: none established while final closeout verification remains actionable.

### 2026-08-29 23:49 JST — P2-003 synchronized the delivery-workflow PR after the CI baseline merge

**Context and resolution**

- PR #2 merged the verified P0-003 baseline into `main` at `9c652bac5ca67c81fb7524aaed57c75be165fa17`.
- PR #1 head `87831ce2c0ac1e7e7f0fca3b8d91436b6404bffb` then conflicted only in `WORKBENCH_PROGRESS.md`, where both branches had appended evidence after the same historical entry.
- A clean auxiliary worktree merged `origin/main` without force-pushing or touching the dirty primary worktree. The resolution retains PR #1's 21:27 P2-003 entry followed by every later P0-003 entry from `main`; no append-only evidence was deleted or rewritten.
- The mutable summary keeps P0-001 through P0-003 complete and updates only the next delivery action for PR #1.
- Relative to repaired `main`, the synchronized PR remains scoped to `AGENTS.md`, `CODEX_WORKFLOW.md`, `REVIEW_CHECKLIST.md`, and this progress evidence.

**Verification and closeout**

- Host tooling was Node `v22.23.2` with npm `10.9.8`; `npm ci` installed the locked dependency graph successfully.
- `npm run check` type-checked both TypeScript projects and passed all nine selected compiled test files, including `dist-test/tests/wsl/project-system.test.js`; exit `0`.
- `npm run build` completed the clean production compilation and asset copy; exit `0`.
- `package.json` has no lint script, so lint remains explicitly unavailable rather than reported as passed.
- `git diff --check origin/main` passes for the complete synchronized worktree diff.
- Manual conflict-marker and chronological-entry review passes; the only conflict was resolved by retaining both append-only sides in timestamp order.
- No changelog entry was added because this is engineering-process documentation.
- Required remote evidence: both push- and pull-request-event workflows plus automated re-review on the synchronized PR #1 head. Their final state belongs in the PR body and handoff without another evidence-only commit.
- Merge of PR #1 remains separately authorized and was not performed.
- Blocker: none established while synchronization, CI, and review remain actionable.

### 2026-08-30 00:00 JST — P2-003 accepted the final task-branch-base review finding

**Remote evidence and finding**

- Synchronized PR #1 head `8f9a5e43aba9ef7461d1f953126e50e89a1b4649` passed both workflow events: push run `33258900970` and pull-request run `33258902380`.
- Push Linux job `99117332254` and pull-request Linux job `99117336318` each selected the full nine-file Linux/WSL inventory and passed 24 of 24 tests.
- Both Windows jobs passed 22 of 22 portable tests and built NSIS with `electron-builder --win nsis --publish never`; neither log contains the prior implicit-publication or missing-`GH_TOKEN` error.
- Push artifact `9716678952` was uploaded at 110,921,346 bytes with digest `sha256:1f1c308d04fc86a2ac204218f212cf7f96b0a8a1187d4f276f0f969bacfc2876`; pull-request artifact `9716685571` was uploaded at 110,921,375 bytes with digest `sha256:111d15da8e98c25d1523b0f49b93d7378872ca9e06a4b5509871c1a6f1d5cdb1`.
- Automated Codex re-review completed on `8f9a5e4` and opened one new P2 thread: creating a new task branch from an arbitrary current feature branch can inherit the prior task's commits even after a later rebase onto the default branch.

**Disposition and change**

- Accepted. Fetching the default branch did not by itself select it as the new branch's base.
- `AGENTS.md` and `CODEX_WORKFLOW.md` now require each new task branch to start explicitly from the fetched default branch without tracking it. When preserved work or prior-task commits make the current checkout unsuitable, the workflow preserves any existing index, transfers only audited commit SHAs or a reviewed binary-capable scoped patch plus explicitly inventoried task-owned untracked files, and creates a fresh clean auxiliary delivery branch from `origin/<default-branch>` without deleting or resetting the unsuitable branch.
- Published branches now merge an updated default branch deliberately instead of rebasing and requiring a forbidden force-push. Before publication, explicit commit and path audits against the fetched default detect inherited work.
- If an existing pull request is tied to a contaminated branch that cannot advance safely, the workflow opens and cross-links a replacement from the clean delivery branch instead of force-resetting the old head.
- `REVIEW_CHECKLIST.md` now verifies the branch base, commit ancestry, changed paths, and absence of inherited work from another task.
- Files changed for this review fix: `AGENTS.md`, `CODEX_WORKFLOW.md`, `REVIEW_CHECKLIST.md`, and this append-only progress entry. No changelog entry was added because this is engineering-process documentation.

**Verification and remaining action**

- Manual cross-reference review confirms initial setup, staged-index preservation, already-committed and uncommitted recovery (including binary and untracked task files), fresh no-track delivery branches, replacement-PR handling, unpublished-rebase versus published-merge synchronization, ancestry/path auditing, and review-checklist language use the same fetched-default branch contract.
- `npm run check` type-checked both TypeScript projects and passed all nine selected compiled test files, including the WSL integration suite; exit `0`.
- `npm run build` completed the clean production compilation and asset copy; exit `0`.
- `git diff --check origin/main` passes for the complete review-fix worktree diff.
- The complete PR diff remains limited to the same four Markdown files; no application, test, package, setup, or workflow file is changed relative to `main`.
- Both final-head workflow events and automated re-review remain required after this fix is committed and published. Their final state belongs in the PR body and handoff without another evidence-only commit.
- Merge of PR #1 remains separately authorized and was not performed.
- Blocker: none established while the review fix and final verification remain actionable.

### 2026-08-30 09:45 JST — P1-004 restored compact window modes and thread-scoped Codex models

**Environment**

- Platform / WSL distribution: WSL2, Ubuntu-24.04, Linux x64 (`6.6.87.2-microsoft-standard-WSL2`)
- Node version and executable: `v22.23.2`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/node`
- Package manager version and executable: npm `10.9.8`, `/home/kabes/.nvm/versions/node/v22.23.2/bin/npm`; npm selected from `package-lock.json`
- Electron version: `44.0.0`
- Base commit / branch: `8994b32` / `codex/p1-004-gui-bugfix`, created in an isolated clean worktree from fetched `origin/main`
- Initial repository state: the primary checkout had unrelated, uncommitted P0-002 enhancements on stale branch `codex/automate-pr-delivery`; those files were left untouched. The isolated P1-004 worktree began clean.

**Observed behavior**

- Goal: switch reliably between fullscreen and a genuinely small window, and keep each Codex session's model choice independent.
- Reproduction commands: source assertions read `src/main/main.ts` and `src/main/ipc.ts`, then failed when the window minimum exceeded 760×560 or any request read `selected.codexModel`.
- Expected: a usable compact restored window and model/reasoning values owned by the active Codex thread.
- Actual before the fix: `minWidth: 1080`, `minHeight: 700`, and six model request sites read shared workspace state. The first native Electron smoke also showed a second window bug: after entering fullscreen from 720×520, WSLg emitted `leave-full-screen` but left bounds at 3832×2156.
- Exit code and first meaningful errors: both source reproductions exited `1` (`BrowserWindow cannot restore to the required small-window envelope`; `Codex requests read model selection from shared workspace state`). The first production Electron round trip exited `1` with `Fullscreen did not restore the small bounds`.

**Diagnosis**

- Classification: Electron window-state/restored-layout behavior plus Codex renderer/preload/IPC session state.
- Evidence: fixed three-column CSS had only one 1220px breakpoint; Electron relied entirely on platform fullscreen restoration; `Workspace`, `WorkbenchStore`, and every start/resume/turn path shared one model preference.
- Hypothesis: snapshot normal bounds around native fullscreen, add compact responsive breakpoints, and key model/effort values by Codex thread while using the app-server's thread settings protocol.
- Disconfirming checks: fullscreen would still return fullscreen-sized bounds; the 720×520 renderer would overflow; two threads would show the same model; or installed app-server 0.147.0 would reject `thread/settings/update` or the new-thread reasoning override.
- Root cause: confirmed. WSLg needed explicit post-`leave-full-screen` bounds restoration, and model ownership was implemented at the wrong persisted scope.

**Changes**

- Files changed: window behavior and responsive renderer styles; typed Codex session preference state and protocol serializers; main/preload/renderer/mock/store/shared contracts; focused tests; `README.md`, `docs/ARCHITECTURE.md`, `TASKS.md`, `WORKBENCH_PROGRESS.md`, and `CHANGELOG.md`.
- Rationale: use native fullscreen while repairing the platform restoration gap, and use Codex's own thread model/settings semantics instead of inventing another global persistence layer.
- User-visible effect: F11 enters fullscreen, Escape returns to the prior normal bounds, the UI remains usable down to 720×520, and the model toolbar explicitly says **This thread** or **New thread**. Switching Codex threads restores independent model/reasoning choices.
- Security or compatibility considerations: renderer Node access and context isolation are unchanged. New model payloads cross only narrow typed methods and are bounded/control-character validated in the main process. Legacy workspace-global model fields are dropped during normal state sanitization; Codex supplies resumed threads' effective settings.

**Verification**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| passed | baseline `npm run check` after isolated `npm ci` | Both TypeScript projects and the original nine test files passed before edits; exit `0`. |
| passed | `npm run build:tests && node --test dist-test/tests/codex-session.test.js dist-test/tests/codex-session-preferences.test.js dist-test/tests/codex-metadata.test.js dist-test/tests/store.test.js dist-test/tests/window-behavior.test.js` | Five focused files passed model-wire validation, thread isolation, legacy-global-state removal, and fullscreen restoration; exit `0`. |
| passed | ephemeral installed app-server harness: `initialize`, `model/list`, `thread/start`, `thread/settings/update` | Codex CLI 0.147.0 accepted `gpt-5.6-sol` / `low` as thread-scoped settings; no turn was sent and the thread was ephemeral; exit `0`. |
| passed | `npm run check` | Strict main/renderer type checks and all 12 compiled test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | No lint script exists in `package.json`. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | bounded production-renderer Electron journey at 720×520 | Body width remained 720 with no horizontal overflow; context tray compacted; `thr-refactor` retained Terra/medium while `thr-tests` retained Sol/high; fullscreen returned from 3832×2156 to the exact original 720×520 bounds; exit `0`. |
| passed | `npm start -- --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The real app entry point stayed running under WSLg until intentional SIGINT. DBus/GPU warnings were non-fatal. |
| passed | scoped `ps` checks for the task Electron path and `codex app-server` | No task Electron or Codex child remained after shutdown. |
| passed | `git diff --check` | No whitespace errors. |

**Closeout**

- Final diff summary: P1-004 is isolated to the window/session implementation, focused regressions, current user/architecture documentation, and required task records; the temporary GUI harness was removed.
- Remaining risks or unverified behavior: native Windows window controls were not manually exercised in this WSL session. Deterministic shortcut tests and the real WSLg fullscreen journey cover the defect; Windows CI remains required after publication. The app-server wire path and renderer isolation were verified separately rather than by sending a billable authenticated turn.
- Task-board update: P1-004 marked `done`; both acceptance criteria have current evidence.
- Changelog/docs update: recorded compact fullscreen restoration, per-thread model ownership, shortcuts, state boundaries, and migration behavior.
- Next action: publish the feature branch, complete applicable CI and automated review, then continue with P0-004.
- Blocker and smallest user action needed, if any: none established before the delivery attempt.

### 2026-08-30 00:23 JST — P2-003 required applicable CI independent of branch-protection settings

**Remote evidence and finding**

- PR #1 head `2bddd09e531b5acdce6ea239ee99703978d47094` passed both workflow events. Push run `33259884402` passed Linux job `99119892566` (24 of 24 tests) and Windows job `99119892519` (22 of 22 tests, NSIS packaging, artifact `9716957158` at 110,921,355 bytes with digest `sha256:d95bcb1f6600376c8eb41d035a60c494374f0254b167c8d8ca9d1100d3ab53b9`). Pull-request run `33259886945` passed Linux job `99119899717` (24 of 24) and Windows job `99119899805` (22 of 22, NSIS packaging, artifact `9716955476` at 110,921,356 bytes with digest `sha256:f378a0421aebc49e0690fb2b0be364d44ad82c676b371bfbcef152a1881cdad1`).
- Both Windows jobs invoked `electron-builder --win nsis --publish never`; neither log contains an implicit-publishing message or the missing-`GH_TOKEN` error.
- Automated Codex re-review completed on `2bddd09` and opened one new P2 thread: wording limited to “required CI” is vacuous when active ruleset `21797957` does not mark the configured Linux or Windows status contexts as required.

**Disposition and change**

- Accepted. Branch-protection optionality is not evidence that a configured, relevant verification or packaging job may fail without blocking delivery.
- `AGENTS.md`, `CODEX_WORKFLOW.md`, and `REVIEW_CHECKLIST.md` now require every applicable repository CI job to pass, whether or not its status context is marked required by branch protection.
- Historical progress entries retain their original “required CI” wording as append-only evidence; this entry records the corrected current policy.
- Files changed for this review fix: `AGENTS.md`, `CODEX_WORKFLOW.md`, `REVIEW_CHECKLIST.md`, and this progress entry. No changelog entry was added because this is engineering-process documentation.

**Verification and remaining action**

- Manual cross-reference review confirms the definition of done, review loop, and checklist use the same applicable-CI rule.
- `npm run check` type-checked both TypeScript projects and passed all nine selected compiled test files, including the WSL integration suite; exit `0`.
- `npm run build` completed the clean production compilation and asset copy; exit `0`.
- `git diff --check origin/main` passes for the complete applicable-CI review-fix worktree diff.
- The complete PR diff remains limited to the same four Markdown files; no application, test, package, setup, or workflow file is changed relative to `main`.
- Both final-head workflow events and automated re-review remain required after this fix is committed and published. Their final state belongs in the PR body and handoff without another evidence-only commit.
- Merge of PR #1 remains separately authorized and was not performed.
- Blocker: none established while the review fix and final verification remain actionable.

### 2026-08-30 09:48 JST — P1-004 remote delivery blocked on GitHub authentication

**Local delivery state**

- The reviewed P1-004 patch was committed as `2e61424` (`Fix compact window and thread model scope`) on `codex/p1-004-gui-bugfix`.
- A post-commit `git fetch --prune origin` succeeded. The branch remains exactly one scoped commit ahead of current `origin/main`; `git log --oneline origin/main..HEAD`, `git diff --name-status origin/main...HEAD`, and `git diff --check origin/main...HEAD` all passed their ancestry/path/whitespace audit.
- The dirty primary checkout and its unrelated work remain untouched.

**Blocked remote actions**

- `git push --set-upstream origin codex/p1-004-gui-bugfix` exited `128`: `fatal: could not read Username for 'https://github.com': No such device or address`.
- The safe non-interactive fallback `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -T git@github.com` failed with `Permission denied (publickey)`.
- The portable GitHub CLI reports no authenticated GitHub host, so it cannot create the pull request or inspect CI/review state.
- No branch was pushed and no pull request was created; CI and automated review have therefore not run.

**Smallest user action**

- Authenticate GitHub CLI for `beautysamurai/workbench` in this environment (the available portable command is `/tmp/gh_2.45.0_linux_amd64/bin/gh auth login`), then resume P1-004. Workbench can continue from commit `2e61424` without repeating implementation or local verification.

### 2026-08-30 10:39 JST — P1-004 GitHub delivery resumed after authentication

**Environment and remote state**

- GitHub CLI 2.45.0 is persistently available at `/home/kabes/.local/bin/gh`, which was already on the WSL user PATH; no repository dependency or system package was added.
- GitHub device authentication completed as `beautysamurai`, and `gh auth setup-git` configured HTTPS Git operations for `github.com`.
- `git push --set-upstream origin codex/p1-004-gui-bugfix` published commits `2e61424` and `dda6465` and configured the feature branch to track `origin/codex/p1-004-gui-bugfix`; exit `0`.
- `gh pr list --head codex/p1-004-gui-bugfix --state all` returned no existing pull request.

**Next action**

- Commit and publish this resumed-delivery record, open the P1-004 pull request, then complete every applicable CI job and automated review.
- Blocker: none established.

### 2026-08-30 10:46 JST — P1-004 accepted the final-head unavailable-model review finding

**Remote evidence and finding**

- PR #3 was opened at `https://github.com/beautysamurai/workbench/pull/3` with head `d46ed77609c91e7da074e5fbe16a5efcf22c864f`.
- Push- and pull-request-event Linux verification jobs passed in 18 and 17 seconds. Both Windows packaging jobs passed in 1 minute 44 seconds and 1 minute 20 seconds.
- Automated Codex review `5059680912` completed on exact head `d46ed77` and opened one unresolved P2 thread: a resumed thread whose effective model is hidden or absent from the visible catalog falls back to the default model before the next turn.
- Accepted. `model/list` intentionally excludes hidden models, while `sessionModelPreference` previously repaired any unknown model on every render and turn submission. This could silently override the model returned by `thread/resume`.

**Scoped correction and verification plan**

- Existing threads now preserve their effective model/reasoning preference when the model is unavailable in the visible catalog. The selector exposes that value as an unavailable option until the user explicitly chooses an available model; new-thread drafts still repair stale selections to a visible default.
- A focused metadata regression test covers the preserved existing-thread path, and the changelog/task evidence records the user-visible correction.
- The initial focused command, `npm run build:tests && node --test dist-tests/tests/codex-metadata.test.js`, exited `1` after successful compilation because it used the wrong `dist-tests` output path; no test ran. The corrected `node --test dist-test/tests/codex-metadata.test.js` passed the focused file.
- `npm run check` passed strict main/renderer type checks and all 12 full compiled test files, including the new regression and WSL integration suite; exit `0`.
- `npm run build` completed the clean production compilation and asset copy; exit `0`. `git diff --check` also passed.
- Ubuntu's GitHub CLI 2.45.0 failed the explicit reviewer mutation against retired Projects Classic fields. The per-user CLI was upgraded to official 2.98.0 after its release archive matched GitHub's published SHA-256 digest; authentication remained active and the explicit Copilot review request succeeded.
- Next action: commit and push the accepted fix, then wait for final-head CI and automated re-review.
- Blocker: none established.

### 2026-08-30 13:59 JST — P1-004 corrected fractional-scale WSLg fullscreen and pointer alignment

**Environment**

- Platform / WSL distribution: WSL2, Ubuntu-24.04, Linux x64 (`6.6.87.2-microsoft-standard-WSL2`) with WSLg/XWayland on a 3840×2160 display at 150% Windows desktop scaling.
- Node / package manager: Node `v22.23.2`, npm `10.9.8`, Linux/WSL install selected by `package-lock.json`; Electron `44.0.0`.
- Base / branch: fetched `origin/main` at merge commit `a2d8a1f`; clean auxiliary worktree `/tmp/workbench-p1-004-pointer` on `codex/p1-004-fullscreen-pointer-fix` with no default-branch tracking.
- Preserved state: the primary checkout remains on `codex/p0-002-structured-tasks`; its untracked `.workbench/` directory and `image-3.png` were not modified or transferred.

**Observed behavior and reproduction**

- The merged P1-004 fullscreen restoration fix was present locally, but a native Electron/Windows pointer harness reproduced the new report. Without correction, Electron reported fullscreen bounds, content bounds, and renderer size `(0,0) 3840×2160` with device scale factor `1`, while the Windows-hosted WSLg surface was `(0,0) 2560×1440` at 150% desktop scaling.
- Real Windows pointer input exposed the coordinate mismatch: host y positions `45`, `85`, `125`, and `205` reached renderer client y positions `68`, `128`, `188`, and `308`. The displayed application was correspondingly compressed, its title/overlay geometry did not match the host surface, and the user-visible cursor target shifted after F11.
- A maximize-based fallback was tested and rejected: the host surface became 2560×1392 and the Electron viewport 3840×2088, while the same 1.5× pointer-coordinate mismatch remained.
- Baseline `npm run check` passed strict compilation and all 12 merged-main tests before repository edits; exit `0`.

**Diagnosis and changes**

- Root cause: WSLg recorded the primary Windows desktop scale as 150% but exposed its XWayland client at scale 1. Chromium therefore used physical X pixels while the RDP host and pointer used Windows desktop coordinates. Native fullscreen removed the normal-window compensation and made the disagreement visible.
- Added `src/main/wslg-display-scale.ts` to read only the bounded tail of WSLg's Weston log, select the latest primary monitor input, account for any scale WSLg already applied, validate the remaining factor, and configure Chromium before Electron's `ready` event.
- The correction is Linux+WSLg-only, safely does nothing when the log is missing or malformed, and never overrides an explicit `force-device-scale-factor` switch. Native Windows behavior and renderer/main security boundaries are unchanged.
- Added focused parser, environment-gating, fallback, compositor-scale, and explicit-override regressions; updated current task, user documentation, and changelog evidence.

**Verification**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js` | Focused regression passed all parser/configuration cases; exit `0`. An intermediate fixture assertion (`2 !== 1`) correctly exposed a missing client-scale fixture line; the fixture was corrected and the focused file rerun. |
| passed | `npm run check && npm run build && git diff --check` | Strict main/renderer type checks, all 13 compiled test files including WSL integration, clean production compilation/assets, and whitespace validation passed; exit `0`. |
| unavailable | lint/static analysis | No lint script exists in `package.json`. |
| passed | patched production `npm start -- --enable-logging=stderr` plus bounded Windows window capture | Fullscreen reached Windows rect `(0,0) 2560×1440` and the pre-fullscreen window dimensions returned after F11; the captured top edge was filled. Non-fatal WSLg DBus/GPU warnings remained unchanged. |
| passed | `/tmp/workbench-p1-004-pointer/node_modules/.bin/electron /tmp/workbench-fullscreen-diag.cjs` plus the bounded PowerShell `GetWindowRect`/pointer harness | The production auto-detection selected scale `1.5`; Electron display/window/content/renderer and the Windows surface all agreed on `(0,0) 2560×1440`. Clicks at y `5`, `45`, `85`, `125`, `165`, `205`, and `285` arrived at those exact client y values, then the exact 900×700 normal bounds restored. |
| passed | scoped process shutdown | Both patched Workbench and diagnostic Electron roots were terminated with Ctrl+C after the bounded journeys; no task Codex process was started. |

**Closeout**

- Local fix is complete and scoped to startup display reconciliation, one focused test file, and required records/docs. No generated output, temporary diagnostic, screenshot, dependency, or user-owned file is included.
- Remaining risk: the reported primary 150% monitor is verified with real host input; moving a running WSLg window between monitors with different scale factors was not physically exercised. Parsing accounts for the current primary monitor and any WSLg client scale, while malformed/unavailable diagnostics fail open to Electron's default behavior.
- Next action: audit and commit only these task paths, fetch/reconcile with `origin/main`, push the feature branch, open a correction pull request, and complete all applicable CI plus automated review.
- Blocker: none established.

### 2026-08-30 14:22 JST — P1-004 accepted mixed-scale monitor review finding

**Remote review evidence**

- Pull request #4 was opened at `https://github.com/beautysamurai/workbench/pull/4` with head `f5aba91276807723f92486fe7a5ec5fd9bac7a7f`.
- Both Linux verification jobs passed in 17–18 seconds and both Windows packaging jobs passed in 1 minute 39 seconds and 1 minute 47 seconds across push and pull-request events.
- Automated Codex review `5060003679` completed on exact head `f5aba91` with one unresolved P2 thread (`discussion_r3888535749`): the process-wide Chromium scale override selected the primary monitor even when WSLg reported heterogeneous monitor scales.
- Disposition: accepted. The finding directly affects the display-safety boundary; moving the app to a differently scaled monitor could otherwise trade the reported fix for incorrect geometry on that monitor.

**Scoped correction**

- The WSLg layout parser now validates every reported monitor block and returns a scale only when all residual desktop/client scales agree. A mixed-scale or partially invalid layout returns `null`, preserving Electron's per-display defaults rather than forcing the primary DPI process-wide.
- The focused fixture now covers homogeneous multi-monitor correction, WSLg-applied client scaling, malformed input, and an explicit heterogeneous 100%/150% no-override case. User documentation and task evidence describe this guardrail.
- Focused `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js` passed after the review correction; exit `0`. Current `/mnt/wslg/weston.log` detection still returns `1.5` for the reported consistently scaled active layout.
- Next action: run the complete check/build and local diff review, commit and push the accepted correction, then require final-head CI and automated re-review.
- Blocker: none established.

**Verification after correction**

- `npm run check && npm run build && git diff --check` passed strict compilation, all 13 test files, the production build, and whitespace validation; exit `0`.
- The production auto-detection and real Windows pointer harness were rerun after the mixed-scale guard. The active homogeneous layout still selected `1.5`; Windows and Electron agreed on fullscreen `(0,0) 2560×1440`, all seven host/client y coordinates remained exact, and 900×700 restored.
- Final next action: commit and push the accepted finding, resolve the review thread with the commit evidence, and complete final-head CI plus automated re-review.

### 2026-08-30 14:28 JST — P1-004 accepted partial-layout review finding

**Final-head re-review evidence**

- Commit `9846323` passed both final-head Linux verification jobs in 18 seconds and both Windows packaging jobs in 1 minute 47 seconds and 1 minute 55 seconds.
- Automated Codex re-review `5060020441` completed on exact head `9846323` and opened one P2 thread (`discussion_r3888555319`): a partially written multi-monitor layout could contain one complete monitor block but still declare more monitors, allowing a stale process-wide scale before the remaining block was written.
- Disposition: accepted. This is a real startup race against a log that WSLg updates in place.

**Scoped correction and verification plan**

- Scale detection now requires the latest `DisplayLayoutChange` record to declare a positive hexadecimal monitor count, contain exactly that many input monitor headers, and reach the input/output validation boundary. Incomplete, count-mismatched, mixed-scale, and malformed layouts all preserve Electron defaults.
- Focused regressions cover both a truncated two-monitor record and a completed record whose declared count exceeds its monitor blocks.
- `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js` passed after the correction; exit `0`. The current completed active layout still detects `1.5`.
- Next action: complete broad checks and the real pointer journey, then commit, push, resolve the thread, and require another exact-head CI/re-review cycle.
- Blocker: none established.

**Verification after correction**

- `npm run check && npm run build && git diff --check` passed strict compilation, all 13 test files, production compilation/assets, and whitespace validation; exit `0`.
- The bounded production auto-detection/pointer journey was rerun after the completion guard: Electron retained scale `1.5`, Windows and Electron both reached fullscreen `(0,0) 2560×1440`, all seven y coordinates remained exact, and the 900×700 window restored.
- Final next action: commit and publish the race fix, resolve the finding with evidence, and complete one more final-head CI and automated re-review.

### 2026-08-30 14:45 JST — P1-004 accepted runtime display-scale review finding

**Final-head review evidence**

- Commit `48c4af6` passed both Linux verification jobs in 14–16 seconds and both Windows packaging jobs in 1 minute 41 seconds and 1 minute 56 seconds.
- Automated Codex review `5060029809` completed on exact head `48c4af6` and opened one P2 thread (`discussion_r3888565520`): a process-wide startup scale remained active for the process lifetime after Windows scaling or monitor topology changed.
- Disposition: accepted. The startup correction must be recomputed when the effective WSLg layout scale changes; otherwise a previously correct fullscreen can acquire the same geometry and hit-target mismatch after a display change.

**Scoped correction**

- Workbench now listens for Electron display additions, removals, and metric changes only in WSLg when the user did not provide an explicit device-scale switch. It rereads the latest validated Weston layout after the event settles and requires two matching changed values to avoid reacting to a partially written record.
- A confirmed effective-scale change removes the listeners, schedules `app.relaunch()`, and uses normal `app.quit()` cleanup so terminal and Codex child processes are closed. The new process recomputes the WSLg startup scale; unchanged metrics do nothing.
- Focused regressions cover an unchanged event, a transient partial record, a uniform-to-mixed change, exactly-once relaunch and listener cleanup, and non-WSLg subscription gating. README, task evidence, and changelog now disclose the clean runtime recalibration.

**Verification after correction**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js` | Focused parser, startup configuration, and runtime scale-watcher regressions passed; exit `0`. |
| passed | `npm run check && npm run build && git diff --check` | Strict main/renderer type checks, all 13 compiled test files including WSL integration, production compilation/assets, and whitespace validation passed; exit `0`. |
| unavailable | lint/static analysis | No lint script exists in `package.json`. |
| passed | `/tmp/workbench-p1-004-pointer/node_modules/.bin/electron /tmp/workbench-fullscreen-diag.cjs` plus the bounded PowerShell native-input harness | Electron and the Windows host again agreed on fullscreen `(0,0) 2560×1440`; host y positions `5`, `45`, `85`, `125`, `165`, `205`, and `285` reached those exact renderer positions, then the 900×700 content bounds restored. |
| passed | `npm start -- --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The real application entry point initialized the runtime display listeners and remained running under WSLg until the intentional SIGINT. Existing DBus/GPU environment warnings were non-fatal. |
| passed | diagnostic shutdown with Ctrl+C | The bounded Electron diagnostic exited after verification; no Codex child process was started. |
| passed | scoped `pgrep` for the task Electron path | No Electron process from either bounded journey remained after shutdown. |

**Next action**

- Commit and publish the accepted runtime correction, resolve the review thread with commit and verification evidence, then complete final-head CI and automated re-review.
- Blocker: none established.

### 2026-08-30 14:56 JST — P1-004 accepted active-work relaunch review finding

**Final-head review evidence**

- Commit `008eecf` passed both Linux verification jobs in 15–16 seconds and both Windows packaging jobs in 1 minute 45 seconds and 2 minutes 19 seconds.
- Automated Codex review `5060066014` completed on exact head `008eecf` and opened one P2 thread (`discussion_r3888595914`): the automatic display-scale relaunch could stop an active terminal command or Codex turn and discard renderer-only composer text without warning.
- Disposition: accepted. Display recalibration is important, but an ordinary monitor or scaling change must not silently destroy active work.

**Scoped correction**

- A confirmed effective WSLg scale change now opens a Workbench restart prompt instead of quitting automatically. **Later** is the safe default and explicitly lets the user finish work and restart manually; **Restart now** warns that running terminals, Codex turns, and unsent prompt text will be stopped or lost before using the normal relaunch/quit cleanup.
- The display watcher remains subscribed after a deferred restart, suppresses duplicate notifications for the same effective scale, reports a genuinely different subsequent scale, and resets its notification state if the layout returns to the process's calibrated scale.
- Focused tests now verify same-scale suppression, transient partial-record recovery, one notification per changed scale, continued watching after deferral, explicit disposal, and non-WSLg gating. README, task evidence, and changelog disclose the user-controlled recalibration behavior.

**Verification after correction**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js` | Focused parser, startup configuration, transient-layout, changed-scale deduplication, deferral, and cleanup cases passed; exit `0`. |
| passed | `npm run check && npm run build && git diff --check` | Strict main/renderer type checks, all 13 compiled test files including WSL integration, production compilation/assets, and whitespace validation passed; exit `0`. |
| unavailable | lint/static analysis | No lint script exists in `package.json`. |
| passed | `npm start -- --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The actual app initialized the persistent display watcher and restart-prompt wiring and remained running under WSLg until intentional SIGINT. Existing DBus/GPU warnings were non-fatal. |
| passed | `pgrep -af '[e]lectron.*(/tmp/workbench-p1-004-pointer|electron \\.)'` | Exit `1` with no output confirmed the bounded launch left no Electron process. |
| not run | physically change Windows scale or attach/remove a monitor while a terminal command, Codex turn, or draft is active | Altering the host display configuration was not necessary for the scoped review correction. The watcher decision paths and deferred-listener lifecycle are covered deterministically; the Electron dialog integration is type-checked and initialized by the real app launch. |

**Next action**

- Commit and publish the accepted active-work correction, resolve the review thread with commit and verification evidence, then complete another final-head CI and automated re-review.
- Blocker: none established.

### 2026-08-30 15:34 JST — P1-004 removed Windows timer nondeterminism from scale-watcher regression

**CI failure and diagnosis**

- On commit `afd5b23`, both Linux verification jobs passed in 15–16 seconds, but both Windows packaging jobs failed after 34 seconds in `npm run check:portable` with the same assertion in `reports each confirmed WSLg scale once and keeps watching when deferred`: expected notification count `1`, actual `0`.
- Classification: test timing defect, not a product regression. The test used a fixed 10 ms wall-clock wait for two nested zero-delay timers. Windows could run the assertion timer before the second debounce callback even though the production watcher behavior was correct.

**Scoped correction and verification**

- The watcher now accepts an internal cancelable scheduler dependency while retaining the same 500 ms timeout scheduler by default. Focused tests use a deterministic in-memory queue and explicitly flush both debounce/confirmation callbacks, preserving coverage of cancellation and disposal without depending on host timer resolution.
- `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js` passed the corrected focused regression; exit `0`.
- `npm run check:portable` passed strict type checks and all 12 portable test files, matching the failed Windows CI step; exit `0`.
- `npm run check && npm run build && git diff --check` passed strict compilation, all 13 full test files including WSL integration, production compilation/assets, and whitespace validation; exit `0`.
- Next action: commit and push the deterministic test correction, then require fresh CI and exact-head automated review.
- Blocker: none established.

### 2026-08-30 15:38 JST — P1-004 accepted stale-first-read review finding

**Automated review evidence**

- Automated Codex review `5060128287` completed on exact head `afd5b23` while the Windows timer-test correction was in progress and opened one P2 thread (`discussion_r3888663281`): Electron can emit its display event before Weston appends the new layout, so a first read equal to the startup scale could stop inspection and miss the change indefinitely.
- Disposition: accepted. Debouncing only delays the first read; it does not prove the compositor log is current when that read still contains the old completed layout.

**Scoped correction and verification**

- Each Electron display event now starts a bounded five-read settling window at the existing 500 ms interval. Startup-scale reads continue polling for up to 2.5 seconds; a changed value still requires two matching reads, with one final confirmation allowed when the candidate first appears at the end of the window.
- A startup-scale observation clears a previously reported changed scale only after the full settling window remains stable, avoiding duplicate prompts when an early stale read is followed by the same already-reported changed layout.
- Added a deterministic regression in which the first post-event read is the startup layout and subsequent reads are the new mixed layout; the watcher detects and reports it after three reads. Existing deterministic tests now also cover the complete unchanged settling window.
- `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js`, `npm run check:portable`, `npm run check`, `npm run build`, and `git diff --check` all passed; the portable suite ran 12 files and the full suite ran 13 files including WSL integration.
- Next action: commit and publish the bounded-settling fix, resolve the finding with commit evidence, then complete fresh CI and exact-head automated re-review.
- Blocker: none established.

### 2026-08-30 16:33 JST — P1-004 separated indeterminate layouts and retried startup settling

**CI and automated review evidence**

- Commit `0cfcb94` passed both Linux verification jobs in 14–17 seconds and both Windows packaging jobs in 1 minute 43 seconds and 1 minute 44 seconds; this confirmed the deterministic scheduler correction on both workflow events.
- Automated Codex review `5060139049` on `b07a81f` opened P2 thread `discussion_r3888675160`: a pre-ready incomplete layout could become complete before the watcher subscribed, leaving no later Electron event to trigger recalibration.
- Automated Codex review `5060194815` on exact head `0cfcb94` opened P2 thread `discussion_r3888731072`: coercing an unreadable, truncated, or malformed layout to scale 1 could falsely confirm a restart transition.
- Disposition: both accepted. A valid Electron-default layout and an indeterminate Weston read require different runtime behavior, and startup needs its own post-ready settling pass.

**Scoped correction**

- Internal detection now returns explicit `uniform`, `mixed`, or `indeterminate` layout states. A valid uniform scale 1 or mixed layout maps to Electron's default target; an indeterminate read is never treated as scale 1, never becomes a restart candidate, and only consumes one bounded settling read.
- The display watcher starts one settling pass immediately after subscribing, in addition to reacting to later display events. If pre-ready configuration missed a partial layout that becomes a valid uniform fractional scale by `ready`, two matching post-ready reads offer the safe restart prompt.
- Existing public parser/detection behavior remains compatible (`number | null`), explicit user scale switches still bypass Workbench management, and production timing remains five reads at 500 ms with cancellation on a newer event or app exit.

**Verification after correction**

| Result | Exact command or manual check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js` | Focused detection/watcher file passed, including indeterminate-read suppression and post-ready recovery after a missed pre-ready scale; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 12 portable test files passed; exit `0`. |
| passed | `npm run check && npm run build && git diff --check` | Strict type checks, all 13 full test files including WSL integration, production compilation/assets, and whitespace validation passed; exit `0`. |
| passed | `npm start -- --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The real app completed its startup settling window on the current valid 150% layout without opening a false recalibration prompt and remained running until intentional SIGINT. Existing DBus/GPU warnings were non-fatal. |
| passed | read-only Windows `Get-Process` title check | Exactly the expected `Workbench (Ubuntu-24.04)` host window was present during the startup smoke. |
| passed | scoped Electron `pgrep` after shutdown | Exit `1` with no output; no task Electron process remained. |

**Next action**

- Commit and publish both accepted corrections, resolve both review threads with evidence, then complete fresh CI and exact-head automated re-review.
- Blocker: none established.

### 2026-08-30 16:40 JST — P1-004 accepted long-running Weston log review finding

**Final-head review evidence**

- Commit `7ecc59f` passed both Linux verification jobs in 15–16 seconds and both Windows packaging jobs in 1 minute 44 seconds and 1 minute 50 seconds.
- Automated Codex review `5060240378` completed on exact head `7ecc59f` and opened one P2 thread (`discussion_r3888776693`): if more than 512 KiB of unrelated Weston output followed the latest layout marker, the fixed tail omitted that marker and scale detection remained indeterminate.
- Disposition: accepted. WSLg can be long-running independently of Workbench, so startup correctness cannot rely on the latest layout happening to remain inside one fixed tail.

**Scoped correction and verification**

- The Weston reader now scans backward from a snapshot size in fixed 512 KiB chunks with marker-length overlap, stopping at the latest `DisplayLayoutChange` marker. It then reads at most 512 KiB forward from that marker for parsing, bounding memory and layout payload while allowing the marker to be arbitrarily far from the end of the log.
- A short read caused by concurrent truncation becomes an indeterminate detection and is retried by the existing settling loop; the descriptor remains protected by `finally` cleanup. Detection options accept a task-internal log path so the real reader can be exercised portably without touching the host Weston file.
- The focused regression creates a 1 MiB temporary log whose latest marker crosses the old 512 KiB tail boundary, verifies scale `1.5`, and removes the temporary directory after the test.
- `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js`, `npm run check:portable`, `npm run check`, `npm run build`, and `git diff --check` all passed; portable ran 12 files and full verification ran 13 files including WSL integration.
- `node -e 'const {detectWslgDisplayScale}=require("./dist/main/main/wslg-display-scale.js"); console.log(detectWslgDisplayScale())'` printed `1.5` against the current real `/mnt/wslg/weston.log` after the reader change.

**Next action**

- Commit and publish the backward-scan fix, resolve the finding with evidence, then complete fresh CI and exact-head automated re-review.
- Blocker: none established.

### 2026-08-30 17:03 JST — P1-004 accepted missing client-scale review finding

**Final-head delivery evidence**

- Commit `970f179` passed both Linux verification jobs in 17–19 seconds and both Windows packaging jobs in 1 minute 54 seconds and 2 minutes.
- The automatic new-head review request remained queued without a submission. `gh pr edit 4 --add-reviewer @copilot` was accepted but did not start a visible run, so the documented `@codex review` trigger was posted. The connector acknowledged it with 👀 and a running summary for exact head `970f179`.
- Manual automated review `5060285941` completed on exact head `970f179` and opened one P2 thread (`discussion_r3888823814`): a missing or nonnumeric Weston `client scale` field was silently defaulted to 1, allowing an unknown applied compositor scale to become a process-wide override.
- Disposition: accepted. Every factor used to compute the residual Chromium scale must be present and numeric; unknown compositor state is indeterminate, not an implicit identity scale.

**Scoped correction and verification**

- Removed the client-scale fallback. A missing field or a value outside the numeric parser now produces `NaN`, fails the existing finite residual validation, and keeps the complete-looking layout indeterminate.
- Focused parser regressions cover both a nonnumeric `client scale :unknown` value and an absent client-scale line in one monitor block.
- `npm run build:tests && node --test dist-test/tests/wslg-display-scale.test.js`, `npm run check:portable`, `npm run check`, `npm run build`, and `git diff --check` all passed; portable ran 12 files and full verification ran 13 files including WSL integration.
- Current real Weston detection still printed `1.5` from the production build, confirming the active valid layout contains the required client-scale records.

**Next action**

- Commit and publish the strict client-scale parser fix, resolve the finding with evidence, then complete fresh CI and exact-head automated re-review.

### 2026-08-30 13:07 JST — P0-002 synchronized merged GUI work without losing structured tasks

**Starting state and synchronization**

- GitHub PR #3 was confirmed merged as `a2d8a1f`; `origin/main` advanced from `8994b32` to that merge commit.
- The primary checkout was still on merged workflow branch `codex/automate-pr-delivery`, 17 commits behind `origin/main`, with the completed but unpublished P0-002 structured-task source/docs/tests plus user-created `image-3.png` and runtime `.workbench/` metadata.
- Created `codex/p0-002-structured-tasks`, staged only the 16 documented P0-002 paths, and captured carrier `256aafd`. The screenshot and runtime metadata remained untracked and unchanged.
- Rebasing the unpublished carrier onto `origin/main` produced expected conflicts in the changelog, task/progress records, renderer workspace cleanup, and project-system tests. Resolution retained P1-004 fullscreen/thread-model behavior and layered P0-002 task composition on top.
- P0-003 had deliberately separated portable tests from WSL integration tests. The rebased resolution kept parser/image-byte validation portable and moved filesystem, symlink, permission, locking, and multiprocess cases into `tests/wsl/project-system.test.ts`, preventing regression of Windows CI portability.
- The rebased branch head is `149b3e3`, exactly one commit ahead of merged `origin/main`.

**Verification**

- `npm run build:tests && node --test dist-test/tests/project-system.test.js dist-test/tests/project-tasks.test.js dist-test/tests/wsl/project-system.test.js` passed all three focused files; exit `0`.
- `npm run check` passed strict main/renderer type checks and all 13 compiled test files; exit `0`.
- `npm run build` completed the production build and asset copy; exit `0`.
- `npm start -- --enable-logging=stderr` launched the synchronized application under WSLg and remained running beyond 10 seconds. Only the known non-fatal WSL DBus/GPU warnings appeared.
- Next action: publish the P0-002 branch and complete its pull-request CI/review loop, then begin P0-004.
- Blocker: none established.

### 2026-09-01 20:09 JST — P0-002 published an isolated delivery branch

**Starting state and preservation**

- Fetched `origin/main` at merged P1-004 correction `ee78b7c`. The unpublished P0-002 tree was exactly one commit ahead.
- The primary checkout contained the user's new unstaged WB-006 queue entry plus untracked `.workbench/` runtime metadata and `image-3.png`. A separate `/tmp/workbench-wb-006` worktree also contained active uncommitted WB-006 implementation. None of that state was staged, stashed, copied, or modified.
- Created clean worktree `/tmp/workbench-p0-002-delivery` and fresh branch `codex/p0-002-structured-tasks-delivery` directly from `origin/main`, then cherry-picked only audited P0-002 commit `0e39624` as `b7f963f`.
- The clean commit tree hash `4c7b678` exactly matched both locally verified P0-002 copies. The one-commit ancestry/path audit lists only the 17 documented task source, test, and record paths.
- `.gitignore` excludes dependencies, build output, releases, logs, and editor state. A tracked filename and credential-signature scan found no environment files, private keys, recognizable provider tokens, or task runtime/screenshot files.

**Verification**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm ci` | Installed the locked npm dependency graph in the clean WSL worktree; exit `0`. Upstream deprecation notices were informational. |
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js dist-test/tests/project-tasks.test.js dist-test/tests/wsl/project-system.test.js` | All three focused task-system files passed; exit `0`. |
| passed | `npm run check` | Strict main/renderer type checks and all 14 full compiled test files passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | `git diff --check origin/main...HEAD`; ancestry/path/tree audit | No whitespace errors; exactly one scoped task commit; transferred tree matched the locally verified tree byte-for-byte. |
| constrained | `npm start -- --enable-logging=stderr` bounded WSLg launch | Electron initialized under WSLg. Its persisted Codex thread could not auto-resume because this current Codex session already owned that thread's writer lock; the scoped app process exited and no Electron process remained. Prior same-tree renderer and production launch journeys remain recorded above. |

**Delivery state**

- Pushed `codex/p0-002-structured-tasks-delivery` and opened PR #5: `https://github.com/beautysamurai/workbench/pull/5`.
- The pull request documents behavior, exact verification, unavailable checks, risks, and excluded user/WB-006 state.
- Next action: commit and push this delivery record, then require both push- and pull-request-event CI plus automated review on the recorded head. Do not merge without separate user authorization.
- Blocker: none established.

### 2026-09-01 20:18 JST — P0-002 accepted image validation and concurrency review findings

**Remote evidence and disposition**

- PR #5 recorded head `bb90bb2` passed both workflow events: Linux verification completed in 18 and 22 seconds, and Windows portable verification/packaging completed in 1 minute 46 seconds and 2 minutes 28 seconds.
- Automated Codex review completed on task commit `b7f963f` and opened three P2 threads: malformed or empty WebP chunks could pass the shallow RIFF check; an oversized renderer-supplied typed array was copied before the 5 MB limit; and overlapping asynchronous paste/drop reads could replace rather than combine successfully read batches.
- All three findings are accepted. They affect the advertised image-safety boundary and ordinary task-composer behavior.

**Scoped correction**

- WebP validation now walks bounded RIFF chunks, enforces exact container and chunk lengths (including padding), validates VP8/VP8L/VP8X headers and dimensions, requires actual image payload data, and validates nested animated-frame image chunks. Empty VP8X metadata, truncated containers, malformed dimensions, and header-only image payloads are rejected.
- The main-process validator checks `byteLength` before making its defensive `Uint8Array` copy, avoiding the additional oversized allocation identified by review.
- Image reads now merge into the latest workspace draft after asynchronous byte/preview work completes. Count and aggregate-byte limits are rechecked against that latest state, so overlapping paste/drop batches cannot silently discard one another; a workspace switch also cannot repaint the wrong preview list.
- Focused regressions cover valid simple and extended WebP, empty/truncated WebP, pre-copy oversized rejection, out-of-order overlapping image reads, and final count enforcement.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js dist-test/tests/project-tasks.test.js` | Both focused files passed the new security and concurrency regressions; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Clean production compilation and asset copy completed; exit `0`. |
| passed | `git diff --check` and scoped diff review | No whitespace errors; correction is limited to image validation/merge code, focused tests, and this append-only review record. |

**Next action**

- Commit and push the accepted fixes, resolve all three review threads with commit evidence, then require fresh push- and pull-request CI plus automated review on the new exact head.
- Blocker: none established.

### 2026-09-01 20:35 JST — P0-002 accepted legacy-ID, PNG-integrity, and submission-race review findings

**Exact-head review evidence and disposition**

- Commit `ba13fa3` passed both push- and pull-request-event workflows: both Linux jobs passed in 15–16 seconds and both Windows portable/package jobs passed in 1 minute 50 seconds and 2 minutes 3 seconds.
- Automated Codex review completed on exact head `ba13fa3` and opened three findings: UUID-style `WB-A1B2C3D4` task IDs created by earlier Workbench releases were filtered from the queue; signature/IHDR/IEND-only PNG bytes could pass without image data or chunk-integrity checks; and an image finishing its asynchronous read while task submission was pending could be erased by successful cleanup.
- All three findings are accepted. They affect backward compatibility, the documented image-safety boundary, and preservation of an actively edited draft.

**Scoped correction**

- Task parsing and parent validation now accept the earlier eight-hex-character `WB-XXXXXXXX` format alongside current numeric IDs. Allocation remains sequential and attachment filenames remain constrained to IDs generated by the current writer.
- PNG validation now walks the complete bounded chunk stream, checks every chunk CRC and type, validates IHDR dimensions/encoding fields and palette constraints, rejects unknown critical or invalidly ordered chunks, requires non-empty contiguous IDAT data, and requires an exact terminal IEND.
- Submission captures the exact image-object snapshot sent to the main process. On success it removes only those submitted objects from the latest draft, preserving images added while the request was pending.
- Focused regressions cover legacy task visibility and parent references, valid PNG acceptance, missing IDAT and corrupted-IDAT rejection, and retention of a later image after earlier submission cleanup.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js dist-test/tests/project-tasks.test.js` | Both focused files passed; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `git diff --check` and scoped diff review | No whitespace errors; changes are limited to compatibility/PNG validation, renderer cleanup, focused tests, changelog, and this append-only record. |

**Next action**

- Commit and push this second review correction, resolve the three findings with exact-commit evidence, then require fresh CI and another automated review on the new head.
- Blocker: none established.

### 2026-09-01 20:45 JST — P0-002 accepted JPEG-structure and pending-field review findings

**Exact-head review evidence and disposition**

- Commit `85fa0ae` passed both push- and pull-request-event workflows: both Linux jobs passed in 18 seconds and both Windows portable/package jobs passed in 1 minute 42 seconds and 2 minutes 2 seconds.
- Automated Codex review completed on exact head `85fa0ae` and opened two P2 findings: JPEG acceptance searched for SOF-like bytes without walking marker boundaries or requiring a scan, and successful task submission still deleted text/select edits made after the submitted field snapshot.
- Both findings are accepted. They are the JPEG and non-image equivalents of the previously corrected structural-validation and draft-preservation cases.

**Scoped correction**

- JPEG validation now walks the bounded marker sequence from SOI through exact terminal EOI, checks segment lengths, frame precision/dimensions/components/sampling/table selectors, requires referenced frame components to appear in one or more bounded SOS scans, handles byte stuffing and restart markers, and requires non-empty encoded scan bytes.
- Task submission now snapshots all composer field values sent to the main process. Successful cleanup clears those fields only if the live draft still exactly matches that snapshot; any title, priority, parent, objective, or criteria edit made while awaiting completion remains visible.
- Focused regressions accept a framed/scanned JPEG, reject a frame-only JPEG and a truncated scan, and distinguish unchanged fields from a newer objective edit.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js dist-test/tests/project-tasks.test.js` | Both focused files passed; exit `0`. |
| passed | compiled `validateProjectTaskImage` against `/usr/share/emscripten/tests/screenshot.jpg` | Accepted the real 50,759-byte, 600×450 baseline JFIF fixture as `image/jpeg`; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `git diff --check` and scoped diff review | No whitespace errors; changes are limited to JPEG validation, submitted-field cleanup, focused tests, changelog, and this append-only record. |

**Next action**

- Commit and push this third review correction, resolve both findings with exact-commit evidence, then require fresh CI and another exact-head automated review.
- Blocker: none established.

### 2026-09-01 21:29 JST — P0-002 accepted deep-task-chain performance review finding

**Exact-head review evidence and disposition**

- Commit `f692ff8` passed both push- and pull-request-event workflows: both Linux jobs passed in 19–22 seconds and both Windows portable/package jobs passed in 1 minute 46 seconds and 1 minute 56 seconds.
- Automated Codex review completed on exact head `f692ff8` and opened one P2 finding: structural validation re-walked every ancestor for every task, making a valid deeply nested queue quadratic before recursive flattening and rendering.
- The finding is accepted. `TASKS.md` has no task-count bound, so a user-maintained deep queue must not stall or exhaust the renderer stack during ordinary inspection.

**Scoped correction**

- Unique task parent paths now resolve into a memoized issue map. Missing, ambiguous, cyclic, duplicate, and valid ancestry retain their existing visible outcomes while each unresolved parent edge is traversed once.
- Tree flattening and semantic nested-list rendering now use explicit stacks rather than recursive calls, preserving source/sibling order without call-stack depth dependence.
- A focused 2,000-level regression uses counted `parentId` getters to assert at most three reads per task across validation and attachment, then iteratively flattens all 2,000 nodes in order.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-tasks.test.js` | Focused structure, invalid-chain, concurrency, draft, and 2,000-level linearity regressions passed; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | bounded real WSLg renderer inspection | The production renderer produced five rows for five nodes, one expected nested list, maximum depth one, zero malformed direct row structures, no horizontal overflow, and no error toast; scoped Electron shutdown was clean. |
| passed | `git diff --check` and scoped diff review | No whitespace errors; changes are limited to linear task-tree validation/traversal, focused tests, changelog, and this append-only record. |

**Next action**

- Commit and push this fourth review correction, resolve the finding with exact-commit evidence, then require fresh CI and another exact-head automated review.
- Blocker: none established.

### 2026-09-01 21:57 JST — P0-002 accepted VP8-frame and duplicate-action review findings

**Exact-head review evidence and reproduction**

- Exact head `e847ae8` passed both workflow events: Linux verification completed in 17 and 18 seconds, and Windows portable/package jobs completed in 1 minute 47 seconds and 2 minutes 13 seconds.
- Automated Codex review completed on `e847ae8` and opened two P2 findings: lossy WebP validation ignored the VP8 frame tag and its declared first-partition bounds, and duplicate task rows exposed Send actions that both resolved through `tasks.find(id)` to the first duplicate.
- Both findings are accepted. A direct compiled reproducer changed the official libwebp 1×1 lossy fixture to declare a 49-byte first partition inside a 58-byte VP8 chunk; the pre-fix validator accepted it and exited `1`. A second reproducer clicked the conceptual second `WB-007` duplicate but demonstrated ID lookup resolving the first duplicate and exited `1`.

**Scoped correction**

- VP8 validation now parses the little-endian three-byte frame tag, requires a visible key frame with a defined profile, requires a non-empty first partition bounded after the ten-byte key-frame header, and leaves encoded token-partition data. The official 94-byte libwebp lossy fixture remains accepted; interframe, undefined-profile, invisible, empty-partition, and overlong-partition variants are rejected.
- Task-tree nodes now carry an explicit ID-uniqueness property. Send to Codex remains available only for uniquely identified, structurally valid, non-completed tasks and is absent for both rows of a duplicate ID. The handler independently rebuilds and checks a current linear tree snapshot before starting Codex work, so a stale or synthetic action cannot fall back to the first duplicate.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js dist-test/tests/project-tasks.test.js` | Both focused files passed the real lossy fixture, malformed frame-tag, duplicate-ID offer, completed-state, deep-tree, and prior image/draft regressions; exit `0`. |
| passed | direct compiled overlong-partition reproducer | The previously accepted malformed fixture now throws the supported-image validation error; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `git diff --check` and scoped diff review | No whitespace errors; changes are limited to VP8 validation, task offer eligibility/rendering, focused tests, changelog, task evidence, and this append-only record. |

**Next action**

- Commit and push this fifth review correction, reply to and resolve both findings with exact-commit evidence, then require fresh push/pull-request CI and another exact-head automated review.
- Blocker: none established.

### 2026-09-01 22:35 JST — P0-002 accepted truncated VP8L review finding

**Exact-head review evidence and reproduction**

- Commit `76d8649` passed both workflow events: Linux verification completed in 14 and 16 seconds, and both Windows portable/package jobs completed in 1 minute 51 seconds.
- Automated Codex review completed on exact head `76d8649` and opened one P2 finding: a six-byte VP8L payload containing only the signature, dimensions/version word, and one arbitrary byte passed because validation stopped after the five-byte lossless header.
- The finding is accepted. A direct compiled reproducer built a correctly bounded 26-byte RIFF/WebP container around payload `2f 00 00 00 00 00`; the pre-fix validator reported `BUG: accepted image/webp with 26 bytes` and exited `1`.

**Diagnosis and scoped correction**

- Electron `nativeImage.createFromBuffer` was tested as a possible complete-codec boundary, but returned an empty image for both the malformed payload and the known-good lossless fixture. It cannot safely distinguish supported WebP input in this runtime.
- Added a bounded VP8L parser that reads optional transforms, color-cache metadata, complete canonical prefix-code trees, meta-prefix groups, literals, LZ77 distances/lengths, and cache references until the dimensions' implicit pixel count is satisfied. Every read is constrained to the declared VP8L chunk; duplicate transforms, invalid trees/cache sizes/references, overlong copies, and premature end-of-stream fail closed.
- Focused regression coverage retains a transformed 17×9 lossless fixture, rejects the exact arbitrary six-byte stream, and rejects every shortened payload prefix of the known-good 1×1 fixture even when RIFF and VP8L lengths are adjusted to match the truncation.
- Five deterministic images encoded by the installed libwebp (`1×1`, `2×2`, `17×9`, `64×64`, and `257×33`) were accepted, while every shortened payload was rejected. A 500-case differential mutation check agreed exactly with libwebp: 119 mutations were accepted by both decoders, 381 rejected by both, and zero outcomes diverged.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js` | The focused image/task-system file passed the transformed lossless fixture, exact six-byte rejection, all truncated-prefix cases, and prior PNG/JPEG/VP8 regressions; exit `0`. |
| passed | direct compiled six-byte VP8L reproducer | The formerly accepted payload now throws the supported-image validation error; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-vp8l-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The isolated production app remained running under WSLg until intentional SIGINT; the scoped process check found no Electron process afterward. Existing DBus/GPU warnings were non-fatal. |
| passed | `git diff --check` and scoped diff review | No whitespace errors; changes are limited to bounded VP8L validation, focused fixtures/regressions, and task/changelog/progress evidence. |

**Next action**

- Commit and push this sixth review correction, reply to and resolve the finding with exact-commit evidence, then require fresh push/pull-request CI and another exact-head automated review.
- Blocker: none established.

### 2026-09-01 22:45 JST — P0-002 retained valid sparse VP8L simple codes

**Post-push local reflection**

- Exact correction `c0eced2` passed both workflow events: both Linux jobs completed in 16 seconds, and Windows verification/package jobs completed in 1 minute 52 seconds and 1 minute 47 seconds.
- Expanding the local differential check beyond the initial 500 mutations found one libwebp-accepted stream that Workbench rejected. The VP8L simple-code representation always carries up to two 8-bit symbol values, while the distance alphabet has only 40 usable entries; libwebp ignores an out-of-alphabet leaf and retains another valid in-range leaf, but Workbench rejected the whole tree immediately.
- The simple-code reader now records only symbols inside the active alphabet. The existing full-tree builder still rejects the stream if no usable leaf remains, so this restores compatible valid input without weakening truncated or malformed-tree rejection.
- A deterministic transformed-lossless fixture reproduces the sparse distance tree and remains in focused tests.

**Verification**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js` | Focused validation accepts the sparse simple-code fixture and retains all malformed/truncated image regressions; exit `0`. |
| passed | direct compiled validation of `/tmp/workbench-vp8l-17x9-decoder-only.webp` | The previously divergent libwebp-valid fixture is accepted as `image/webp`; exit `0`. |
| passed | 10,000 deterministic VP8L payload mutations compared with libwebp | Both accepted 1,283; both rejected 8,717; Workbench-only and libwebp-only divergence counts were both zero. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build && git diff --check` | Production build/assets and whitespace validation passed; exit `0`. |
**Next action**

- Commit and push the compatibility correction, then require fresh CI and automated review on the new exact head before closing PR #5 delivery.
- Blocker: none established.

### 2026-09-01 22:57 JST — P0-002 accepted PNG image-data review finding

**Exact-head review evidence and reproduction**

- Exact head `1a3e24a` passed both workflow events: Linux verification completed in 15 and 18 seconds, and Windows verification/package jobs completed in 1 minute 56 seconds and 2 minutes 8 seconds.
- Automated Codex review completed on exact head `1a3e24a` and opened one P2 finding: valid PNG chunk lengths and CRCs did not prove that concatenated IDAT bytes formed a complete zlib stream with the dimensions' required scanlines.
- The finding is accepted. A direct compiled reproducer replaced the known-good 1×1 PNG's 11 IDAT bytes with `0x41`, recomputed the IDAT CRC, and the pre-fix validator reported `BUG: accepted recomputed-CRC arbitrary IDAT as image/png`; exit `1`.

**Scoped correction**

- PNG validation now concatenates consecutive IDAT payloads, performs bounded zlib inflation, requires the inflater to consume every compressed byte, and requires the exact decompressed byte count implied by width, height, color type, bit depth, and interlace mode.
- Each non-interlaced or Adam7 pass row must begin with a defined PNG filter byte (`0` through `4`). Inflated data is capped at 160 MiB, so a compressed attachment cannot turn main-process validation into an unbounded decompression allocation.
- Focused regressions accept the known-good stream split across two IDAT chunks and a 1×1 Adam7 variant. They reject arbitrary recomputed-CRC compressed bytes, a valid zlib stream with filter type `5`, and a valid but short scanline stream.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js` | Focused PNG stream, split-IDAT, Adam7, filter, scanline-length, CRC, and prior JPEG/WebP regressions passed; exit `0`. |
| passed | direct compiled recomputed-CRC arbitrary-IDAT reproducer | The formerly accepted payload now throws the supported-image validation error; exit `0`. |
| passed | compiled validator across 221 PNG files under `/usr/share` | All 221 valid fixtures were accepted across indexed depths 1/2/4/8, grayscale, RGB, grayscale-alpha, RGBA, and 16-bit RGB formats. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build && git diff --check` | Production build/assets and whitespace validation passed; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-png-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The isolated production app remained running under WSLg until intentional SIGINT; no scoped Electron process remained. Existing DBus/GPU warnings were non-fatal. |

**Next action**

- Commit and push the PNG stream correction, resolve the review finding with evidence, then require fresh CI and exact-head automated re-review.
- Blocker: none established.

### 2026-09-02 00:17 JST — P0-002 accepted JPEG and lossy VP8 decode review findings

**Exact-head review evidence and reproduction**

- Exact head `c183dec` passed both workflow events: Linux verification completed in 16 and 17 seconds, and Windows verification/package jobs completed in 1 minute 48 seconds and 1 minute 52 seconds.
- Automated Codex review completed on exact head `c183dec` and opened two P2 findings: JPEG acceptance counted entropy bytes without decoding them against frame/table definitions, and lossy WebP acceptance bounded the VP8 envelope without decoding its first and token partitions.
- Both findings are accepted. A direct compiled reproducer supplied the prior tableless 1×1 JPEG with one arbitrary scan byte and changed byte 30 of the official 1×1 lossy WebP fixture to `0xff`; the pre-fix validator reported both as accepted and exited `1`.

**Scoped correction**

- JPEG candidates retain the strict marker walk and now must fully decode their tables and scan data. Lossy WebP candidates retain the RIFF/frame checks and every VP8 image payload, including animated-frame payloads, is wrapped at its declared boundary and decoded through libwebp.
- Decoding runs outside the Electron main thread through a globally serialized queue capped at eight pending requests. Input remains capped at 5 MiB per image; dimensions remain capped at 40 million pixels; aggregate WebP frames are capped at 128 and 40 million pixels; worker heap/stack limits are explicit; and a 15-second timeout terminates stalled work. Images in one task are validated sequentially.
- Focused regressions replace the former synthetic JPEG positive case with a complete independently Electron-accepted fixture. They reject the exact tableless scan, a real JPEG with truncated entropy data, a corrupt VP8 control partition, and an all-`0xff` VP8 token partition while retaining valid baseline JPEG, official lossy WebP, transformed/sparse lossless WebP, extended WebP, and prior PNG cases. Nine simultaneous decode requests deterministically admit the capped eight and reject the excess request with an actionable retry error.
- Production dependencies are pinned to `jpeg-js@0.4.4` and `webp-wasm@1.0.6`. Packaging includes both decoder modules, the worker script, and `webp_node_dec.wasm`.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js` | Focused complete JPEG, tableless/truncated JPEG, valid lossy WebP, corrupt VP8 control/token partition, bounded decode-queue, PNG, and VP8L regressions passed; exit `0`. |
| passed | direct compiled two-payload reproducer | Both formerly accepted malformed payloads now throw the supported-image validation error; exit `0`. |
| passed | compiled validator against `/usr/share/emscripten/tests/screenshot.jpg` | The real 50,759-byte baseline JPEG remains accepted as `image/jpeg`; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `npm run dist:dir` plus ASAR inventory/runtime validation | Linux directory packaging completed; the archive contains the decoder worker and WebP WASM; Electron loaded both JPEG and WebP decoders directly from `app.asar`; exit `0`. |
| passed | built Electron validator smoke | A real JPEG and official lossy WebP were accepted, the corrupt VP8 partition was rejected, and no scoped Electron/worker process remained; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-decode-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The isolated production app remained running until intentional SIGINT; no scoped Electron or decoder-worker process remained. Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |

**Next action**

- Commit and push this exact-head decode correction, reply to and resolve both review findings with commit evidence, then require fresh CI and automated review on the new head.
- Blocker: none established.

### 2026-09-02 20:06 JST — P0-002 accepted PNG responsiveness and animated-WebP canvas review findings

**Exact-head review evidence and reproduction**

- Exact head `c9e77c6` passed both workflow events: Linux verification completed in 15 and 16 seconds, and Windows verification/package jobs completed in 1 minute 48 seconds and 1 minute 53 seconds.
- Automated Codex review completed on exact head `c9e77c6` and opened two P2 findings: bounded PNG inflation still ran synchronously in Electron's main process, and animated WebP frame offsets were not checked against the VP8X canvas.
- Both findings are accepted. A direct compiled reproducer used a 36,761-byte PNG whose scanlines inflate to 37,751,808 bytes and a structurally complete 1×1 animated WebP whose frame begins at x=2. Before the correction, the validation call blocked synchronously for 42.5 ms and the out-of-canvas frame was accepted; exit `1`.

**Scoped correction**

- The main process still performs bounded PNG signature, chunk, CRC, header, palette, and ordering checks, then sends only concatenated IDAT bytes plus the derived scanline-pass layout through the existing globally serialized image-worker queue. The worker revalidates request limits, caps output at 160 MiB, requires exact compressed-stream consumption and output length, and checks every PNG filter byte without returning inflated pixels to the main process.
- The worker protocol now explicitly distinguishes valid, invalid, and malformed responses across PNG, JPEG, and WebP requests while retaining the eight-request admission cap, 15-second timeout, and explicit heap/stack limits.
- VP8X canvas dimensions and feature flags are retained. Every ANMF frame now requires the animation feature, valid frame flags, a declared canvas, and an x/y/width/height rectangle wholly inside that canvas before its nested image payload is accepted.
- Focused regressions prove that a highly compressible 2048×2048 RGBA PNG yields to a queued microtask before validation completes, accept a valid animated 1×1 WebP, and reject both a missing-canvas animation and the exact out-of-canvas frame.
- `TASKS.md`, `CHANGELOG.md`, and `docs/ARCHITECTURE.md` now describe off-main-thread PNG inflation and animated-frame canvas enforcement.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js` | Focused PNG-yield, valid animation, missing/out-of-bounds canvas, and prior image/task regressions passed; exit `0`. |
| passed | direct compiled PNG/animated-WebP reproducer | The 37,751,808-byte inflation returned from the validation call in 1.6 ms before completing in its worker, and the formerly accepted out-of-canvas frame was rejected; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `npm run dist:dir` plus ASAR inventory/runtime validation | Linux directory packaging completed; the archive contains the worker and decoder assets. Electron loaded the packaged worker, accepted PNG/JPEG/WebP, and rejected the out-of-canvas animation; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-review-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The production app remained running until intentional SIGINT; no Electron process remained. Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |
| passed | `git diff --check` and scoped path review | No whitespace errors; the seven changed paths are limited to image validation, focused tests, task/changelog/architecture records, and this append-only entry. |

**Next action**

- Commit and push the correction, reply to and resolve both review findings with exact commit evidence, then require fresh CI and automated review on the new head before closing PR #5 delivery.
- Blocker: none established.

### 2026-09-02 20:45 JST — P0-002 accepted WebP alpha and lossless-worker review findings

**Exact-head review evidence and reproduction**

- Exact head `b2d0cea` passed both workflow events: Linux verification completed in 16 and 18 seconds, and Windows verification/package jobs completed in 1 minute 49 seconds and 1 minute 53 seconds. All 17 prior review threads were resolved with commit evidence.
- Automated Codex review completed on exact head `b2d0cea` and opened two P2 findings: an invalid ALPH chunk could be skipped before a separately decoded VP8 payload, and the complete custom VP8L parser still ran synchronously in Electron's main process.
- Both findings are accepted. A direct compiled reproducer supplied a valid 34-byte lossless WebP declaring 39,993,344 pixels and an extended 1×1 lossy WebP with a zero-length ALPH chunk. Before the correction, the lossless parser held the validation call for 34.0 ms and the malformed alpha file was accepted; exit `1`.

**Scoped correction**

- Main-process WebP work is now limited to bounded RIFF/chunk traversal, cheap VP8/VP8L/VP8X header checks, aggregate pixel/frame limits, animation-control structure, and frame/canvas geometry. Every complete simple WebP and every reconstructed animated-frame chunk stream is decoded through libwebp in the existing globally serialized, admission/time/memory/pixel-bounded worker.
- Standalone animation-frame reconstruction retains the declared frame dimensions and adds a VP8X alpha envelope only when an ALPH chunk is present. This lets libwebp validate both ALPH+VP8 and VP8L frames even though its simple decode API does not decode a complete animated container.
- The now-redundant 370-line custom VP8L parser was removed. Lossless streams share the same full-decoder boundary as lossy and alpha-bearing WebP, and worker-returned dimensions must still match the bounded structural metadata.
- Focused regressions accept baseline, transformed, sparse-code, 2048×2048 compressible, and near-40MP lossless WebP; accept valid ALPH and animated-ALPH fixtures; reject zero-length ALPH in both simple and animated files; and prove nine concurrent lossless requests use the same eight-request admission cap as JPEG.
- `TASKS.md`, `CHANGELOG.md`, and `docs/ARCHITECTURE.md` now describe complete off-main-thread WebP decoding and alpha validation.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js` | Focused full-WebP worker, valid/malformed ALPH, valid animated ALPH, near-40MP VP8L, concurrency, and prior image/task regressions passed; exit `0`. |
| passed | direct compiled VP8L/ALPH reproducer | The same 39,993,344-pixel lossless file returned from the validation call in 0.4 ms before worker completion, and the formerly accepted zero-length ALPH file was rejected; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `npm run dist:dir` plus ASAR inventory/runtime validation | Linux directory packaging completed; the obsolete custom VP8L parser is absent. Electron loaded the packaged worker, accepted PNG/JPEG/lossy/lossless/alpha/animated WebP, and rejected malformed alpha plus out-of-canvas animation; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-webp-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The production app remained running until intentional SIGINT; no Electron process remained. Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |
| passed | `git diff --check` and scoped path review | No whitespace errors; changes are limited to the WebP validation boundary, focused fixtures, task/changelog/architecture records, deletion of the superseded parser, and this append-only entry. |

**Next action**

- Commit and push the correction, reply to and resolve both exact-head review findings with evidence, then require fresh CI and automated review on the new head before closing PR #5 delivery.
- Blocker: none established.


### 2026-09-02 21:03 JST — P0-002 accepted post-append result and WebP ALPH-sequence findings

**Exact-head review and reproduction**

- Exact head `217935d` passed both workflow events: Linux verification completed in 20 and 22 seconds, and Windows verification/package jobs completed in 1 minute 48 seconds and 2 minutes 15 seconds. All 19 prior review threads were resolved with commit evidence.
- Automated Codex review completed on exact head `217935d` and opened one P2 finding: a failure in the inspection performed after a successful `TASKS.md` append rejected the add operation even though the task and images were durable, leaving the renderer draft available for a duplicate retry.
- The finding is accepted. A focused WSL integration regression watches for the committed heading, corrupts sequence metadata before the follow-up inspection, and reproduced the pre-fix `Task id sequence is corrupt.` rejection while exactly one `WB-001` task remained on disk; the direct test exited `1`.
- Final-diff reflection also found that libwebp tolerates duplicate ALPH chunks and ALPH placed after VP8. A direct compiled probe showed that both malformed still-image forms and both corresponding animated-frame forms were accepted before the correction; exit `1`.

**Scoped correction**

- Task creation now builds a validated known status before writing, treats the locked Markdown append as its commit point, and still attempts a fresh inspection. If only that post-commit inspection fails, it returns the known committed task, attachment metadata, and next ID instead of reporting the durable add as failed. Failures before the append retain the existing image-cleanup and rejection behavior.
- WebP structure validation now permits at most one ALPH chunk, requires it directly before lossy VP8 data, rejects it after image data or with VP8L, and requires the retained VP8X canvas to advertise alpha. Complete ALPH payload decoding remains in the bounded worker.
- Focused tests cover the post-commit fallback with the exact image bytes still persisted, plus duplicate and reordered ALPH chunks in still and animated WebP containers.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js dist-test/tests/wsl/project-system.test.js` | Focused image-structure and post-commit integration regressions passed; exit `0`. |
| passed | direct compiled seven-case ALPH sequence probe | Valid alpha remained accepted; reordered, duplicate, lossless-only, and corresponding animated ALPH sequences were rejected; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `npm run dist:dir` plus packaged-ASAR validator | Linux directory packaging completed. Electron loaded the packaged worker; accepted PNG/JPEG/lossy/lossless/alpha/animated WebP; and rejected out-of-canvas, empty, reordered, and duplicate alpha data; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-webp-final-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The production app remained running until intentional SIGINT; no Electron process remained. Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |

**Next action**

- Review the scoped diff, commit and push both corrections, reply to and resolve the accepted review finding with commit evidence, then require fresh CI and exact-head automated review.
- Blocker: none established.

### 2026-09-02 21:17 JST — P0-002 accepted hard-link boundary review finding

**Exact-head review and reproduction**

- Exact head `4a0a5ce` passed both workflow events: Linux verification completed in 16 and 18 seconds, and Windows verification/package jobs completed in 2 minutes 2 seconds and 3 minutes 26 seconds. All 20 prior review threads were resolved with commit evidence.
- Automated Codex review completed on exact head `4a0a5ce` and opened one P1 finding: an in-workspace hard link to an external `TASKS.md` inode passed the regular-file and `realpath` checks, so appending through it could modify data outside the selected workspace.
- The finding is accepted. A focused WSL regression creates exactly that two-link inode. Before the correction, project inspection reported the linked `TASKS.md` as safe (`true` instead of expected `false`); the direct test exited `1`.

**Scoped correction**

- Project workflow inspection and initialization now require each resolved Markdown file to have a link count of exactly one. Task reads and the locked append repeat the invariant at their operation boundary.
- The same invariant protects the persistent task-sequence and lock files, preventing workspace-controlled hard links from redirecting metadata reads or locking to an external inode. Existing escaping-symlink, regular-file, fixed-path, and `realpath` checks remain in force.
- The focused regression verifies unsafe status, an actionable rejection, and byte-for-byte preservation of the external file.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/wsl/project-system.test.js` | The hard-link boundary case and all prior WSL project-system integration cases passed; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including the hard-link WSL integration case, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `npm run dist:dir` plus packaged-ASAR validator | Linux directory packaging completed. The packaged project service marked the hard-linked task file unsafe, rejected the add, and preserved the external inode; prior PNG/JPEG/WebP cases also passed; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-hardlink-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The production app remained running until intentional SIGINT; no Electron process remained. Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |

**Next action**

- Commit and push the verified hard-link correction, resolve the accepted finding with exact evidence, then require fresh CI and exact-head automated review.
- Blocker: none established.

### 2026-09-02 21:36 JST — P0-002 accepted anchored-image and legacy-ID review findings

**Exact-head review and reproduction**

- Exact head `5ca637f` passed both workflow events: Linux verification completed in 16 and 17 seconds, and Windows verification/package jobs completed in 1 minute 25 seconds and 1 minute 49 seconds. All 21 prior review threads were resolved with commit evidence.
- Automated Codex review completed on exact head `5ca637f` and opened two findings: P1 for image writes that reused a validated pathname and could follow a replacement symlink, and P2 for filtering arbitrary IDs that the prior task parser kept visible.
- Both findings are accepted. A deterministic WSL reproducer shadows `realpath`, swaps the validated `.workbench/task-images` directory for an external symlink immediately after resolution, and showed the pre-fix add succeeded with `WB-001-01.png` written externally; the direct test exited `1`.
- A focused parser reproducer supplied `TASK-A` and a full UUID. Before the correction both disappeared (`[]`), and after restoring visibility a second assertion caught the UUID suffix incorrectly producing `WB-446655440001`; each pre-fix direct run exited `1`.

**Scoped correction**

- The task-image directory is now opened as file descriptor 8 after path validation, the opened handle is resolved back to the expected directory, and all generated target, temporary, rename, size, permission, and cleanup paths use `/proc/$$/fd/8`. A pathname replacement after validation therefore cannot redirect writes.
- Task parsing retains every nonempty, non-placeholder legacy heading ID. The explicit `WB-NNN` and `P?-NNN` examples remain excluded, newly formatted IDs and parent input remain constrained, and full UUIDs are excluded from numeric high-water calculation.
- Focused tests retain named and UUID tasks without disturbing the next generated ID, and deterministically reject the image-directory swap without an external write or task append. Six repeated race-regression runs also passed.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/project-system.test.js dist-test/tests/wsl/project-system.test.js` | Focused legacy-ID, UUID high-water, anchored image-directory, and prior image/task regressions passed; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run build` | Production main/renderer compilation and asset copy completed; exit `0`. |
| passed | `npm run dist:dir` plus packaged-ASAR validator | Linux directory packaging completed. The packaged service created a real PNG task through the anchored directory handle and verified its exact bytes; all prior format, hard-link, and image-decoder checks also passed; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-anchored-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The production app remained running until intentional SIGINT; no Electron process remained. Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |

**Next action**

- Review the scoped diff, commit and push both corrections, resolve both accepted findings with exact evidence, then require fresh CI and exact-head automated review.
- Blocker: none established.

### 2026-09-02 22:12 JST — P0-002 accepted metadata-anchor and legacy-parent review findings

**Exact-head review and reproduction**

- Exact head `e0dace1` passed both workflow events: both Linux verification jobs completed in 17 seconds, and Windows verification/package jobs completed in 1 minute 50 seconds and 1 minute 52 seconds. All 23 prior review threads were resolved.
- Automated Codex review completed on `e0dace1` and opened two findings: P1 because `.workbench` could be replaced after validation and redirect the lock/counter operations, and P2 because a retained arbitrary legacy task exposed an Add subtask action whose parent ID the main process rejected.
- Both findings are accepted. `node /tmp/workbench-p0-review-repro.cjs` reproduced the pre-fix boundary behavior with exit `1`: the operation rejected only after creating external `task-sequence` and `task-sequence.lock` files, while a child of `TASK-A` rejected with `Parent task id is invalid.`
- Final-diff reflection found the same pathname race on the selected workspace root and `TASKS.md` read/append paths, so those members of the same trust boundary were included rather than leaving equivalent external-write paths behind.

**Scoped correction**

- Each project operation now pins the workspace root and metadata directory, opens `TASKS.md`, the lock, sequence counter, and image directory through dedicated Linux descriptors, and verifies canonical path plus device/inode identity after opening. Regular-file/directory and single-link checks apply to the opened objects before use.
- Task reads and appends, lock acquisition, sequence reads and atomic replacement, image creation/rename, and cleanup all use `/proc` descriptor paths. Deterministic wrappers replace the root, task file, metadata directory, or image directory at each former validation gap; all now reject without writing to the replacement target.
- Parsing and formatting now retain arbitrary non-placeholder parent IDs. The existing-chain check still requires exactly one matching task with a valid acyclic ancestry, so named and UUID-style legacy tasks can be real parents without allowing missing, duplicate, cyclic, or template-placeholder parents.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests` then `node --test dist-test/tests/project-system.test.js dist-test/tests/wsl/project-system.test.js` | Focused parser, named-parent, root/task/metadata/image replacement, hard-link, append, concurrency, and image cases passed; exit `0`. |
| passed | `node /tmp/workbench-p0-review-repro.cjs` | The exact metadata reproducer rejected with no external entries and the named child was accepted; exit `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run dist:dir` | Production compilation and Linux directory packaging completed; exit `0`. |
| passed | packaged-ASAR validator | Electron loaded the packaged project service; real anchored image/task creation, named-parent creation, metadata-swap rejection, hard-link rejection, and all prior PNG/JPEG/WebP cases passed; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-final-handle-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The full app remained running until intentional SIGINT; `pgrep -a -x electron` returned no remaining process. Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |

**Next action**

- Review the final scoped diff, commit and push the corrections, reply to and resolve both accepted findings, then require fresh CI and exact-head automated review.
- Blocker: none established.

### 2026-09-02 22:41 JST — P0-002 accepted temporary-image installation review finding

**Exact-head review and reproduction**

- Exact head `f565417` passed both workflow events: Linux verification completed in 20 and 26 seconds, and Windows verification/package jobs completed in 1 minute 49 seconds and 1 minute 55 seconds. All 25 prior review threads were resolved with commit evidence.
- Automated Codex review completed on exact head `f565417` and opened one P1 finding: the validated task-image bytes were written to a temporary pathname that was closed before `wc`, `chmod`, and `mv` reopened it, allowing a concurrent workspace process to replace the entry.
- The finding is accepted. `node /tmp/workbench-p0-temp-race-repro.cjs` deterministically replaces the temporary entry immediately after `cat`. Before the correction, the task succeeded, the final attachment was a symlink to the external file, and that file's mode changed from `0600` to `0644`; `safe` was `false` and the command exited `1`.

**Scoped correction**

- Temporary task-image creation now atomically opens descriptor 3 with no-clobber semantics and keeps it open while stdin is streamed. Byte count, file type, device/inode identity, link count, and mode changes are checked through `/proc/$$/fd/3` rather than reopening the temporary pathname.
- Final installation creates a no-clobber hard link from the pinned descriptor into the already pinned image directory. The target must identify the same inode, and removing the temporary name must leave exactly one link before the task may commit.
- A focused WSL regression unlinks the temporary entry and replaces it with an external symlink after `cat` returns. Workbench now rejects the changed inode, removes the replacement link, leaves no final attachment or task entry, preserves the external bytes, and leaves its mode at `0600`.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node dist-test/tests/wsl/project-system.test.js` | All 17 WSL project-system cases passed, including the deterministic temporary-image replacement; exit `0`. |
| passed | `node --test dist-test/tests/project-system.test.js dist-test/tests/project-tasks.test.js dist-test/tests/wsl/project-system.test.js` | Focused parser, renderer task-tree, image validation, and WSL filesystem cases passed; exit `0`. |
| passed | `node /tmp/workbench-p0-temp-race-repro.cjs` | The exact replacement was rejected with `Task image temporary file changed during writing`; no target existed, the outside mode remained `600`, `safe` was `true`, and the command exited `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run dist:dir` | Production compilation and Linux directory packaging completed; exit `0`. |
| passed | packaged-ASAR validator | Electron loaded the packaged project service; `temporaryRaceSafe` and all prior PNG/JPEG/WebP, anchored path, named-parent, metadata-swap, and hard-link checks were true; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-temp-handle-profile`, observed for five seconds, then Ctrl+C | The full app remained running until intentional SIGINT; `pgrep -a -x electron` returned no remaining process. Existing DBus warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |

**Next action**

- Review the final scoped diff, commit and push the correction, reply to and resolve the accepted finding, then require fresh CI and exact-head automated review.
- Blocker: none established.

### 2026-09-02 23:04 JST — P0-002 accepted stale-parent append review finding

**Exact-head review and reproduction**

- Exact head `82f4c59` passed both workflow events: Linux verification completed in 21 and 22 seconds, and Windows verification/package jobs completed in 1 minute 53 seconds and 2 minutes 8 seconds. All 26 prior review threads were resolved with commit evidence.
- Automated Codex review completed on exact head `82f4c59` and opened one P2 finding: a selected parent was validated before image preparation, but the locked append did not revalidate `TASKS.md`, so an intervening manual parent removal or duplicate could commit an unusable child.
- The finding is accepted. `node /tmp/workbench-p0-parent-race-repro.cjs` deterministically removed `P1-004` after the image stream completed. Before the correction, the call returned success, appended `WB-005` with the now-missing parent, retained its image, reported `safe: false`, and exited `1`.

**Scoped correction**

- Child-task preparation now records a SHA-256 digest of the exact `TASKS.md` snapshot whose full parent chain passed uniqueness and cycle validation. After taking the existing workspace task lock and opening the pinned append handle, Workbench hashes that same inode and rejects if it changed before writing.
- The existing failure path removes every image written for the rejected child while preserving the user's intervening Markdown edit. Parentless additions retain their existing concurrent-process behavior because they cannot become orphaned through this race and still use the locked duplicate-ID check.
- The deterministic WSL regression removes the parent during image writing and verifies the edit remains exact, the child is absent, and the image directory is empty. An initially broader stale-file guard exposed and was narrowed by the existing cross-process test, preserving simultaneous parentless additions and durable unique IDs.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node dist-test/tests/wsl/project-system.test.js` | All 18 WSL project-system cases passed, including stale-parent rejection and existing in-process/cross-process concurrency; exit `0`. |
| passed | `node /tmp/workbench-p0-parent-race-repro.cjs` | The exact race rejected with `TASKS.md changed while the task was being prepared`; the manual edit remained, no image existed, `safe` was `true`, and the command exited `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run dist:dir` | Production main/renderer compilation and Linux directory packaging completed; exit `0`. |
| passed | packaged-ASAR validator | Electron loaded the packaged project service; `parentRaceSafe`, `temporaryRaceSafe`, and all prior PNG/JPEG/WebP, anchored-path, named-parent, metadata-swap, and hard-link checks were true; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-parent-race-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The full app remained running until intentional SIGINT; `pgrep -a -x electron` returned no remaining process. Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |
| passed | `git diff --check` | The scoped source, test, and documentation changes contain no whitespace errors; exit `0`. |

**Next action**

- Review the scoped diff, commit and push this correction, reply to and resolve the accepted finding, then require fresh CI and exact-head automated review.
- Blocker: none established.

### 2026-09-02 23:38 JST — P0-002 atomic task-file update review correction

**Exact-head review and reproduction**

- Exact head `8e9d85a` passed both workflow events: Linux verification completed in 20 and 25 seconds, and Windows verification/package jobs completed in 1 minute 48 seconds and 2 minutes 13 seconds. All 27 prior review threads were resolved with evidence.
- Automated Codex review completed on `8e9d85a` and opened one P2 finding: the new digest still preceded the duplicate-ID check and in-place append, leaving a narrow race for an editor that does not honor Workbench's private lock.
- The finding is accepted. `node /tmp/workbench-p0-atomic-parent-race-repro.cjs` atomically replaced `TASKS.md` immediately after the pre-fix digest check. Before this correction the call returned success, appended an orphaned `WB-005`, retained its image, reported `safe: false`, and exited `1`.

**Scoped correction**

- Task creation now builds a complete candidate from the exact validated snapshot and task block, verifies its byte count and SHA-256 digest through a pinned descriptor, and preserves the source task file's mode.
- Under the existing workspace lock, Workbench revalidates the current task inode and content, atomically moves that exact entry to a private claim, revalidates the claimed handle, and no-clobber-links the pinned candidate into `TASKS.md`. A replacement before the claim is restored rather than overwritten; a competing target prevents installation.
- Stale transactions re-read and reparse the editor's current Markdown. Compatible edits retry without loss; removing, duplicating, or cycling the selected parent rejects the child and cleans its staged images. Successful candidate installation remains the commit point, and the fallback result now includes any compatible task-file changes observed during retry.
- Focused regressions cover an in-place edit during image preparation, an atomic replacement at the claim boundary, preservation plus retry of a compatible concurrent note, six simultaneous Workbench processes, read-only rejection, final mode/link invariants, and transaction-file cleanup. The first prototype's unconditional four-attempt guard was rejected by existing watcher, permission, and six-process cases before delivery; the final bounded transaction passes all of them.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node dist-test/tests/wsl/project-system.test.js` | All 20 WSL project-system cases passed, including both task-file races, compatible retry, six-process contention, read-only failure, and prior filesystem/image regressions; exit `0`. |
| passed | three parallel repetitions of `node dist-test/tests/wsl/project-system.test.js` | Each repetition passed all 20 cases with zero failures; exits `0`. |
| passed | `node /tmp/workbench-p0-parent-race-repro.cjs` and `node /tmp/workbench-p0-atomic-parent-race-repro.cjs` | Both exact races rejected with `Choose an existing parent task.`; the manual `# Tasks` edit remained exact, no image existed, `safe` was `true`, and both commands exited `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run dist:dir` | Production main/renderer compilation and Linux directory packaging completed; exit `0`. |
| passed | packaged-ASAR validator | Electron loaded the packaged project service; the atomic replacement reported `parentRaceSafe: true`, and `temporaryRaceSafe` plus all prior PNG/JPEG/WebP, anchored-path, named-parent, metadata-swap, and hard-link checks were true; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-atomic-task-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The full app remained running until intentional SIGINT; `pgrep -a -x electron` returned no remaining process. Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |
| passed | `git diff --check` | The scoped source, test, and documentation changes contain no whitespace errors; exit `0`. |

**Next action**

- Review the complete transaction diff, commit and push the correction, reply to and resolve the accepted finding, then require fresh CI and exact-head automated review.
- Blocker: none established.

### 2026-09-02 23:41 JST — P0-002 final no-clobber transaction coverage

- Final-diff reflection added one more commit-boundary case: an editor creates a new canonical `TASKS.md` after Workbench claims the validated version but before candidate installation. The pinned candidate uses a no-clobber link, so Workbench preserves that new file, removes the now-obsolete validated claim and candidate, rejects the invalidated child, and cleans its image.
- `npm run build:tests && node dist-test/tests/wsl/project-system.test.js` passed all 21 focused WSL cases; `npm run check` passed strict types and all 14 full test files; `npm run dist:dir` packaged the exact final tree; and the packaged-ASAR validator again reported `parentRaceSafe: true` with every prior validation flag true. The exact final app remained stable for five seconds until intentional SIGINT and left no Electron process. All commands exited `0` except the expected `pgrep -a -x electron` no-match exit `1`.
- The final scoped diff passes `git diff --check`. Next action remains commit, push, review-thread resolution, green exact-head CI, and clean exact-head automated re-review.

### 2026-09-02 23:44 JST — P0-002 frozen atomic-update verification

- The frozen transaction also compares the source mode before and after claiming the inode; the compatible-edit regression changes both Markdown and mode, then proves the retry retains the note and final `0600` permissions. The final focused run passed all 21 WSL cases and both standalone race reproducers with `safe: true`.
- On this exact source tree, `npm run check` passed strict types and all 14 full test files, `npm run dist:dir` completed, and the packaged-ASAR validator reported every flag true including `parentRaceSafe` and `temporaryRaceSafe`. `npm start -- --user-data-dir=/tmp/workbench-p0-atomic-task-exact-profile --enable-logging=stderr` remained stable for five seconds until intentional SIGINT, after which no Electron process remained.
- No further source or test edits followed these checks. Next action is the delivery/re-review gate; blocker: none established.

### 2026-09-03 19:58 JST — P0-002 workflow-symlink and image-cleanup review correction

**Exact-head review and reproduction**

- Exact head `c1912a9` passed both workflow events: Linux verification completed in 27 and 21 seconds, and Windows package jobs completed in 1 minute 54 seconds and 1 minute 42 seconds. All 28 prior review threads were resolved with commit evidence.
- Automated Codex review on that exact head opened two P2 findings. Inspection and initialization treated an in-workspace `TASKS.md` symlink as ready even though the atomic updater could not commit through it; failed task cleanup also removed a generated image path without proving it still named the inode Workbench wrote.
- Both findings are accepted. Before correction, `node /tmp/workbench-p0-task-symlink-repro.cjs` reported `inspectedReady: true` and `inspectedSafe: true`, then failed the add after reserving an ID; the command exited `1`. `node /tmp/workbench-p0-image-cleanup-race-repro.cjs` replaced the written attachment with a concurrent `0600` file immediately before forcing Markdown failure; cleanup deleted that replacement, reported `safe: false`, and exited `1`.

**Scoped correction**

- Inspection, initialization, and direct task-file opening now consistently require `AGENTS.md`, `TASKS.md`, and `WORKBENCH_PROGRESS.md` to be direct regular files. Every workflow-file symlink is classified unsafe before task-sequence reservation or image staging, avoiding a UI-ready state that the atomic updater cannot honor.
- Successful image installation returns its device/inode identity, observed post-installation mode, and a SHA-256 digest to the task transaction. Failure cleanup opens the generated target, validates its path and pinned handle against that identity, single-link count, recorded mode (`0644` on the regression filesystem), and digest, then atomically moves the entry to a private claim and revalidates the still-open descriptor before unlinking it.
- If a replacement appears before cleanup, it fails those ownership checks and remains untouched. If replacement occurs at the claim boundary, the mismatched claim is moved back without clobbering a competing target; an unrecoverable collision is surfaced instead of deleting unknown data.
- Focused regressions prove a same-workspace workflow symlink is unsafe before reservation/staging and inject an image replacement at the cleanup claim boundary, preserving its exact bytes and `0600` mode with no leftover claim. The standalone direct replacement and a second standalone claim-boundary reproducer both report safe outcomes.
- Files changed: `src/main/project-system.ts`, `tests/wsl/project-system.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `TASKS.md`, `CHANGELOG.md`, and this append-only progress record.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node dist-test/tests/wsl/project-system.test.js` | All 23 WSL project-system cases passed, including both new regressions and every prior task/image/filesystem race; exit `0`. |
| passed | three parallel repetitions of `node dist-test/tests/wsl/project-system.test.js` | Every repetition passed all 23 cases with zero failures; exits `0`. |
| passed | `node /tmp/workbench-p0-task-symlink-repro.cjs` | Inspection reported the workflow symlink unsafe/not ready, add rejected before an ID or image was staged, `consistent` was `true`, and the command exited `0`. |
| passed | `node /tmp/workbench-p0-image-cleanup-race-repro.cjs` and `node /tmp/workbench-p0-image-cleanup-claim-race-repro.cjs` | Direct pre-cleanup and exact claim-boundary replacements both remained byte-exact at mode `0600`; both reported `safe: true` and exited `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run dist:dir` | Production main/renderer compilation and Linux directory packaging completed; exit `0`. |
| passed | packaged-ASAR validator | Electron loaded the packaged project service; `workflowSymlinkSafe`, `cleanupRaceSafe`, `parentRaceSafe`, `temporaryRaceSafe`, and every prior validation flag were true; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-review-correction-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The full app remained running until intentional SIGINT; the expected command exit was `1`, and `pgrep -a -x electron` then returned no process (no-match exit `1`). Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |
| passed | `git diff --check` | The scoped source, test, and documentation changes contain no whitespace errors; exit `0`. |

**Next action**

- Commit and push the reviewed correction, reply to and resolve both accepted findings, then require fresh CI and an automated re-review on the exact new head.
- Blocker: none established.

### 2026-09-03 20:02 JST — P0-002 frozen cleanup-identity verification

- Final portability reflection replaced the cleanup's assumed Linux `0644` value with the exact post-installation mode returned alongside the written inode identity. Cleanup therefore compares the recorded mode on filesystems with different permission semantics while the Linux regressions still prove that a concurrent `0600` replacement is preserved.
- On this exact source, the focused WSL run and all three standalone reproducers passed, followed by `npm run check:portable` (13 files) and `npm run check` (14 files). After production packaging removed disposable `dist-test`, three attempted direct repetitions correctly failed with `MODULE_NOT_FOUND`; rebuilding with `npm run build:tests` and repeating in parallel then passed all 23 cases three times.
- The first final `npm run dist:dir` attempt completed compilation but failed while resolving `github.com` with `EAI_AGAIN`; the required network-enabled retry completed packaging. The rebuilt packaged-ASAR validator reported every flag true, including `workflowSymlinkSafe` and `cleanupRaceSafe`.
- `npm start -- --user-data-dir=/tmp/workbench-p0-review-correction-final-profile --enable-logging=stderr` remained stable for five seconds until intentional SIGINT; `pgrep -a -x electron` then produced no output (expected no-match exit `1`). No source or test edits followed these final checks.
- Next action: commit and push this frozen correction, resolve the two findings with exact evidence, and require green CI plus clean automated review on the new head. Blocker: none established.

### 2026-09-03 20:27 JST — P0-002 indexed-PNG palette review correction

**Exact-head review and reproduction**

- Exact head `9b78c21` passed both workflow events: Linux verification completed in 24 and 22 seconds, and Windows package jobs completed in 2 minutes 3 seconds and 1 minute 34 seconds. Its workflow-symlink and cleanup findings were resolved, and the merge state was clean.
- Automated Codex review completed on that exact head and opened one P2 finding: the PNG worker validated inflation length and filter-byte ranges but did not reconstruct indexed scanlines, so a pixel could reference an entry beyond the declared `PLTE`.
- The finding is accepted. `node /tmp/workbench-p0-indexed-png-repro.cjs` built a valid-CRC, valid-zlib, one-pixel indexed PNG with one palette entry. Before correction, both sample `0` and out-of-range sample `1` were accepted, `safe` was `false`, and the command exited `1`.

**Scoped correction**

- The bounded worker request now includes PNG color type, bit depth, palette-entry count, and each non-empty scanline pass width in addition to row bytes/count and compressed IDAT bytes. The worker independently validates that metadata and its computed row sizes.
- Indexed scanlines are reconstructed with the PNG None, Sub, Up, Average, and Paeth filters, resetting the prior row at each Adam7 pass. Packed 1-, 2-, and 4-bit and direct 8-bit palette samples are then checked against the actual palette-entry count before acceptance.
- Non-indexed images retain the prior lightweight filter-byte validation, avoiding a new full-pixel loop for the existing 40-million-pixel limit. Inflation, queue, worker memory, output, and timeout bounds remain unchanged.
- The portable regression accepts a valid one-entry indexed image, rejects the exact index-1 reproducer, rejects an out-of-range packed 1-bit Adam7 sample, accepts a Sub-filtered row whose encoded byte is out of palette range but reconstructs in range, and rejects a Sub-filtered row that only becomes out of range after reconstruction.
- Files changed: `src/main/project-system.ts`, `src/main/project-image-decoder-worker.ts`, `tests/project-system.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `TASKS.md`, `CHANGELOG.md`, and this append-only progress record.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node dist-test/tests/project-system.test.js` | All 13 portable project-system cases passed, including five indexed-PNG assertions and prior image validation/queue coverage; exit `0`. |
| passed | `node /tmp/workbench-p0-indexed-png-repro.cjs` | Valid sample `0` remained accepted, invalid sample `1` was rejected, `safe` was `true`, and the command exited `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including 23 WSL project-system cases, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run dist:dir` | Production main/renderer compilation and Linux directory packaging completed; exit `0`. |
| passed | packaged-ASAR validator | Electron loaded the packaged project service; a valid indexed PNG was accepted, the out-of-range palette sample was rejected, and all prior PNG/JPEG/WebP and task-filesystem flags remained true; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-indexed-png-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The full app remained running until intentional SIGINT; `pgrep -a -x electron` returned no process (expected no-match exit `1`). Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |
| passed | `git diff --check` | The scoped source, test, and documentation changes contain no whitespace errors; exit `0`. |

**Next action**

- Commit and push the indexed-PNG correction, reply to and resolve the accepted finding, then require fresh CI and exact-head automated review.
- Blocker: none established.

### 2026-09-03 20:47 JST — P0-002 task-candidate installation review correction

**Exact-head review and reproduction**

- Exact head `f708723` passed both workflow events: Linux verification completed in 28 and 25 seconds, and Windows package jobs completed in 1 minute 32 seconds and 1 minute 54 seconds. Its indexed-PNG finding was resolved, all 31 prior threads were closed, and the merge state was clean.
- Automated Codex review completed on that exact head and opened one P2 finding: after Workbench validated the complete task candidate, another process could still modify the predictable candidate inode before the no-clobber hard link installed it as `TASKS.md`.
- The finding is accepted. Before correction, `node /tmp/workbench-p0-task-candidate-race-repro.cjs` rewrote the prepared candidate from an `ln` wrapper after its digest check. Task creation returned success, the rewritten bytes became the complete `TASKS.md`, `safe` was `false`, and the command exited `1`.

**Scoped correction**

- The task transaction now retains expected candidate size and digest alongside its pinned device/inode identity and target mode. A shared descriptor check verifies all five properties plus the exact link count after mode setting and again immediately before installation.
- After the no-clobber link, Workbench requires the candidate descriptor and target path to identify the same two-link regular inode with the expected mode, size, and SHA-256 digest. It removes the temporary name only after that check, then repeats the descriptor/path/content validation with the required final single-link count before declaring the append committed.
- A failed post-link validation atomically moves only the installed candidate identity to a private rejected claim, rechecks that moved inode before deleting it, and restores the descriptor-pinned prior `TASKS.md`. If a concurrent editor replaced the canonical path, the rollback preserves that competing entry instead of overwriting it.
- The focused WSL regression changes the candidate inside the first hard-link invocation. It proves the altered inode never survives, the exact parent file is restored for retry, the child appears once with intact Markdown, and no transaction paths remain.
- Files changed: `src/main/project-system.ts`, `tests/wsl/project-system.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `TASKS.md`, `CHANGELOG.md`, and this append-only progress record.

**Verification after correction**

| Result | Exact command or check | Evidence / notes |
|---|---|---|
| passed | `npm run build:tests && node --test dist-test/tests/wsl/project-system.test.js` | The WSL project-system file passed with all 24 task/image/filesystem cases, including the new exact install-boundary mutation; exit `0`. |
| passed | `node /tmp/workbench-p0-task-candidate-race-repro.cjs` | The boundary rewrite occurred, task creation retried successfully, only the intact task was committed, `safe` was `true`, and the command exited `0`. |
| passed | `npm run check:portable` | Strict type checks and all 13 portable test files passed; exit `0`. |
| passed | `npm run check` | Strict type checks and all 14 full test files, including WSL integration, passed; exit `0`. |
| unavailable | lint/static analysis | `package.json` defines no lint script. |
| passed | `npm run dist:dir` | Production main/renderer compilation and Linux directory packaging completed; exit `0`. |
| passed | packaged-ASAR validator | Electron loaded the packaged project service; `candidateRaceSafe` and every prior image/task-filesystem flag were true; exit `0`. |
| passed | `npm start -- --user-data-dir=/tmp/workbench-p0-candidate-race-profile --enable-logging=stderr`, observed for five seconds, then Ctrl+C | The full app remained running until intentional SIGINT (expected exit `130`); `pgrep -a -x electron` then returned no process (expected no-match exit `1`). Existing DBus/GPU warnings were non-fatal. |
| passed | `npm audit --omit=dev` | npm reported zero known production dependency vulnerabilities; exit `0`. |
| passed | `git diff --check` | The scoped source, test, and documentation changes contain no whitespace errors; exit `0`. |

**Next action**

- Commit and push this candidate-install correction, reply to and resolve the accepted finding, then require green CI and a clean automated re-review on the exact new head.
- Blocker: none established.
