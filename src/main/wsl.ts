import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ActionResult,
  GitStatus,
  SystemInspection,
  WorkbenchSettings,
  Workspace,
  WslDistribution,
} from '../shared/types';
import { shellQuote, toWslUnc } from './path-utils';

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface CaptureOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

function decodeOutput(buffer: Buffer): string {
  if (buffer.length === 0) {
    return '';
  }

  // wsl.exe emits UTF-16LE for some Windows-side commands. Linux command output is UTF-8.
  let zeroesAtOddOffsets = 0;
  const sampleLength = Math.min(buffer.length, 200);
  for (let index = 1; index < sampleLength; index += 2) {
    if (buffer[index] === 0) {
      zeroesAtOddOffsets += 1;
    }
  }
  const sampledPairs = Math.floor(sampleLength / 2);
  const encoding = sampledPairs > 0 && zeroesAtOddOffsets / sampledPairs > 0.25 ? 'utf16le' : 'utf8';
  return buffer.toString(encoding).replace(/^\uFEFF/, '').replace(/\u0000/g, '');
}

export function captureProcess(
  executable: string,
  args: string[],
  options: CaptureOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    child.stdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code,
        stdout: decodeOutput(Buffer.concat(stdout)),
        stderr: decodeOutput(Buffer.concat(stderr)),
        timedOut,
      });
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs);
      timer.unref();
    }
  });
}

export async function runWslCommand(
  distro: string,
  command: string,
  timeoutMs = 120_000,
): Promise<CommandResult> {
  if (process.platform !== 'win32') {
    return captureProcess('bash', ['-lc', command], { timeoutMs });
  }
  return captureProcess(
    'wsl.exe',
    ['-d', distro, '--exec', 'bash', '-lic', command],
    { timeoutMs },
  );
}

export async function runWorkspaceCommand(
  workspace: Workspace,
  command: string,
  timeoutMs = 120_000,
): Promise<CommandResult> {
  const wrapped = `cd ${shellQuote(workspace.root)} && ${command}`;
  return runWslCommand(workspace.distro, wrapped, timeoutMs);
}

function parseVerboseDistributionList(output: string): { name: string; isDefault: boolean }[] {
  const rows: { name: string; isDefault: boolean }[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /NAME\s+STATE\s+VERSION/i.test(line)) {
      continue;
    }
    const isDefault = line.startsWith('*');
    const withoutMarker = line.replace(/^\*\s*/, '').trim();
    const parts = withoutMarker.split(/\s+/);
    if (parts.length >= 3 && /^\d+$/.test(parts.at(-1) ?? '')) {
      const name = parts.slice(0, -2).join(' ');
      if (name) rows.push({ name, isDefault });
    }
  }
  return rows;
}

