import fs from 'node:fs';
import path from 'node:path';
import {
  clipboard,
  dialog,
  ipcMain,
  type BrowserWindow,
  type OpenDialogOptions,
} from 'electron';
import type {
  ActionResult,
  CodexConnectionStatus,
  CodexEventEnvelope,
  ProjectTaskDraft,
  CodexServerRequestEnvelope,
  ContextItem,
  TerminalDataEnvelope,
  TerminalExitEnvelope,
  WorkbenchSettings,
  WorkspaceDraft,
} from '../shared/types';
import { CodexAppServerManager } from './codex-app-server';
import { CODEX_THREAD_SANDBOX_MODE, toCodexApprovalPolicy } from './codex-protocol';
import { buildContextPack, suggestedContextFileName } from './context-service';
import { addProjectTask, initializeProjectSystem, inspectProjectSystem } from './project-system';
import { uncToWslPath, toWslUnc } from './path-utils';
import { WorkbenchStore } from './store';
import { TerminalManager } from './terminal-manager';
import {
  getGitStatus,
  inspectSystem,
  openWorkspaceInExplorer,
  openWorkspaceInIntelliJ,
} from './wsl';

export interface IpcDependencies {
  window: BrowserWindow;
  store: WorkbenchStore;
  codex: CodexAppServerManager;
  terminals: TerminalManager;
}

function action(message: string): ActionResult {
  return { ok: true, message };
}

function removeAllWorkbenchHandlers(): void {
  const channels = [
    'state:get',
    'state:save-workspace',
    'state:save-codex-preferences',
    'state:delete-workspace',
    'state:select-workspace',
    'state:save-settings',
    'state:add-context-item',
    'state:remove-context-item',
    'project:inspect',
    'project:initialize',
    'project:add-task',
    'system:inspect',
    'system:git-status',
    'system:open-intellij',
    'system:open-explorer',
    'system:choose-context-file',
    'context:build',
    'context:copy',
    'context:save',
    'codex:connect',
    'codex:list-models',
    'codex:rate-limits',
    'codex:list-threads',
    'codex:start-thread',
    'codex:resume-thread',
    'codex:read-thread',
    'codex:start-turn',
    'codex:interrupt-turn',
    'codex:review-uncommitted',
    'codex:archive-thread',
    'codex:respond',
    'terminal:create',
    'terminal:write',
    'terminal:resize',
    'terminal:close',
  ];
  for (const channel of channels) ipcMain.removeHandler(channel);
}

