# Workbench Review Checklist

Use the relevant sections after the application has a reproducible baseline. Record findings and verification in `WORKBENCH_PROGRESS.md`; turn actionable findings into scoped items in `TASKS.md`.

## Pull request delivery and reflection

- [ ] Remote delivery ran by default, or an explicit user opt-out/genuine blocker is recorded; lack of a separate push/PR request was not treated as an opt-out.
- [ ] The task-specific feature branch was created from the fetched default branch (or in a clean auxiliary worktree based there) and contains no commits inherited from another task.
- [ ] Any recovery preserved the existing index, transferred only audited commit SHAs or a reviewed binary-capable scoped patch plus explicitly inventoried task-owned untracked files, and used a fresh delivery branch rather than resetting an unsuitable branch.
- [ ] The feature branch was synchronized with the fetched default branch without overwriting unrelated work.
- [ ] `git log origin/<default>..HEAD` and `git diff origin/<default>...HEAD` show only the current task's commits (plus any deliberate synchronization merge) and paths.
- [ ] Only task-scoped changes were staged, committed, and pushed; the default/protected branch was not pushed directly.
- [ ] The pull request states the behavior change, exact verification, unavailable checks, risks, and task reference.
- [ ] Required CI passed; any pending or failed required check is recorded accurately and leaves delivery incomplete.
- [ ] GitHub Copilot reviewed the pull request and, when fixes were pushed, reviewed the new pushes.
- [ ] Every Copilot summary, inline comment, and unresolved thread was evaluated as accepted, incorrect/not applicable, or follow-up with evidence.
- [ ] Accepted findings were fixed and verified; rejected findings have a concise technical rationale; valid out-of-scope findings have a task.
- [ ] The final local diff review and pull-request review state show no unresolved in-scope issue.
- [ ] Human approval and merge requirements remain explicit; Copilot review is not treated as approval.

## UI and UX

- [ ] Clean launch, loading, first-run, empty, success, failure, offline/unavailable, and long-running states are understandable.
- [ ] Primary actions are easy to find, accurately labeled, and protected from accidental duplicate clicks.
- [ ] Busy, disabled, success, cancel, and failure states reflect the real process state.
- [ ] Errors distinguish Workbench failures from workspace-command failures and offer a useful next step without leaking secrets or raw internals.
- [ ] Keyboard navigation, focus order, visible focus, shortcuts, Escape behavior, screen-reader names, announced status/error changes, and modal focus trapping/restoration are reasonable.
- [ ] State is not communicated by color alone, and text, controls, and focus indicators have sufficient contrast.
- [ ] Layout remains usable at a small window size, 200% zoom, long paths, long output, and Unicode text.
- [ ] Workspace names, filenames, Markdown, Codex output, and terminal text are escaped or strictly sanitized rather than sent to unsafe HTML APIs. Links reject `javascript:`, `file:`, and every non-allowlisted scheme.
- [ ] Scrolling, selection, copy/paste, dialogs, and confirmations behave predictably.
- [ ] Destructive or privileged actions require explicit confirmation.
- [ ] Intended workspace/settings state survives reload; stale state fails safely.
- [ ] Renderer and main-process consoles have no uncaught errors during primary journeys.

Verify at least one main journey, one empty/failure state, keyboard-only use, resize/zoom, reload, and clean exit. Include inert-rendering checks with hostile HTML/Markdown, filenames, link schemes, and terminal hyperlink/control-sequence input.

## Codex integration

### Discovery and behavior

- [ ] Locate the executable discovery, configuration, process launch, preload bridge, IPC handlers, context construction, and UI state before editing.
- [ ] Check `codex --version` and `codex --help` in the exact Windows/WSL environment Workbench uses.
- [ ] Missing executable, unsupported version, invalid workspace, missing authentication, timeout, malformed output, and nonzero exit have distinct actionable messages.
- [ ] The selected workspace and context are explicit before a run starts.
- [ ] Standard output, standard error, completion, and exit codes are handled accurately.
- [ ] Streaming remains responsive and preserves Unicode; large output is bounded or virtualized.
- [ ] Cancel stops the process and descendants. Reload, workspace change, and app exit leave no orphans.
- [ ] Concurrent runs are deliberately supported or clearly prevented.
- [ ] Opaque run IDs prevent late output/exit events from an old, canceled, or restarted run from updating a new run. Cancellation is idempotent.

