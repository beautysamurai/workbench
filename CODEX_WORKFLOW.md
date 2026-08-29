# Workbench Autonomous Repair Workflow

Use this workflow for startup failures, regressions, enhancements, and reviews. Do not skip inspection because an older log suggests a likely cause.

## 1. Restore context and protect existing work

Read `AGENTS.md`, `TASKS.md`, and the latest entries in `WORKBENCH_PROGRESS.md`, then capture the current state:

```bash
git status --short
git diff --stat
git diff --cached --stat
git log -5 --oneline
```

Inspect diffs before touching files that already have changes. Do not clean, reset, stash, or overwrite user work.

For every task that changes the repository, remote delivery is in scope by default unless the user explicitly opts out. When an `origin` remote exists, fetch it before branching if access is available, then create or confirm a task-specific feature branch before the first edit. Branching preserves a dirty worktree, but it does not authorize staging unrelated or user-created changes. If task work already began on the default branch, cut the feature branch at the next safe opportunity. If Git metadata is sandboxed or read-only, request the required approval instead of silently continuing on the default branch.

## 2. Inspect the repository before choosing commands

At minimum, inspect:

- `package.json`, the lockfile, `.nvmrc` or other runtime declarations;
- README and setup documentation;
- `tsconfig*.json` and Electron/build/test configuration;
- main, preload, renderer, IPC, terminal, workspace, and Codex-launching code;
- existing tests and scripts.

List package scripts rather than guessing them. For an npm repository:

```bash
npm run
```

Use `packageManager` and the lockfile to choose npm, pnpm, yarn, or bun. Keep all subsequent commands consistent with that choice.

## 3. Establish the actual environment

Run checks in the same environment that will install dependencies and launch Workbench. Check the selected package manager's executable and version; replace the npm examples below when the lockfile and `packageManager` field select something else.

Common checks:

```bash
node --version
npm --version
node -p "process.execPath"
node -p "process.platform + ' ' + process.arch"
```

In WSL/Linux:

```bash
command -v node
command -v npm
uname -a
printf 'WSL_DISTRO_NAME=%s\n' "${WSL_DISTRO_NAME:-}"
printf 'DISPLAY=%s WAYLAND_DISPLAY=%s XDG_RUNTIME_DIR=%s\n' "${DISPLAY:-}" "${WAYLAND_DISPLAY:-}" "${XDG_RUNTIME_DIR:-}"
```

In Windows PowerShell:

```powershell
node --version
npm --version
node -p "process.execPath"
node -p "process.platform + ' ' + process.arch"
Get-Command node
Get-Command npm
where.exe node
$PSVersionTable.PSVersion
[System.Environment]::OSVersion.VersionString
"WSL_DISTRO_NAME=$env:WSL_DISTRO_NAME"
"DISPLAY=$env:DISPLAY WAYLAND_DISPLAY=$env:WAYLAND_DISPLAY"
```

Record whether the shell is Windows, WSL, or native Linux and the exact host Node/package-manager paths and versions. Host Node must be 22 or newer unless current project declarations prove a different supported range. Electron uses its bundled Node runtime and ABI, so host Node 22 does not by itself prove that an Electron native module is compatible.

Display variables are clues, not proof that WSLg works. When GUI verification matters, inspect the relevant runtime socket if appropriate and use a bounded real launch before declaring display access available.

An `nvm` default is not proof that a non-interactive shell loaded it. If Node is too old, activate the project-supported Node version in this shell and re-run all checks. Installing a missing runtime or changing a system-wide default needs user approval.

For Electron/dependency failures, also inspect declarations and the installed tree when present:

```bash
npm ls electron @electron/get --depth=1
```

Adapt that command for the repository's package manager. Inspect declared and locked versions as well as the installed tree. This command may exit nonzero when installation is incomplete or invalid; that result is diagnostic evidence, not a new blocker. Do not run a downloader through `npx` merely to inspect a version.

### Known historical lead — verify before relying on it

A previous report showed Node `v18.19.1`, `ERR_REQUIRE_ESM` from Electron's installer loading `@electron/get`, and a partial Electron installation. Treat that only as a lead. Confirm the current Node version, dependency graph, lockfile, and reproduction output before deciding on recovery.

