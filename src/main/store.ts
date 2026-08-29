import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ContextItem,
  PersistedState,
  WorkbenchSettings,
  Workspace,
  WorkspaceCommand,
  WorkspaceDraft,
  WorkspaceIcon,
} from '../shared/types';

const ICONS = new Set<WorkspaceIcon>(['code', 'chart', 'book', 'briefcase', 'language', 'folder']);

const DEFAULT_SETTINGS: WorkbenchSettings = {
  intellijPath: '',
  approvalPolicy: 'onRequest',
  networkAccess: false,
  maxContextFileBytes: 120_000,
};

const EMPTY_STATE: PersistedState = {
  version: 1,
  workspaces: [],
  selectedWorkspaceId: null,
  settings: DEFAULT_SETTINGS,
};

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanRoot(value: unknown): string {
  const text = cleanText(value, 2_048);
  if (!text.startsWith('/')) {
    throw new Error('Workspace root must be an absolute Linux path such as /home/user/project.');
  }
  return path.posix.normalize(text);
}

function cleanCommands(commands: unknown): WorkspaceCommand[] {
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands
    .slice(0, 30)
    .map((candidate): WorkspaceCommand | null => {
      const item = candidate as Partial<WorkspaceCommand>;
      const name = cleanText(item.name, 80);
      const command = cleanText(item.command, 2_000);
      if (!name || !command) {
        return null;
      }
      return {
        id: cleanText(item.id, 100) || randomUUID(),
        name,
        command,
        description: cleanText(item.description, 240),
      } satisfies WorkspaceCommand;
    })
    .filter((item): item is WorkspaceCommand => item !== null);
}

function cleanContextItems(items: unknown): ContextItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .slice(0, 100)
    .map((candidate): ContextItem | null => {
      const item = candidate as Partial<ContextItem>;
      const type = item.type;
      if (type !== 'file' && type !== 'note' && type !== 'url') {
        return null;
      }
      const value = typeof item.value === 'string' ? item.value.slice(0, 200_000) : '';
      if (!value.trim()) {
        return null;
      }
      return {
        id: cleanText(item.id, 100) || randomUUID(),
        type,
        label: cleanText(item.label, 120) || type,
        value,
        includeContent: item.includeContent !== false,
      } satisfies ContextItem;
    })
    .filter((item): item is ContextItem => item !== null);
}

function cleanSettings(input: unknown): WorkbenchSettings {
  const candidate = (input ?? {}) as Partial<WorkbenchSettings>;
  const approvalPolicy = candidate.approvalPolicy;
  return {
    intellijPath: cleanText(candidate.intellijPath, 2_048),
    approvalPolicy:
      approvalPolicy === 'unlessTrusted' || approvalPolicy === 'never'
        ? approvalPolicy
        : 'onRequest',
    networkAccess: candidate.networkAccess === true,
    maxContextFileBytes: Math.min(
      1_000_000,
      Math.max(10_000, Number(candidate.maxContextFileBytes) || DEFAULT_SETTINGS.maxContextFileBytes),
    ),
  };
}

