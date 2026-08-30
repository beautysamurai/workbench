# Workbench architecture

## Design goal

Workbench is a control plane around existing tools. The workspace is the product boundary; AI is one capability inside it.

```text
┌────────────────────────────────────────────────────────────────────┐
│ Electron renderer                                                  │
│ dashboard · task queue · context tray · Codex UI · terminal        │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ narrow typed IPC
┌──────────────────────────────▼─────────────────────────────────────┐
│ Electron main process                                              │
│ state · WSL · Git · file safety · app launching · process control  │
└───────────────┬───────────────────────────────┬────────────────────┘
                │                               │
                │ JSONL over stdio              │ wsl.exe processes
                ▼                               ▼
┌───────────────────────────┐       ┌───────────────────────────────┐
│ codex app-server in WSL   │       │ repositories and shell tools │
│ threads · turns · diffs   │       │ Git · Gradle · Maven · Python│
│ approvals · reviews · PTY │       │ Jupyter · project files      │
└───────────────────────────┘       └───────────────────────────────┘
```

## Trust boundaries

### Renderer

The renderer has no direct file, shell, or Node.js access. It receives only the methods exposed by `preload.ts`. All dynamic user or Codex text is HTML-escaped before rendering; the small Markdown renderer adds a restricted set of formatting after escaping.

### Preload

The preload bridge maps a fixed method list to IPC channels. It does not expose generic `ipcRenderer`, filesystem, process, or shell APIs.

### Main process

The main process validates workspace IDs through the persistent store before each privileged operation. Context reads are additionally checked using both normalized paths and WSL `realpath` values. Project-workflow operations resolve the workspace root and each fixed Markdown filename before reading or writing, require regular files, and reject symlinks that escape the root. Task-image bytes are independently checked for count, size, basic container structure/dimensions, and PNG/JPEG/WebP signatures, then streamed through a non-profile shell's stdin to a generated path under a resolved `.workbench/task-images/` directory.

### Codex

Codex is started once per active WSL distribution and shared by workspaces in that distribution. Threads remain separated by their Codex thread IDs and working directories.

A Codex turn is started with:

```json
{
  "approvalPolicy": "on-request",
  "sandboxPolicy": {
    "type": "workspaceWrite",
    "writableRoots": ["/workspace/root"],
    "networkAccess": false
  }
}
```

Thread creation and resume use the app-server's top-level `sandbox: "workspace-write"` mode. Turn overrides use the distinct tagged sandbox-policy object shown above, whose type is `workspaceWrite`.

The renderer loads the current model catalog with `model/list` and keeps model/reasoning choices keyed by Codex thread ID. New-thread choices are an in-memory draft until `thread/start`; resumed threads hydrate their effective values from `thread/resume`. Changes to an existing thread use `thread/settings/update`, and each turn carries that thread's current values. The main process validates these overrides before forwarding them. `account/rateLimits/read` plus `account/rateLimits/updated` supply the primary usage window shown in the dashboard and Codex toolbar.

The normal workspace JSON does not store model preferences, so changing one thread cannot rewrite another thread's selection.

### Terminal

The terminal is not an AI tool invocation. It is a user-directed local process. Workbench first requests a PTY through Codex app-server's experimental `process/*` API. If unavailable, it creates a persistent `wsl.exe` child process directly. Both paths run outside the Codex turn sandbox.

## State model

`WorkbenchStore` persists one versioned JSON document:

```text
PersistedState
├── version
├── selectedWorkspaceId
├── settings
└── workspaces[]
    ├── identity and display metadata
    ├── WSL distribution and root
    ├── quick commands[]
    └── contextItems[]
```

Writes use a temporary file followed by a rename. Invalid legacy workspace entries are skipped rather than preventing startup. A malformed state file is preserved with a `.broken-<timestamp>` suffix and Workbench starts with clean state.

## Window behavior

The main window starts at 1520×960 and can restore as small as 720×520. Responsive breakpoints hide the auxiliary context tray and convert the Codex thread rail to a compact horizontal layout. F11 enters native fullscreen; Workbench snapshots the normal bounds first and reapplies them after Electron emits `leave-full-screen`, covering platforms that otherwise retain fullscreen-sized bounds after exit. Escape leaves fullscreen.

## Markdown project workflow

`project-system.ts` treats `AGENTS.md`, `TASKS.md`, and `WORKBENCH_PROGRESS.md` as the durable project workflow. Initialization creates only missing files. New task IDs use the `WB-NNN` namespace and seed from the largest concrete numeric suffix already in the queue. Each assignment atomically advances a persistent `.workbench/task-sequence` high-water counter while holding a stable `flock` file, so deletion does not reuse IDs and separate Workbench processes cannot reserve the same value; an in-process queue also avoids redundant local contention. Reservation gaps are allowed when a later image or Markdown write fails. Priority, parent ID, acceptance criteria, and generated attachment paths are normalized into a fixed Markdown block appended to `TASKS.md`. Legacy task IDs remain unchanged, with P0–P3 inferred from those IDs when no explicit priority exists.

The renderer derives an arbitrary-depth tree from the flat parent-ID model and keeps duplicate, orphaned, or cyclic hand-edited tasks visible with a structural warning. Image files never cross the bridge as DOM `File` objects: the renderer sends typed bytes through the task-specific API, and the main process writes those bytes only beneath the selected workspace after signature, size, `realpath`, and symlink checks. It uses fixed generated filenames and stdin rather than placing image content in a shell command or process argument.

## Codex message flow

1. `CodexAppServerClient` spawns `codex app-server` under WSL.
2. It sends `initialize`, then the `initialized` notification.
3. Request IDs are tracked with timeouts.
4. Responses resolve pending calls.
5. notifications are forwarded to the renderer as typed envelopes.
6. server-initiated approval requests are shown as explicit cards.
7. renderer decisions are returned using the original JSON-RPC request ID.

The renderer treats item lifecycle events as the source of truth and also tracks turn-level plan and aggregate diff notifications.

## Failure behavior

- Missing WSL or Codex is surfaced in the environment status instead of crashing the renderer.
- A failed Codex connection can be retried from the Codex tab.
- Unavailable model or usage metadata leaves the main workspace usable and exposes a retry control.
- Missing Markdown workflow files are shown explicitly and can be initialized without replacing existing files; unsafe/non-regular project files and unsafe task metadata or image paths are refused.
- A failed experimental PTY starts a direct WSL shell.
- An unreadable context file creates a warning inside the generated package.
- Oversized context files are truncated and labeled.
- A missing IntelliJ path produces an actionable Settings message.

## Extension points

The current interfaces allow later additions without replacing the shell:

- Git worktree-backed agent tasks
- Jupyter server discovery
- PDF and Markdown document panes
- workspace templates
- deterministic workflow definitions
- global Windows hotkeys and capture
- a local Spring service for domain-specific rates analytics
- MCP tools shared by ChatGPT and Codex
