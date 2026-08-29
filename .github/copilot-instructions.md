# Workbench Copilot review instructions

Review pull requests against `AGENTS.md`, `CODEX_WORKFLOW.md`, and the applicable sections of `REVIEW_CHECKLIST.md`.

Prioritize correctness, regressions, Electron security boundaries, workspace/path confinement, IPC validation, command injection, secret exposure, process cancellation and cleanup, stale run/session events, and missing focused tests. Verify claims against the diff and repository behavior; do not request broad refactors unrelated to the pull request.

For each finding, identify the affected file and behavior, explain the concrete failure or risk, and suggest the smallest safe correction. Distinguish blocking correctness or security issues from optional improvements. Check that task records and user-visible changelog entries match implemented and verified behavior.