### Security

- [ ] The main process resolves a trusted absolute Codex executable outside the workspace and launches it with an argument array; untrusted text is not interpolated into a shell command and values beginning with `-` cannot become options accidentally.
- [ ] Prompts and context use stdin or a supported structured channel where possible rather than command-line arguments visible in the process list.
- [ ] IPC channels and payloads are narrow, typed, and validated on the main-process side. Privileged handlers also authorize the expected main frame/origin, window/session owner, workspace, and run ID.
- [ ] `contextIsolation` remains enabled; the renderer has no broad Node or arbitrary-command API.
- [ ] Workspace paths are normalized and validated, including Windows, WSL, UNC, spaces, Unicode, and symlinks.
- [ ] Child processes receive only the environment they need.
- [ ] Tokens, credentials, full environment dumps, and sensitive prompts are not logged or persisted by default.
- [ ] Workbench does not auto-approve destructive, privileged, network, or out-of-workspace actions.
- [ ] External links use an explicit safe-protocol allowlist.

Test deterministic mocks where possible, then one harmless real Codex smoke run. Cover success, both output streams, nonzero exit, missing executable/authentication, cancellation, reload/exit, Unicode, long output, and a path containing spaces.

## Terminal and workspace functionality

### Workspace

- [ ] Open, change, reopen, and remove workspace flows behave predictably.
- [ ] The displayed path and actual working directory match.
- [ ] Empty, missing, inaccessible, non-Git, space-containing, and Unicode paths are handled.
- [ ] Windows, WSL, and UNC paths are translated only where required.
- [ ] Stale persisted paths fail safely.
- [ ] Normalized paths and symlinks cannot silently escape the authorized workspace.
- [ ] Large folders and ignored directories do not freeze file browsing or watchers.

### Terminal and quick commands

- [ ] A new terminal starts in the selected workspace and uses the intended shell.
- [ ] Input, output, stderr, ANSI colors, Unicode, copy/paste, scrolling, clearing, and resize work.
- [ ] Exit code and running/stopped state are visible and accurate.
- [ ] Long-running commands can be interrupted; restart creates a clean process.
- [ ] Workspace switching and app exit terminate old processes without orphans.
- [ ] Rapid or large output does not freeze the renderer.
- [ ] Multiple terminals are isolated correctly or explicitly unsupported.
- [ ] Native PTY dependencies match the installed Electron ABI.
- [ ] Main-process handlers bound and type-check terminal input size, rows/columns, buffer limits, and session IDs. The main process selects or validates shell, CWD, and environment instead of accepting arbitrary renderer-controlled spawn parameters.
- [ ] Opaque terminal session IDs reject output and exit events from closed, replaced, or previous-workspace sessions.
- [ ] Quick-command definitions are parsed and validated before execution.
- [ ] Labels, commands, and descriptions remain distinct; invalid definitions show useful errors.
- [ ] Commands are shown before execution and never run merely because a workspace or file was opened.
- [ ] Repeated clicks cannot unintentionally duplicate commands.

Use harmless smoke commands appropriate to the active shell: print the working directory, show Node/Git versions, run `git status --short`, emit Unicode, emit stdout and stderr, exit nonzero, start/cancel a harmless long process, and repeat in a path containing spaces. Confirm cleanup afterward.

## Electron application security

- [ ] Renderer sandboxing and context isolation are enabled unless a documented constraint requires otherwise.
- [ ] Every `BrowserWindow`, child window, and `webContents` uses secure preferences: `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`, `webSecurity: true`, `webviewTag: false`, and `allowRunningInsecureContent: false`.
- [ ] The preload surface contains only required capabilities and validates arguments.
- [ ] Remote content never receives a privileged preload bridge.
- [ ] Navigation, new windows, permissions, downloads, and external URLs are restricted deliberately.
- [ ] Content Security Policy is appropriate for production and avoids avoidable unsafe directives.
- [ ] Development tooling and verbose logs are not exposed in production builds.
- [ ] App shutdown cleans up terminals, Codex runs, watchers, and temporary resources.

Security findings that expose arbitrary code execution, secrets, or out-of-workspace access are priority zero. Fix or isolate them before lower-priority polish.
