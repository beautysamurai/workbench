# Changelog

All notable user-visible Workbench changes should be recorded here. Keep engineering investigation details in `WORKBENCH_PROGRESS.md`.

Use the categories `Added`, `Changed`, `Fixed`, `Security`, `Deprecated`, and `Removed` as needed. Add an item only after the behavior is implemented and verified. Move items from `Unreleased` to a dated version when a release is actually created.

## Unreleased

### Added

- Added Codex model and reasoning-effort selectors backed by the installed Codex catalog.
- Added remaining primary Codex usage and reset-time indicators to the dashboard and Codex toolbar.
- Added a Markdown-backed project task queue with safe default setup, GUI task entry, and a Send to Codex action.
- Added explicit task priorities, optional parent/child structure and acceptance criteria, plus pasted, dropped, or selected reference images with previews.

### Changed

- Model and reasoning-effort choices now belong to each Codex thread instead of the whole workspace.
- New GUI tasks receive durable sequential `WB-NNN` IDs independently from priority, while legacy priority-prefixed and UUID-style IDs remain supported.

### Fixed

- Fixed fullscreen on consistently scaled WSLg displays so the window reaches the screen edges under fractional Windows scaling, pointer hit targets stay aligned, and the prior small-window bounds restore; mixed-scale layouts retain Electron defaults, runtime scale changes offer a safe restart for recalibration, and the responsive layout remains usable down to 720×520.
- Preserved a resumed thread's effective model when it is hidden or temporarily absent from the visible model catalog.
- Fixed Codex thread creation, resume, and turn startup by sending approval and thread-sandbox settings in the app-server's required wire format.
- Removed internal Codex reasoning-status rows from conversation logs while keeping user-facing progress and results visible.
- Images and task-field edits made while a task submission is still completing now remain in the next draft instead of being cleared with the submitted values.
- Deeply nested task queues now validate and render with linear, non-recursive traversal instead of repeatedly walking every ancestor chain.
- Malformed PNG image-data streams, undecodable JPEG tables/scans, corrupt lossy WebP control/token/alpha payloads, animated WebP frames outside their declared canvas, and incomplete lossless WebP streams are rejected; duplicate task IDs no longer expose a Send to Codex action that could select the wrong task.
- Large, highly compressible PNG and lossless WebP task images now decode in a bounded worker instead of pausing the Electron main thread.

### Security

- Task images are size- and structure-validated, with bounded compressed-data decoding isolated from the Electron main thread where required, then streamed into a fixed, workspace-contained attachment directory without placing their bytes in shell arguments; task IDs are reserved under a workspace lock.
