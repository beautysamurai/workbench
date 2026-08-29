import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  ActionResult,
  CodexEventEnvelope,
  TerminalDataEnvelope,
  TerminalExitEnvelope,
  TerminalSessionInfo,
  Workspace,
} from '../shared/types';
import { CodexAppServerManager } from './codex-app-server';
import { shellQuote } from './path-utils';

interface TerminalSession {
  info: TerminalSessionInfo;
  workspaceId: string;
  distro: string;
  child?: ChildProcessWithoutNullStreams;
}

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(private readonly codex: CodexAppServerManager) {
    super();
    codex.on('notification', (event: CodexEventEnvelope) => this.handleCodexNotification(event));
  }

  async create(workspace: Workspace): Promise<TerminalSessionInfo> {
    const handle = `workbench-terminal-${randomUUID()}`;
    const info: TerminalSessionInfo = {
      handle,
      mode: 'pty',
      title: workspace.name,
    };

    try {
      await this.codex.request(workspace.distro, 'process/spawn', {
        command: ['bash', '-lc', 'exec "${SHELL:-/bin/bash}" -il'],
        processHandle: handle,
        cwd: workspace.root,
        tty: true,
      }, 20_000);
      this.sessions.set(handle, {
        info,
        workspaceId: workspace.id,
        distro: workspace.distro,
      });
      return info;
    } catch (error) {
      const fallback = await this.createFallbackProcess(workspace, handle);
      const reason = error instanceof Error ? error.message : String(error);
      this.emitData(handle, `\r\n[Workbench] Native Codex PTY was unavailable; using the direct WSL console.\r\n${reason}\r\n\r\n`);
      return fallback;
    }
  }

  async write(workspace: Workspace, handle: string, data: string): Promise<ActionResult> {
    const session = this.requireSession(workspace, handle);
    try {
      if (session.info.mode === 'pty') {
        await this.codex.request(workspace.distro, 'process/writeStdin', {
          processHandle: handle,
          deltaBase64: Buffer.from(data, 'utf8').toString('base64'),
        }, 15_000);
      } else if (session.child && !session.child.stdin.destroyed) {
        session.child.stdin.write(data, 'utf8');
      } else {
        throw new Error('The terminal process is no longer running.');
      }
      return { ok: true, message: 'Input sent.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async resize(
    workspace: Workspace,
    handle: string,
    cols: number,
    rows: number,
  ): Promise<ActionResult> {
    const session = this.requireSession(workspace, handle);
    if (session.info.mode !== 'pty') {
      return { ok: true, message: 'The fallback console does not expose PTY resizing.' };
    }
    try {
      await this.codex.request(workspace.distro, 'process/resizePty', {
        processHandle: handle,
        cols: Math.max(20, Math.floor(cols)),
        rows: Math.max(5, Math.floor(rows)),
      }, 15_000);
      return { ok: true, message: 'Terminal resized.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async close(workspace: Workspace, handle: string): Promise<ActionResult> {
    const session = this.requireSession(workspace, handle);
    this.sessions.delete(handle);
    try {
      if (session.info.mode === 'pty') {
        await this.codex.request(workspace.distro, 'process/kill', { processHandle: handle }, 15_000);
      } else if (session.child) {
        session.child.kill();
      }
      return { ok: true, message: 'Terminal closed.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      if (session.child) session.child.kill();
      if (session.info.mode === 'pty') {
        void this.codex.request(session.distro, 'process/kill', {
          processHandle: session.info.handle,
        }).catch(() => undefined);
      }
    }
    this.sessions.clear();
  }

  private async createFallbackProcess(workspace: Workspace, handle: string): Promise<TerminalSessionInfo> {
    const executable = process.platform === 'win32' ? 'wsl.exe' : 'bash';
    const launch = `cd ${shellQuote(workspace.root)} && exec "\${SHELL:-/bin/bash}" -il`;
    const args = process.platform === 'win32'
      ? ['-d', workspace.distro, '--exec', 'bash', '-lic', launch]
      : ['-lic', launch];
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    const info: TerminalSessionInfo = { handle, mode: 'command', title: workspace.name };
    this.sessions.set(handle, {
      info,
      workspaceId: workspace.id,
      distro: workspace.distro,
      child,
    });
    child.stdout.on('data', (data: Buffer) => this.emitData(handle, data.toString('utf8')));
    child.stderr.on('data', (data: Buffer) => this.emitData(handle, data.toString('utf8')));
    child.on('error', (error) => this.emitData(handle, `\r\n${error.message}\r\n`));
    child.on('close', (code) => {
      this.sessions.delete(handle);
      this.emitExit(handle, code);
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    return info;
  }

  private handleCodexNotification(event: CodexEventEnvelope): void {
    if (event.method !== 'process/outputDelta' && event.method !== 'process/exited') return;
    const handle = String(event.params.processHandle ?? '');
    const session = this.sessions.get(handle);
    if (!session || session.info.mode !== 'pty' || session.distro !== event.distro) return;

    if (event.method === 'process/outputDelta') {
      const encoded = String(event.params.deltaBase64 ?? '');
      if (encoded) {
        try {
          this.emitData(handle, Buffer.from(encoded, 'base64').toString('utf8'));
        } catch {
          this.emitData(handle, '[Workbench could not decode terminal output]\r\n');
        }
      }
      return;
    }

    this.sessions.delete(handle);
    const exitCode = typeof event.params.exitCode === 'number' ? event.params.exitCode : null;
    this.emitExit(handle, exitCode);
  }

  private requireSession(workspace: Workspace, handle: string): TerminalSession {
    const session = this.sessions.get(handle);
    if (!session || session.workspaceId !== workspace.id) {
      throw new Error('Terminal session not found for this workspace.');
    }
    return session;
  }

  private emitData(handle: string, data: string): void {
    const envelope: TerminalDataEnvelope = { handle, data };
    this.emit('data', envelope);
  }

  private emitExit(handle: string, exitCode: number | null): void {
    const envelope: TerminalExitEnvelope = { handle, exitCode };
    this.emit('exit', envelope);
  }
}
