# Workbench architecture

## Design goal

Workbench is a control plane around existing tools. The workspace is the product boundary; AI is one capability inside it.

```text
┌────────────────────────────────────────────────────────────────────┐
│ Electron renderer                                                  │
│ dashboard · context tray · Codex UI · terminal · command palette   │
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

The main process validates workspace IDs through the persistent store before each privileged operation. Context reads are additionally checked using both normalized paths and WSL `realpath` values.

### Codex

Codex is started once per active WSL distribution and shared by workspaces in that distribution. Threads remain separated by their Codex thread IDs and working directories.

A Codex turn is started with:

```json
{
  "approvalPolicy": "onRequest",
  "sandboxPolicy": {
    "type": "workspaceWrite",
    "writableRoots": ["/workspace/root"],
    "networkAccess": false
  }
}
```

These values can be changed in Settings.

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
