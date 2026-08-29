import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type {
  CodexConnectionStatus,
  CodexEventEnvelope,
  CodexServerRequestEnvelope,
} from '../shared/types';

interface JsonRpcResponse {
  jsonrpc?: string;
  id: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class CodexAppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private stdoutBuffer = '';
  private startPromise: Promise<void> | null = null;
  private connected = false;
  private closing = false;
  private stderrTail = '';

  constructor(readonly distro: string) {
    super();
  }

  isConnected(): boolean {
    return this.connected && this.child !== null;
  }

  async start(): Promise<void> {
    if (this.isConnected()) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async request<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 60_000,
  ): Promise<T> {
    await this.start();
    if (!this.child || !this.connected) {
      throw new Error('Codex app-server is not connected.');
    }

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      timer.unref();

      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.start();
    this.write({ jsonrpc: '2.0', method, params });
  }

  async respond(id: number | string, result: Record<string, unknown>): Promise<void> {
    await this.start();
    this.write({ jsonrpc: '2.0', id, result });
  }

  stop(): void {
    this.closing = true;
    this.connected = false;
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.rejectPending(new Error('Codex app-server was stopped.'));
    this.emitStatus('disconnected', 'Codex app-server stopped.');
  }

  private async startInternal(): Promise<void> {
    this.closing = false;
    this.stdoutBuffer = '';
    this.stderrTail = '';
    this.emitStatus('connecting', `Starting Codex in ${this.distro}…`);

    const executable = process.platform === 'win32' ? 'wsl.exe' : 'bash';
    const args = process.platform === 'win32'
      ? ['-d', this.distro, '--exec', 'bash', '-lic', 'exec codex app-server']
      : ['-lic', 'exec codex app-server'];

    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-8_000);
      this.emit('log', chunk);
    });
    child.on('error', (error) => {
      this.handleExit(error);
    });
    child.on('close', (code, signal) => {
      if (this.child !== child) return;
      const detail = this.stderrTail.trim();
      const message = this.closing
        ? 'Codex app-server stopped.'
        : `Codex app-server exited (${code ?? signal ?? 'unknown'}).${detail ? ` ${detail}` : ''}`;
      this.handleExit(new Error(message));
    });

    // Wait for spawn before sending JSON-RPC. This catches missing WSL/codex executables early.
    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        child.off('spawn', onSpawn);
        child.off('error', onError);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });

    this.connected = true;
    try {
      await this.requestWithoutStart('initialize', {
        clientInfo: {
          name: 'ai_workbench',
          title: 'Workbench',
          version: '0.1.0',
        },
        capabilities: {
          experimentalApi: true,
        },
      }, 30_000);
      this.write({ jsonrpc: '2.0', method: 'initialized', params: {} });
      this.emitStatus('connected', `Codex connected in ${this.distro}.`);
    } catch (error) {
      this.handleExit(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private requestWithoutStart<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    if (!this.child || !this.connected) {
      return Promise.reject(new Error('Codex app-server is not running.'));
    }
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private write(message: JsonRpcMessage): void {
    if (!this.child || this.child.stdin.destroyed) {
      throw new Error('Codex app-server input is unavailable.');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8');
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.handleMessage(JSON.parse(line) as JsonRpcMessage);
      } catch (error) {
        this.emit('log', `Could not parse Codex message: ${line}\n${String(error)}\n`);
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && !message.method) {
      const response = message as JsonRpcResponse;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.error) {
        const details = response.error.data ? ` (${JSON.stringify(response.error.data)})` : '';
        pending.reject(new Error(`${response.error.message ?? 'Codex request failed'}${details}`));
      } else {
        pending.resolve(response.result);
      }
      return;
    }

    if (message.method && message.id !== undefined) {
      const request: CodexServerRequestEnvelope = {
        distro: this.distro,
        id: message.id,
        method: message.method,
        params: message.params ?? {},
      };
      this.emit('serverRequest', request);
      return;
    }

    if (message.method) {
      const event: CodexEventEnvelope = {
        distro: this.distro,
        method: message.method,
        params: message.params ?? {},
      };
      this.emit('notification', event);
    }
  }

  private handleExit(error: Error): void {
    const wasClosing = this.closing;
    this.connected = false;
    if (this.child) {
      this.child.removeAllListeners();
      if (!this.child.killed) this.child.kill();
      this.child = null;
    }
    this.rejectPending(error);
    this.emitStatus(wasClosing ? 'disconnected' : 'error', error.message);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitStatus(state: CodexConnectionStatus['state'], message?: string): void {
    const status: CodexConnectionStatus = { distro: this.distro, state, message };
    this.emit('status', status);
  }
}

export class CodexAppServerManager extends EventEmitter {
  private readonly clients = new Map<string, CodexAppServerClient>();

  async connect(distro: string): Promise<CodexAppServerClient> {
    const client = this.getOrCreate(distro);
    await client.start();
    return client;
  }

  get(distro: string): CodexAppServerClient | undefined {
    return this.clients.get(distro);
  }

  async request<T = Record<string, unknown>>(
    distro: string,
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    const client = await this.connect(distro);
    return client.request<T>(method, params, timeoutMs);
  }

  async respond(
    distro: string,
    id: number | string,
    result: Record<string, unknown>,
  ): Promise<void> {
    const client = await this.connect(distro);
    await client.respond(id, result);
  }

  stopAll(): void {
    for (const client of this.clients.values()) client.stop();
    this.clients.clear();
  }

  private getOrCreate(distro: string): CodexAppServerClient {
    const existing = this.clients.get(distro);
    if (existing) return existing;

    const client = new CodexAppServerClient(distro);
    client.on('notification', (event: CodexEventEnvelope) => this.emit('notification', event));
    client.on('serverRequest', (request: CodexServerRequestEnvelope) => this.emit('serverRequest', request));
    client.on('status', (status: CodexConnectionStatus) => this.emit('status', status));
    client.on('log', (chunk: string) => this.emit('log', { distro, chunk }));
    this.clients.set(distro, client);
    return client;
  }
}