function cleanWorkspace(input: WorkspaceDraft, existing?: Workspace): Workspace {
  const name = cleanText(input.name, 100);
  const distro = cleanText(input.distro, 120);
  if (!name) {
    throw new Error('Workspace name is required.');
  }
  if (!distro) {
    throw new Error('A WSL distribution is required.');
  }
  const now = new Date().toISOString();
  const icon = ICONS.has(input.icon ?? 'folder') ? (input.icon ?? 'folder') : 'folder';
  return {
    id: existing?.id ?? (cleanText(input.id, 100) || randomUUID()),
    name,
    description: cleanText(input.description, 500),
    icon,
    distro,
    root: cleanRoot(input.root),
    commands: cleanCommands(input.commands ?? existing?.commands ?? []),
    contextItems: cleanContextItems(input.contextItems ?? existing?.contextItems ?? []),
    codexModel: cleanText(input.codexModel ?? existing?.codexModel, 160) || null,
    codexEffort: cleanText(input.codexEffort ?? existing?.codexEffort, 40) || null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function cleanLoadedState(input: unknown): PersistedState {
  const candidate = (input ?? {}) as Partial<PersistedState>;
  const workspaces: Workspace[] = [];
  if (Array.isArray(candidate.workspaces)) {
    for (const rawWorkspace of candidate.workspaces) {
      try {
        workspaces.push(cleanWorkspace(rawWorkspace as WorkspaceDraft, rawWorkspace as Workspace));
      } catch {
        // Skip invalid legacy entries instead of preventing the application from starting.
      }
    }
  }
  const selected = cleanText(candidate.selectedWorkspaceId, 100);
  return {
    version: 1,
    workspaces,
    selectedWorkspaceId: workspaces.some((workspace) => workspace.id === selected)
      ? selected
      : workspaces[0]?.id ?? null,
    settings: cleanSettings(candidate.settings),
  };
}

export class WorkbenchStore {
  private state: PersistedState;

  constructor(private readonly filePath: string) {
    this.state = this.load();
  }

  getState(): PersistedState {
    return structuredClone(this.state);
  }

  getWorkspace(workspaceId: string): Workspace {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found.');
    }
    return structuredClone(workspace);
  }

  saveWorkspace(draft: WorkspaceDraft): PersistedState {
    const index = draft.id
      ? this.state.workspaces.findIndex((workspace) => workspace.id === draft.id)
      : -1;
    const existing = index >= 0 ? this.state.workspaces[index] : undefined;
    const workspace = cleanWorkspace(draft, existing);
    if (index >= 0) {
      this.state.workspaces[index] = workspace;
    } else {
      this.state.workspaces.unshift(workspace);
    }
    this.state.selectedWorkspaceId = workspace.id;
    this.persist();
    return this.getState();
  }

  deleteWorkspace(workspaceId: string): PersistedState {
    this.state.workspaces = this.state.workspaces.filter((workspace) => workspace.id !== workspaceId);
    if (this.state.selectedWorkspaceId === workspaceId) {
      this.state.selectedWorkspaceId = this.state.workspaces[0]?.id ?? null;
    }
    this.persist();
    return this.getState();
  }

  selectWorkspace(workspaceId: string | null): PersistedState {
    if (workspaceId !== null && !this.state.workspaces.some((workspace) => workspace.id === workspaceId)) {
      throw new Error('Workspace not found.');
    }
    this.state.selectedWorkspaceId = workspaceId;
    this.persist();
    return this.getState();
  }

  saveSettings(settings: WorkbenchSettings): PersistedState {
    this.state.settings = cleanSettings(settings);
    this.persist();
    return this.getState();
  }

  saveCodexPreferences(workspaceId: string, model: string | null, effort: string | null): PersistedState {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found.');
    }
    workspace.codexModel = cleanText(model, 160) || null;
    workspace.codexEffort = cleanText(effort, 40) || null;
    workspace.updatedAt = new Date().toISOString();
    this.persist();
    return this.getState();
  }

  addContextItem(workspaceId: string, rawItem: Omit<ContextItem, 'id'>): PersistedState {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found.');
    }
    const [item] = cleanContextItems([{ ...rawItem, id: randomUUID() }]);
    if (!item) {
      throw new Error('The context item is invalid.');
    }
    workspace.contextItems.push(item);
    workspace.updatedAt = new Date().toISOString();
    this.persist();
    return this.getState();
  }

  removeContextItem(workspaceId: string, itemId: string): PersistedState {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found.');
    }
    workspace.contextItems = workspace.contextItems.filter((item) => item.id !== itemId);
    workspace.updatedAt = new Date().toISOString();
    this.persist();
    return this.getState();
  }

  private load(): PersistedState {
    try {
      if (!fs.existsSync(this.filePath)) {
        return structuredClone(EMPTY_STATE);
      }
      return cleanLoadedState(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      const backupPath = `${this.filePath}.broken-${Date.now()}`;
      try {
        fs.renameSync(this.filePath, backupPath);
      } catch {
        // Ignore backup failure and still recover with a clean state.
      }
      console.error('Failed to read Workbench state; starting clean.', error);
      return structuredClone(EMPTY_STATE);
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
  }
}
