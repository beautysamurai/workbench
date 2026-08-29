export type WorkspaceIcon =
  | 'code'
  | 'chart'
  | 'book'
  | 'briefcase'
  | 'language'
  | 'folder';

export type ApprovalPolicy = 'onRequest' | 'unlessTrusted' | 'never';

export interface WorkspaceCommand {
  id: string;
  name: string;
  command: string;
  description?: string;
}

export type ContextItemType = 'file' | 'note' | 'url';

export interface ContextItem {
  id: string;
  type: ContextItemType;
  label: string;
  value: string;
  includeContent: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  icon: WorkspaceIcon;
  distro: string;
  root: string;
  commands: WorkspaceCommand[];
  contextItems: ContextItem[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDraft {
  id?: string;
  name: string;
  description?: string;
  icon?: WorkspaceIcon;
  distro: string;
  root: string;
  commands?: WorkspaceCommand[];
  contextItems?: ContextItem[];
}

export interface WorkbenchSettings {
  intellijPath: string;
  approvalPolicy: ApprovalPolicy;
  networkAccess: boolean;
  maxContextFileBytes: number;
}

export interface PersistedState {
  version: 1;
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  settings: WorkbenchSettings;
}

export interface WslDistribution {
  name: string;
  isDefault: boolean;
  home: string | null;
  user: string | null;
  codexVersion: string | null;
  error?: string;
}

export interface SystemInspection {
  platform: string;
  wslAvailable: boolean;
  distributions: WslDistribution[];
  inspectedAt: string;
}

export interface GitStatus {
  isRepository: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  changed: number;
  untracked: number;
  clean: boolean;
  raw: string;
  error?: string;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface ContextBuildResult {
  markdown: string;
  includedFiles: number;
  truncatedFiles: number;
  warnings: string[];
}

export interface CodexThreadSummary {
  id: string;
  name?: string | null;
  preview?: string | null;
  cwd?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  modelProvider?: string | null;
  status?: unknown;
  [key: string]: unknown;
}

export interface CodexConnectionStatus {
  distro: string;
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  message?: string;
}

export interface CodexEventEnvelope {
  distro: string;
  method: string;
  params: Record<string, unknown>;
}

export interface CodexServerRequestEnvelope {
  distro: string;
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}

export interface TerminalSessionInfo {
  handle: string;
  mode: 'pty' | 'command';
  title: string;
}

export interface TerminalDataEnvelope {
  handle: string;
  data: string;
}

export interface TerminalExitEnvelope {
  handle: string;
  exitCode: number | null;
}

export interface WorkbenchApi {
  state: {
    get(): Promise<PersistedState>;
    saveWorkspace(draft: WorkspaceDraft): Promise<PersistedState>;
    deleteWorkspace(workspaceId: string): Promise<PersistedState>;
    selectWorkspace(workspaceId: string | null): Promise<PersistedState>;
    saveSettings(settings: WorkbenchSettings): Promise<PersistedState>;
    addContextItem(workspaceId: string, item: Omit<ContextItem, 'id'>): Promise<PersistedState>;
    removeContextItem(workspaceId: string, itemId: string): Promise<PersistedState>;
  };
  system: {
    inspect(): Promise<SystemInspection>;
    gitStatus(workspaceId: string): Promise<GitStatus>;
    openInIntelliJ(workspaceId: string): Promise<ActionResult>;
    openInExplorer(workspaceId: string): Promise<ActionResult>;
    chooseContextFile(workspaceId: string): Promise<string | null>;
  };
  context: {
    build(workspaceId: string): Promise<ContextBuildResult>;
    copy(workspaceId: string): Promise<ContextBuildResult>;
    save(workspaceId: string): Promise<ActionResult>;
  };
  codex: {
    connect(workspaceId: string): Promise<ActionResult>;
    listThreads(workspaceId: string): Promise<{ data: CodexThreadSummary[]; nextCursor?: string | null }>;
    startThread(workspaceId: string): Promise<Record<string, unknown>>;
    resumeThread(workspaceId: string, threadId: string): Promise<Record<string, unknown>>;
    readThread(workspaceId: string, threadId: string): Promise<Record<string, unknown>>;
    startTurn(workspaceId: string, threadId: string, text: string): Promise<Record<string, unknown>>;
    interruptTurn(workspaceId: string, threadId: string, turnId: string): Promise<ActionResult>;
    reviewUncommitted(workspaceId: string, threadId: string): Promise<Record<string, unknown>>;
    archiveThread(workspaceId: string, threadId: string): Promise<ActionResult>;
    respondToRequest(
      workspaceId: string,
      requestId: number | string,
      result: Record<string, unknown>,
    ): Promise<ActionResult>;
    onEvent(callback: (event: CodexEventEnvelope) => void): () => void;
    onServerRequest(callback: (request: CodexServerRequestEnvelope) => void): () => void;
    onStatus(callback: (status: CodexConnectionStatus) => void): () => void;
  };
  terminal: {
    create(workspaceId: string): Promise<TerminalSessionInfo>;
    write(workspaceId: string, handle: string, data: string): Promise<ActionResult>;
    resize(workspaceId: string, handle: string, cols: number, rows: number): Promise<ActionResult>;
    close(workspaceId: string, handle: string): Promise<ActionResult>;
    onData(callback: (event: TerminalDataEnvelope) => void): () => void;
    onExit(callback: (event: TerminalExitEnvelope) => void): () => void;
  };
}

declare global {
  interface Window {
    workbench?: WorkbenchApi;
  }
}
