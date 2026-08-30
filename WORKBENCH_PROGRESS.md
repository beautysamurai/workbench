# Workbench Engineering Progress

This file contains a mutable current-state summary followed by an append-only engineering evidence log. Update the summary when needed, but never rewrite or delete prior session entries. Do not include secrets, tokens, full environment dumps, or sensitive prompts.

Result vocabulary: `passed` · `failed` · `not run` · `unavailable`

## Current state

- **Active task:** P1-004 — GUI bugfix (`in progress` at pull-request delivery)
- **Next task:** P1-004 — complete correction pull-request CI and automated review
- **Verified state:** P1-004 is locally complete; consistently scaled WSLg fullscreen reaches the host display with exact pointer coordinates and restores prior bounds, mixed-scale layouts retain Electron defaults, runtime scale changes offer a user-controlled recalibration without unexpectedly interrupting active work, the responsive layout is usable at 720×520, and Codex model/reasoning choices are isolated per thread without replacing unavailable effective models
- **Next action:** Publish the runtime display-scale correction, then complete final-head CI and automated review
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
