# Changelog

All notable user-visible Workbench changes should be recorded here. Keep engineering investigation details in `WORKBENCH_PROGRESS.md`.

Use the categories `Added`, `Changed`, `Fixed`, `Security`, `Deprecated`, and `Removed` as needed. Add an item only after the behavior is implemented and verified. Move items from `Unreleased` to a dated version when a release is actually created.

## Unreleased

### Added

- Added workspace-level Codex model and reasoning-effort selectors backed by the installed Codex catalog.
- Added remaining primary Codex usage and reset-time indicators to the dashboard and Codex toolbar.
- Added a Markdown-backed project task queue with safe default setup, GUI task entry, and a Send to Codex action.

### Changed

### Fixed

- Fixed Codex thread creation, resume, and turn startup by sending approval and thread-sandbox settings in the app-server's required wire format.
- Removed internal Codex reasoning-status rows from conversation logs while keeping user-facing progress and results visible.

### Security

<!-- Example: - Fixed Electron startup under the documented Node/WSL environment. -->