## 4. Reproduce and classify the failure

Run the exact reported command when safe. Bound GUI or long-running launches, capture both output streams and the exit code, and terminate them cleanly.

Record:

- expected behavior;
- actual behavior;
- exact command and environment;
- first meaningful error and relevant preceding output;
- whether the failure is deterministic.

Classify it as one or more of:

- dependency installation or runtime mismatch;
- TypeScript/build/test configuration;
- Electron binary, ABI, sandbox, display, or startup;
- main/preload/IPC boundary;
- renderer/runtime UI;
- terminal/PTY or process lifecycle;
- workspace/path handling;
- Codex discovery, authentication, launch, streaming, or cancellation.

Do not misclassify missing WSL GUI access as an application defect. Do not permanently add `--no-sandbox`, disable security, or disable the GPU just to make a symptom disappear.

## 5. Diagnose before modifying

Trace the smallest failing path. Compare declared, locked, and installed versions. Check recent relevant diffs and existing tests. Write one concrete hypothesis in `WORKBENCH_PROGRESS.md` with the evidence that supports it and the observation that would disprove it.

For dependency recovery:

- keep Windows and WSL installs separate;
- prefer a reproducible lockfile install such as `npm ci` when the lockfile is valid;
- use `npm install` when intentionally updating dependency resolution;
- never delete the lockfile as a first response;
- rebuild native modules loaded inside Electron for Electron's ABI; rebuild modules used by a separate Node helper for the host Node ABI. Prefer the repository's declared rebuild or packaging script, and act only when the dependency graph indicates it;
- do not edit `node_modules`.

## 6. Make the smallest complete fix

Change only the files necessary to resolve the supported hypothesis. Preserve public behavior unless the task calls for a product change. Add or update a focused test for a regression when practical.

For process and IPC changes, verify input validation, error propagation, cancellation, process cleanup, secret handling, and renderer isolation as part of the same fix.

## 7. Verify from narrow to broad

First re-run the exact failing check. Then run every relevant script that actually exists, in the order described by `AGENTS.md`. Typical names are examples, not guarantees:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Inspect `package.json` before using any of them. A missing script is `not available`, not `passed`.

Treat a development launch such as `npm run dev` as a bounded smoke test, not an ordinary command expected to exit. Define the startup criterion, capture useful logs, confirm the window or ready signal, and terminate the app and child processes cleanly. Capture the root process ID, stop its process tree after the smoke window, and verify no Electron, dev-server, terminal, or Codex child from the test remains. A timeout used to bound the launch is not by itself an application failure.

For each check, record the exact command and one of: `passed`, `failed`, `not run`, or `unavailable`. If a check fails, diagnose it and continue the repair loop unless it meets the genuine-blocker standard.

## 8. Smoke-test the real behavior

When GUI access is available, test a clean launch and the changed user journey. Include one empty/error case, reload or restart when persistence matters, and process cleanup after cancel/exit. Watch both main-process logs and the renderer console.

Use `REVIEW_CHECKLIST.md` for UI/UX, Codex integration, terminal, workspace, and Electron-security coverage. Do not leave Electron, dev servers, terminals, or Codex child processes orphaned.

If GUI access is unavailable, document exactly what was verified headlessly and the smallest remaining manual smoke test.

## 9. Close the local loop

Review unstaged and staged diffs plus `git status --short`. Remove accidental debug output and confirm no secrets, generated clutter, or unrelated changes were introduced.

Then:

1. update status and acceptance criteria in `TASKS.md`;
2. append an evidence-based session entry to `WORKBENCH_PROGRESS.md`;
3. update setup/user docs if behavior or commands changed;
4. add only completed user-visible changes to `CHANGELOG.md`;
5. report what changed, exact checks run, remaining risks, and the next action.

Local closeout is not the end of a repository-changing task unless the user explicitly opted out of remote delivery or a genuine blocker remains. Continue into the publishing and review loop below without asking for a separate confirmation.

## 10. Synchronize and publish through a pull request

Use this section for every repository-changing task unless the user explicitly opted out. Branch creation, scoped commit creation, feature-branch push, and pull-request creation are the default authorized delivery path; do not wait for the user to request those actions individually. Never push directly to the default or protected branch, never force-push, and never publish unrelated or user-created changes.

