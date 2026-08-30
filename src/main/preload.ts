import { contextBridge, ipcRenderer } from 'electron';
import type {
  CodexConnectionStatus,
  CodexEventEnvelope,
  CodexServerRequestEnvelope,
  TerminalDataEnvelope,
  TerminalExitEnvelope,
  WorkbenchApi,
} from '../shared/types';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: WorkbenchApi = {
  state: {
    get: () => ipcRenderer.invoke('state:get'),
    saveWorkspace: (draft) => ipcRenderer.invoke('state:save-workspace', draft),
    deleteWorkspace: (workspaceId) => ipcRenderer.invoke('state:delete-workspace', workspaceId),
    selectWorkspace: (workspaceId) => ipcRenderer.invoke('state:select-workspace', workspaceId),
    saveSettings: (settings) => ipcRenderer.invoke('state:save-settings', settings),
    addContextItem: (workspaceId, item) => ipcRenderer.invoke('state:add-context-item', workspaceId, item),
    removeContextItem: (workspaceId, itemId) => ipcRenderer.invoke('state:remove-context-item', workspaceId, itemId),
  },
  project: {
    inspect: (workspaceId) => ipcRenderer.invoke('project:inspect', workspaceId),
    initialize: (workspaceId) => ipcRenderer.invoke('project:initialize', workspaceId),
    addTask: (workspaceId, task) => ipcRenderer.invoke('project:add-task', workspaceId, task),
  },
  system: {
    inspect: () => ipcRenderer.invoke('system:inspect'),
    gitStatus: (workspaceId) => ipcRenderer.invoke('system:git-status', workspaceId),
    openInIntelliJ: (workspaceId) => ipcRenderer.invoke('system:open-intellij', workspaceId),
    openInExplorer: (workspaceId) => ipcRenderer.invoke('system:open-explorer', workspaceId),
    chooseContextFile: (workspaceId) => ipcRenderer.invoke('system:choose-context-file', workspaceId),
  },
  context: {
    build: (workspaceId) => ipcRenderer.invoke('context:build', workspaceId),
    copy: (workspaceId) => ipcRenderer.invoke('context:copy', workspaceId),
    save: (workspaceId) => ipcRenderer.invoke('context:save', workspaceId),
  },
  codex: {
    connect: (workspaceId) => ipcRenderer.invoke('codex:connect', workspaceId),
    listModels: (workspaceId) => ipcRenderer.invoke('codex:list-models', workspaceId),
    getRateLimits: (workspaceId) => ipcRenderer.invoke('codex:rate-limits', workspaceId),
    listThreads: (workspaceId) => ipcRenderer.invoke('codex:list-threads', workspaceId),
    startThread: (workspaceId, preference) => ipcRenderer.invoke('codex:start-thread', workspaceId, preference),
    resumeThread: (workspaceId, threadId) => ipcRenderer.invoke('codex:resume-thread', workspaceId, threadId),
    readThread: (workspaceId, threadId) => ipcRenderer.invoke('codex:read-thread', workspaceId, threadId),
    updateThreadSettings: (workspaceId, threadId, preference) =>
      ipcRenderer.invoke('codex:update-thread-settings', workspaceId, threadId, preference),
    startTurn: (workspaceId, threadId, text, preference) =>
      ipcRenderer.invoke('codex:start-turn', workspaceId, threadId, text, preference),
    interruptTurn: (workspaceId, threadId, turnId) => ipcRenderer.invoke('codex:interrupt-turn', workspaceId, threadId, turnId),
    reviewUncommitted: (workspaceId, threadId) => ipcRenderer.invoke('codex:review-uncommitted', workspaceId, threadId),
    archiveThread: (workspaceId, threadId) => ipcRenderer.invoke('codex:archive-thread', workspaceId, threadId),
    respondToRequest: (workspaceId, requestId, result) => ipcRenderer.invoke('codex:respond', workspaceId, requestId, result),
    onEvent: (callback) => subscribe<CodexEventEnvelope>('codex:event', callback),
    onServerRequest: (callback) => subscribe<CodexServerRequestEnvelope>('codex:server-request', callback),
    onStatus: (callback) => subscribe<CodexConnectionStatus>('codex:status', callback),
  },
  terminal: {
    create: (workspaceId) => ipcRenderer.invoke('terminal:create', workspaceId),
    write: (workspaceId, handle, data) => ipcRenderer.invoke('terminal:write', workspaceId, handle, data),
    resize: (workspaceId, handle, cols, rows) => ipcRenderer.invoke('terminal:resize', workspaceId, handle, cols, rows),
    close: (workspaceId, handle) => ipcRenderer.invoke('terminal:close', workspaceId, handle),
    onData: (callback) => subscribe<TerminalDataEnvelope>('terminal:data', callback),
    onExit: (callback) => subscribe<TerminalExitEnvelope>('terminal:exit', callback),
  },
};

contextBridge.exposeInMainWorld('workbench', api);
