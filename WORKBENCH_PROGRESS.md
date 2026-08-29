# Workbench Engineering Progress

This file contains a mutable current-state summary followed by an append-only engineering evidence log. Update the summary when needed, but never rewrite or delete prior session entries. Do not include secrets, tokens, full environment dumps, or sensitive prompts.

Result vocabulary: `passed` · `failed` · `not run` · `unavailable`

## Current state

- **Active task:** P0-003 — Establish a trustworthy automated verification baseline
- **Next task:** P0-004 — Review main/preload/renderer and IPC security
- **Verified state:** P0-001 and P0-002 are complete; P0-003 has passing full and portable local checks plus a successful initial split Linux/Windows GitHub run, while the accepted review fix awaits pushed-head CI and re-review
- **Next action:** Publish the accepted PR #2 review fix, confirm the final GitHub jobs and automated re-review, then mark P0-003 done and hand off the green PR for separately authorized merge
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