export function registerIpc({ window, store, codex, terminals }: IpcDependencies): () => void {
  removeAllWorkbenchHandlers();
  const workspace = (workspaceId: string) => store.getWorkspace(String(workspaceId));

  ipcMain.handle('state:get', () => store.getState());
  ipcMain.handle('state:save-workspace', (_event, draft: WorkspaceDraft) => store.saveWorkspace(draft));
  ipcMain.handle(
    'state:save-codex-preferences',
    (_event, workspaceId: string, model: string | null, effort: string | null) =>
      store.saveCodexPreferences(String(workspaceId), model, effort),
  );
  ipcMain.handle('state:delete-workspace', (_event, workspaceId: string) => store.deleteWorkspace(String(workspaceId)));
  ipcMain.handle('state:select-workspace', (_event, workspaceId: string | null) => store.selectWorkspace(workspaceId));
  ipcMain.handle('state:save-settings', (_event, settings: WorkbenchSettings) => store.saveSettings(settings));
  ipcMain.handle(
    'state:add-context-item',
    (_event, workspaceId: string, item: Omit<ContextItem, 'id'>) =>
      store.addContextItem(String(workspaceId), item),
  );

  ipcMain.handle('project:inspect', (_event, workspaceId: string) => inspectProjectSystem(workspace(workspaceId)));
  ipcMain.handle('project:initialize', (_event, workspaceId: string) => initializeProjectSystem(workspace(workspaceId)));
  ipcMain.handle('project:add-task', (_event, workspaceId: string, task: ProjectTaskDraft) =>
    addProjectTask(workspace(workspaceId), task));
  ipcMain.handle(
    'state:remove-context-item',
    (_event, workspaceId: string, itemId: string) =>
      store.removeContextItem(String(workspaceId), String(itemId)),
  );

  ipcMain.handle('system:inspect', () => inspectSystem());
  ipcMain.handle('system:git-status', (_event, workspaceId: string) => getGitStatus(workspace(workspaceId)));
  ipcMain.handle('system:open-intellij', (_event, workspaceId: string) => {
    const state = store.getState();
    return openWorkspaceInIntelliJ(workspace(workspaceId), state.settings);
  });
  ipcMain.handle('system:open-explorer', (_event, workspaceId: string) => openWorkspaceInExplorer(workspace(workspaceId)));
  ipcMain.handle('system:choose-context-file', async (_event, workspaceId: string) => {
    const selected = workspace(workspaceId);
    const options: OpenDialogOptions = {
      title: 'Add a workspace file to context',
      defaultPath: process.platform === 'win32'
        ? toWslUnc(selected.distro, selected.root)
        : selected.root,
      properties: ['openFile'],
    };
    const result = await dialog.showOpenDialog(window, options);
    if (result.canceled || !result.filePaths[0]) return null;
    const chosen = result.filePaths[0];
    if (process.platform !== 'win32') return chosen;
    const linuxPath = uncToWslPath(selected.distro, chosen);
    if (!linuxPath) {
      throw new Error(`Choose a file inside the ${selected.distro} WSL filesystem.`);
    }
    return linuxPath;
  });

  ipcMain.handle('context:build', (_event, workspaceId: string) => {
    const state = store.getState();
    return buildContextPack(workspace(workspaceId), state.settings);
  });
  ipcMain.handle('context:copy', async (_event, workspaceId: string) => {
    const state = store.getState();
    const result = await buildContextPack(workspace(workspaceId), state.settings);
    clipboard.writeText(result.markdown);
    return result;
  });
  ipcMain.handle('context:save', async (_event, workspaceId: string) => {
    const state = store.getState();
    const selected = workspace(workspaceId);
    const result = await buildContextPack(selected, state.settings);
    const target = await dialog.showSaveDialog(window, {
      title: 'Save context pack',
      defaultPath: suggestedContextFileName(selected),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (target.canceled || !target.filePath) return action('Save cancelled.');
    fs.mkdirSync(path.dirname(target.filePath), { recursive: true });
    fs.writeFileSync(target.filePath, result.markdown, 'utf8');
    return action(`Saved ${path.basename(target.filePath)}.`);
  });

  ipcMain.handle('codex:connect', async (_event, workspaceId: string) => {
    const selected = workspace(workspaceId);
    await codex.connect(selected.distro);
    return action(`Codex connected in ${selected.distro}.`);
  });
  ipcMain.handle('codex:list-models', (_event, workspaceId: string) => {
    const selected = workspace(workspaceId);
    return codex.request(selected.distro, 'model/list', { limit: 100, includeHidden: false });
  });
  ipcMain.handle('codex:rate-limits', (_event, workspaceId: string) => {
    const selected = workspace(workspaceId);
    return codex.request(selected.distro, 'account/rateLimits/read');
  });
  ipcMain.handle('codex:list-threads', (_event, workspaceId: string) => {
    const selected = workspace(workspaceId);
    return codex.request(selected.distro, 'thread/list', {
      cwd: selected.root,
      limit: 50,
      sourceKinds: ['appServer', 'cli', 'vscode'],
    });
  });
  ipcMain.handle('codex:start-thread', (_event, workspaceId: string) => {
    const selected = workspace(workspaceId);
    const settings = store.getState().settings;
    return codex.request(selected.distro, 'thread/start', {
      cwd: selected.root,
      approvalPolicy: toCodexApprovalPolicy(settings.approvalPolicy),
      sandbox: CODEX_THREAD_SANDBOX_MODE,
      serviceName: 'workbench',
      ...(selected.codexModel ? { model: selected.codexModel } : {}),
    });
  });
  ipcMain.handle('codex:resume-thread', (_event, workspaceId: string, threadId: string) => {
    const selected = workspace(workspaceId);
    const settings = store.getState().settings;
    return codex.request(selected.distro, 'thread/resume', {
      threadId: String(threadId),
      cwd: selected.root,
      approvalPolicy: toCodexApprovalPolicy(settings.approvalPolicy),
      sandbox: CODEX_THREAD_SANDBOX_MODE,
      ...(selected.codexModel ? { model: selected.codexModel } : {}),
    });
  });
  ipcMain.handle('codex:read-thread', (_event, workspaceId: string, threadId: string) => {
    const selected = workspace(workspaceId);
    return codex.request(selected.distro, 'thread/read', {
      threadId: String(threadId),
      includeTurns: true,
    });
  });
  ipcMain.handle('codex:start-turn', (_event, workspaceId: string, threadId: string, text: string) => {
    const selected = workspace(workspaceId);
    const settings = store.getState().settings;
    const input = String(text).trim();
    if (!input) throw new Error('Enter a task for Codex.');
    return codex.request(selected.distro, 'turn/start', {
      threadId: String(threadId),
      input: [{ type: 'text', text: input }],
      cwd: selected.root,
      approvalPolicy: toCodexApprovalPolicy(settings.approvalPolicy),
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [selected.root],
        networkAccess: settings.networkAccess,
      },
      ...(selected.codexModel ? { model: selected.codexModel } : {}),
      ...(selected.codexEffort ? { effort: selected.codexEffort } : {}),
    });
  });
  ipcMain.handle('codex:interrupt-turn', async (_event, workspaceId: string, threadId: string, turnId: string) => {
    const selected = workspace(workspaceId);
    await codex.request(selected.distro, 'turn/interrupt', {
      threadId: String(threadId),
      turnId: String(turnId),
    });
    return action('Interrupt requested.');
  });
  ipcMain.handle('codex:review-uncommitted', (_event, workspaceId: string, threadId: string) => {
    const selected = workspace(workspaceId);
    return codex.request(selected.distro, 'review/start', {
      threadId: String(threadId),
      delivery: 'inline',
      target: { type: 'uncommittedChanges' },
    });
  });
  ipcMain.handle('codex:archive-thread', async (_event, workspaceId: string, threadId: string) => {
    const selected = workspace(workspaceId);
    await codex.request(selected.distro, 'thread/archive', { threadId: String(threadId) });
    return action('Thread archived.');
  });
  ipcMain.handle(
    'codex:respond',
    async (_event, workspaceId: string, requestId: number | string, result: Record<string, unknown>) => {
      const selected = workspace(workspaceId);
      await codex.respond(selected.distro, requestId, result);
      return action('Response sent to Codex.');
    },
  );

  ipcMain.handle('terminal:create', (_event, workspaceId: string) => terminals.create(workspace(workspaceId)));
  ipcMain.handle('terminal:write', (_event, workspaceId: string, handle: string, data: string) =>
    terminals.write(workspace(workspaceId), String(handle), String(data)));
  ipcMain.handle('terminal:resize', (_event, workspaceId: string, handle: string, cols: number, rows: number) =>
    terminals.resize(workspace(workspaceId), String(handle), Number(cols), Number(rows)));
  ipcMain.handle('terminal:close', (_event, workspaceId: string, handle: string) =>
    terminals.close(workspace(workspaceId), String(handle)));

  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };
  const onCodexEvent = (event: CodexEventEnvelope) => send('codex:event', event);
  const onCodexRequest = (request: CodexServerRequestEnvelope) => send('codex:server-request', request);
  const onCodexStatus = (status: CodexConnectionStatus) => send('codex:status', status);
  const onTerminalData = (event: TerminalDataEnvelope) => send('terminal:data', event);
  const onTerminalExit = (event: TerminalExitEnvelope) => send('terminal:exit', event);
  codex.on('notification', onCodexEvent);
  codex.on('serverRequest', onCodexRequest);
  codex.on('status', onCodexStatus);
  terminals.on('data', onTerminalData);
  terminals.on('exit', onTerminalExit);

  return () => {
    removeAllWorkbenchHandlers();
    codex.off('notification', onCodexEvent);
    codex.off('serverRequest', onCodexRequest);
    codex.off('status', onCodexStatus);
    terminals.off('data', onTerminalData);
    terminals.off('exit', onTerminalExit);
  };
}
