# Workbench — Codex Operating Guide

## Scope and mission

These instructions apply to the entire Workbench repository. Workbench is a local Electron/TypeScript application. Work autonomously: inspect, reproduce, diagnose, make the smallest safe fix, verify it, and document the result.

Treat the application as broken until a current run establishes otherwise. Evidence from the repository and the current environment outranks older notes.

## Read order

At the start of every session, read:

1. `AGENTS.md`
2. `TASKS.md`
3. `WORKBENCH_PROGRESS.md`
4. `CODEX_WORKFLOW.md`
5. `REVIEW_CHECKLIST.md` when its area is in scope
6. `CHANGELOG.md`

Also inspect `package.json`, its lockfile, README files, TypeScript and Electron configuration, source entry points, and relevant tests before editing.

## Non-negotiable rules

- Run `git status --short` first. Preserve unrelated and user-created changes.
- Inspect `package.json` and list its scripts before assuming `dev`, `build`, `test`, `typecheck`, `lint`, or packaging commands exist.
- Confirm the package manager from `packageManager` and the lockfile. Do not switch package managers casually.
- Verify the host Node.js in the exact shell used to install dependencies and run build tooling. Workbench requires host Node 22 or newer unless the repository explicitly says otherwise. Electron carries its own Node runtime and ABI; changing `nvm` does not change that bundled runtime.
- Do not reuse `node_modules` between Windows and WSL, or between incompatible Node/Electron native-module environments.
- Reproduce the reported failure and retain the exact command, exit code, and useful error output before changing code.
- Make one coherent, reviewable fix at a time. Avoid broad rewrites while restoring the baseline.
- Do not patch generated files or anything in `node_modules` as the durable fix.
- Do not delete or regenerate a lockfile unless evidence shows it is necessary.
- Never hide a defect by disabling a check, weakening types, swallowing errors, or permanently adding unsafe Electron flags.
- Never claim an unrun, skipped, or unavailable check passed.
- Do not add telemetry, install system-wide software, force-push, rewrite shared history, or make destructive Git changes unless the user explicitly requests it.
- For an implementation task, the normal delivery path is a reviewable feature branch and pull request. Commit and push only the task's scoped changes after local verification; never include unrelated or user-created changes. Do not push directly to the default/protected branch. If remote delivery, credentials, or repository access is unavailable, stop after the local closeout and report the smallest required user action.

## Standard operating loop

1. Restore context from the task and progress files.
2. Inspect repository state, architecture, scripts, and environment.
3. Reproduce and classify the failure.
4. Trace the smallest relevant path and form an evidence-backed hypothesis.
5. Apply the smallest complete fix, adding a focused regression test when practical.
6. Re-run the closest failing check, then broader available checks.
7. Smoke-test the affected user journey, including a failure path.
8. Review the final diff for accidental changes and security regressions.
9. Update `TASKS.md`, append to `WORKBENCH_PROGRESS.md`, and add user-visible completed changes to `CHANGELOG.md`.
10. When remote delivery is in scope, follow the pull/rebase, feature-branch push, pull-request, CI/Copilot review, reflection, and re-review loop in `CODEX_WORKFLOW.md`.

Follow `CODEX_WORKFLOW.md` for the operational detail.

## Validation order

Use only commands supported by the current repository. Prefer this order when available:

1. Focused test for the changed behavior
2. Type check
3. Unit or integration tests
4. Lint or static analysis
5. Production build
6. Electron launch or bounded smoke test
7. Relevant end-to-end or packaging check

A successful TypeScript build alone does not prove that Electron launches, the preload bridge works, or the renderer is usable. If GUI access is unavailable, complete meaningful headless checks and record the GUI step as unavailable.

## Electron and command safety

- Keep renderer, preload, and main-process boundaries explicit.
- Keep `contextIsolation` enabled and expose only a narrow, typed preload API.
- Do not enable renderer Node access or arbitrary renderer-controlled process execution.
- Validate IPC channel names, payloads, paths, URLs, executable names, and arguments in the main process.
- Prefer a resolved executable plus an argument array with `shell: false` over interpolated shell strings. If a trusted Windows `.cmd` shim requires a shell, use a narrow platform-aware fallback with fixed command structure; never interpolate renderer- or workspace-controlled text into it.
- Treat opened workspaces, quick-command definitions, file contents, and paths as untrusted input.
- Keep file operations in the selected workspace unless the user explicitly authorizes otherwise.
- Never write tokens, credentials, full environment dumps, or sensitive prompts to logs.
- Ensure cancellation, renderer reload, workspace switching, and app exit do not leave child processes behind.

## Working records

- `TASKS.md` is the current prioritized queue. Keep acceptance criteria and state accurate.
- `WORKBENCH_PROGRESS.md` is append-only evidence. Record environment, diagnosis, files changed, exact checks and outcomes, manual verification, risks, and next action.
- `CHANGELOG.md` contains only completed user-visible changes. Do not present unfinished work as released or fixed.
- Update existing user documentation when behavior, setup, commands, or limitations change.

## Genuine blockers

Ordinary build failures, missing scripts, failing tests, unfamiliar code, and an initial failed approach are not blockers. Investigate them.

Stop and ask the user only when progress genuinely requires one of the following:

- credentials, authentication, or unavailable external access;
- permission for a destructive, privileged, or system-wide action;
- a product decision with materially different valid outcomes;
- required hardware, platform, or GUI access with no meaningful substitute;
- essential source or reproduction input that cannot be recovered locally.

Before stopping, exhaust safe inspection and non-destructive alternatives. Record what was tried, the exact blocker, and the smallest user action or decision needed.

## Definition of done

A task is done only when the original symptom has current evidence, the cause is understood, the fix is scoped, relevant available checks pass, important behavior is smoke-tested when possible, no known regression is being concealed, and the task/progress/changelog records match reality.
