# Validation record for 0.1.0

Validated in the build environment on 2026-08-28:

- strict TypeScript compilation for the Electron main process and renderer
- 15 passing Node tests covering path conversion, shell quoting, context formatting, terminal scrollback, persistent state, state recovery, and input validation
- successful production compilation into `dist/`
- a JSONL protocol smoke test against a simulated `codex app-server`, covering initialization, request/response matching, thread events, turn events, streamed item deltas, and shutdown
- browser rendering with the built-in mock backend at 1520 × 960; dashboard and Codex views were visually inspected

## Environment limitation

The build environment is Linux and cannot download the full Electron and electron-builder packages from npm. Therefore, the Windows NSIS installer was not produced here and the real WSL/IntelliJ launch path was not executed end-to-end.

On Windows, run `setup.ps1`; it installs the pinned dependencies, reruns the checks, and builds the application. `npm run dist:win` produces the installer. The included GitHub Actions workflow performs the same build on `windows-latest`.