1. Confirm the remote, current branch, upstream, and worktree state. Fetch the remote before deciding how to synchronize:

   ```bash
   git remote -v
   git branch --show-current
   git status --short
   git fetch --prune origin
   ```

2. Confirm the work is on its task-specific feature branch; create it immediately if it was not created during initial inspection. Stage only files belonging to the task, inspect the staged diff, and create a focused local commit before synchronizing. Do not use broad staging when unrelated changes exist.
3. Synchronize those scoped commits with the fetched remote state. Use `git pull --ff-only` only when the current branch already tracks that same remote branch and has no local divergence. If the feature branch is based on an outdated default branch, prefer `git rebase origin/<default-branch>` for an unpublished or solely owned feature branch. If preserved unrelated changes make an in-place rebase impossible, create a clean auxiliary worktree and task-specific delivery branch from the fetched default branch, cherry-pick only the scoped task commits there, and use that branch as the pull-request head; do not stash or publish the unrelated work. Do not run a blind `git pull`, create an automatic merge commit, or rebase a shared branch.
4. Re-run relevant checks after synchronization, resolve conflicts deliberately, and review the resulting diff against the fetched default branch. Commit any task-scoped corrections before publishing.
5. Push the feature branch with an explicit upstream, then create or update a pull request without pausing for a separate delivery confirmation. The pull-request body must summarize the change, list exact verification, call out risks or unavailable checks, and link the relevant task.

   ```bash
   git push --set-upstream origin <feature-branch>
   gh pr create --fill
   ```

6. Record the branch, commit, pull-request URL, and push outcome in `WORKBENCH_PROGRESS.md`. A successful push is delivery evidence, not completion evidence.

Authentication, a missing remote, a non-fast-forward rejection, branch-protection rejection, or conflicting upstream work requires diagnosis and safe retry where practical. Do not bypass it with force-push, relaxed protection, or discarded changes. If access remains unavailable, record the exact blocker and smallest user action; do not misreport local completion as remote delivery.

## 11. Automated Copilot review and reflection loop

Repository administrators should configure an active branch ruleset targeting the default branch with **Automatically request Copilot code review** and **Review new pushes** enabled. Optionally review draft pull requests when early feedback is worth the additional review noise. Repository-wide review guidance lives in `.github/copilot-instructions.md`.

For every pull request:

1. Wait for required CI checks and the Copilot review to finish. If automatic review is not configured or did not trigger, request it explicitly with `gh pr edit <number> --add-reviewer @copilot`.
2. Read the complete pull-request review state: check results, review summaries, inline threads, and unresolved conversations. Do not treat a green build or the absence of a blocking review as proof that comments were addressed.
3. Reflect on each finding against the code, tests, security boundaries, and acceptance criteria. Classify it as:
   - **accepted** — implement the smallest complete fix and add or adjust verification;
   - **not applicable / incorrect** — document the evidence-based reason in the pull request;
   - **follow-up** — document the finding in the pull request and add a concise `TASKS.md` queue entry as review metadata when appropriate; do not implement it in the current pull request. Its implementation is a separate task with its own branch and pull request.
4. When review produces an accepted fix or another task-scoped repository change, update `WORKBENCH_PROGRESS.md` with the findings and dispositions, commit the change, and push the feature branch. With **Review new pushes** enabled, Copilot automatically re-reviews the new commit. Do not create another evidence-only commit solely to record the completed review of the final task commit, because that push would invalidate the just-reviewed head.
5. Repeat until required CI is green, every actionable Copilot finding is fixed or explicitly dispositioned, no unresolved in-scope review thread remains, and the final diff has been reviewed again locally.
6. Report the final review state and remaining risks in the pull request and final response. The last in-repository progress entry may describe the preceding review and the changes that produced the final reviewed commit; it need not trigger an endless evidence-only push. Copilot submits advisory comment reviews; it does not approve the pull request and does not replace required human approval or the merge policy.

Do not auto-merge merely because Copilot has commented or CI is green. Merging, releasing, deleting the branch, or overriding a protection rule remains a separate authorized action.