async function inspectDistribution(
  row: { name: string; isDefault: boolean },
): Promise<WslDistribution> {
  const probe = [
    'printf "%s\\n" "$HOME"',
    'id -un',
    'if command -v codex >/dev/null 2>&1; then codex --version 2>/dev/null | head -n 1; fi',
  ].join('; ');
  try {
    const result = await runWslCommand(row.name, probe, 15_000);
    const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      name: row.name,
      isDefault: row.isDefault,
      home: lines[0] ?? null,
      user: lines[1] ?? null,
      codexVersion: lines[2] ?? null,
      ...(result.code === 0 ? {} : { error: result.stderr.trim() || 'Unable to inspect this distribution.' }),
    };
  } catch (error) {
    return {
      name: row.name,
      isDefault: row.isDefault,
      home: null,
      user: null,
      codexVersion: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function inspectSystem(): Promise<SystemInspection> {
  if (process.platform !== 'win32') {
    const codex = await captureProcess('bash', ['-lc', 'command -v codex >/dev/null 2>&1 && codex --version || true'], {
      timeoutMs: 10_000,
    }).catch(() => null);
    return {
      platform: process.platform,
      wslAvailable: false,
      distributions: [{
        name: 'Local Linux',
        isDefault: true,
        home: process.env.HOME ?? null,
        user: process.env.USER ?? null,
        codexVersion: codex?.stdout.trim() || null,
      }],
      inspectedAt: new Date().toISOString(),
    };
  }

  try {
    const result = await captureProcess('wsl.exe', ['--list', '--verbose'], { timeoutMs: 15_000 });
    const rows = parseVerboseDistributionList(result.stdout);
    const distributions = await Promise.all(rows.map(inspectDistribution));
    return {
      platform: process.platform,
      wslAvailable: result.code === 0 && distributions.length > 0,
      distributions,
      inspectedAt: new Date().toISOString(),
    };
  } catch {
    return {
      platform: process.platform,
      wslAvailable: false,
      distributions: [],
      inspectedAt: new Date().toISOString(),
    };
  }
}

export async function getGitStatus(workspace: Workspace): Promise<GitStatus> {
  const empty: GitStatus = {
    isRepository: false,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    changed: 0,
    untracked: 0,
    clean: true,
    raw: '',
  };

  const result = await runWorkspaceCommand(
    workspace,
    'git status --porcelain=v2 --branch --untracked-files=normal',
    30_000,
  ).catch((error) => ({
    code: 1,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    timedOut: false,
  }));

  if (result.code !== 0) {
    return {
      ...empty,
      error: result.timedOut ? 'Git status timed out.' : result.stderr.trim() || 'Not a Git repository.',
    };
  }

  const status: GitStatus = { ...empty, isRepository: true, raw: result.stdout };
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      status.branch = line.slice('# branch.head '.length).trim();
    } else if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice('# branch.upstream '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line);
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (line.startsWith('? ')) {
      status.untracked += 1;
    } else if (/^[12u] /.test(line)) {
      const xy = line.split(/\s+/, 3)[1] ?? '..';
      if (xy[0] !== '.') status.staged += 1;
      if (xy[1] !== '.') status.changed += 1;
    }
  }
  status.clean = status.staged === 0 && status.changed === 0 && status.untracked === 0;
  return status;
}

function spawnDetached(executable: string, args: string[]): void {
  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

async function discoverIntelliJ(settings: WorkbenchSettings): Promise<string | null> {
  if (settings.intellijPath && fs.existsSync(settings.intellijPath)) {
    return settings.intellijPath;
  }
  if (process.platform !== 'win32') {
    return 'idea';
  }
  try {
    const result = await captureProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-Command idea64.exe -ErrorAction SilentlyContinue).Source'],
      { timeoutMs: 8_000 },
    );
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function openWorkspaceInIntelliJ(
  workspace: Workspace,
  settings: WorkbenchSettings,
): Promise<ActionResult> {
  const executable = await discoverIntelliJ(settings);
  if (!executable) {
    return {
      ok: false,
      message: 'IntelliJ was not found. Set the path to idea64.exe in Workbench settings.',
    };
  }
  try {
    const target = process.platform === 'win32' ? toWslUnc(workspace.distro, workspace.root) : workspace.root;
    spawnDetached(executable, [target]);
    return { ok: true, message: `Opening ${workspace.name} in IntelliJ.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function openWorkspaceInExplorer(workspace: Workspace): Promise<ActionResult> {
  try {
    const target = process.platform === 'win32' ? toWslUnc(workspace.distro, workspace.root) : workspace.root;
    if (process.platform === 'win32') {
      spawnDetached('explorer.exe', [target]);
    } else if (process.platform === 'darwin') {
      spawnDetached('open', [target]);
    } else {
      spawnDetached('xdg-open', [target]);
    }
    return { ok: true, message: `Opening ${workspace.name} in the file explorer.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function isPathInsideWorkspace(workspace: Workspace, linuxPath: string): boolean {
  const root = path.posix.resolve(workspace.root);
  const candidate = path.posix.resolve(linuxPath);
  return candidate === root || candidate.startsWith(`${root}/`);
}
