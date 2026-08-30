import type {
  ActionResult,
  CodexConnectionStatus,
  CodexEventEnvelope,
  CodexModelInfo,
  CodexModelPreference,
  CodexRateLimits,
  CodexServerRequestEnvelope,
  CodexThreadSummary,
  ContextBuildResult,
  ContextItem,
  GitStatus,
  PersistedState,
  ProjectSystemStatus,
  ProjectTask,
  SystemInspection,
  TerminalSessionInfo,
  WorkbenchApi,
  Workspace,
  WorkspaceCommand,
  WorkspaceDraft,
  WorkspaceIcon,
} from '../shared/types.js';
import { icon } from './icons.js';
import {
  shouldShowCodexItemInTranscript,
  shouldShowCodexNotificationInTranscript,
} from './codex-transcript.js';
import {
  changeCodexModelPreference,
  chooseCodexModelPreference,
  primaryRateLimit,
  rateLimitsFromNotification,
  remainingUsagePercent,
} from './codex-metadata.js';
import { CodexSessionPreferences } from './codex-session-preferences.js';
import { escapeHtml, renderDiff, renderMarkdown } from './markdown.js';
import { createMockApi } from './mock-api.js';
import { TerminalBuffer } from './terminal-buffer.js';

type MainTab = 'overview' | 'codex' | 'terminal';
type ModalState =
  | { kind: 'workspace'; workspaceId?: string }
  | { kind: 'settings' }
  | { kind: 'context'; contextType: 'note' | 'url' }
  | { kind: 'preview'; result: ContextBuildResult }
  | { kind: 'delete'; workspaceId: string }
  | null;

type CodexEntryType = 'user' | 'agent' | 'command' | 'file' | 'review' | 'system';

interface CodexEntry {
  id: string;
  type: CodexEntryType;
  text: string;
  command?: string;
  output?: string;
  status?: string;
  phase?: string;
}

interface PlanStep {
  step: string;
  status: 'pending' | 'inProgress' | 'completed' | string;
}

interface ThreadViewState {
  entries: CodexEntry[];
  activeTurnId: string | null;
  turnStatus: string;
  plan: PlanStep[];
  planExplanation: string;
  diff: string;
  loaded: boolean;
}

interface TerminalViewState {
  info: TerminalSessionInfo;
  workspaceId: string;
  buffer: TerminalBuffer;
  exited: boolean;
}

interface PaletteAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  section: string;
}

interface UiState {
  data: PersistedState | null;
  system: SystemInspection | null;
  git: Map<string, GitStatus>;
  gitLoading: Set<string>;
  activeTab: MainTab;
  modal: ModalState;
  paletteOpen: boolean;
  paletteQuery: string;
  paletteIndex: number;
  codexStatus: Map<string, CodexConnectionStatus>;
  codexModels: Map<string, CodexModelInfo[]>;
  codexMetadataLoading: Set<string>;
  codexMetadataErrors: Map<string, string>;
  codexPreferences: CodexSessionPreferences;
  rateLimits: Map<string, CodexRateLimits>;
  projectSystems: Map<string, ProjectSystemStatus>;
  projectLoading: Set<string>;
  threadLists: Map<string, CodexThreadSummary[]>;
  threadsLoading: Set<string>;
  activeThread: Map<string, string>;
  threadViews: Map<string, ThreadViewState>;
  approvals: Map<string, CodexServerRequestEnvelope>;
  composerText: Map<string, string>;
  terminals: Map<string, TerminalViewState>;
  activeTerminal: Map<string, string>;
  orphanTerminalData: Map<string, string>;
  busyActions: Set<string>;
}

const api: WorkbenchApi = window.workbench ?? createMockApi();
const appElementCandidate = document.querySelector<HTMLElement>('#app');
const overlayRootCandidate = document.querySelector<HTMLElement>('#overlay-root');
const toastRootCandidate = document.querySelector<HTMLElement>('#toast-root');
if (!appElementCandidate || !overlayRootCandidate || !toastRootCandidate) {
  throw new Error('Workbench application roots were not found.');
}
const appElement: HTMLElement = appElementCandidate;
const overlayRoot: HTMLElement = overlayRootCandidate;
const toastRoot: HTMLElement = toastRootCandidate;

const ui: UiState = {
  data: null,
  system: null,
  git: new Map(),
  gitLoading: new Set(),
  activeTab: 'overview',
  modal: null,
  paletteOpen: false,
  paletteQuery: '',
  paletteIndex: 0,
  codexStatus: new Map(),
  codexModels: new Map(),
  codexMetadataLoading: new Set(),
  codexMetadataErrors: new Map(),
  codexPreferences: new CodexSessionPreferences(),
  rateLimits: new Map(),
  projectSystems: new Map(),
  projectLoading: new Set(),
  threadLists: new Map(),
  threadsLoading: new Set(),
  activeThread: new Map(),
  threadViews: new Map(),
  approvals: new Map(),
  composerText: new Map(),
  terminals: new Map(),
  activeTerminal: new Map(),
  orphanTerminalData: new Map(),
  busyActions: new Set(),
};

const disposers: (() => void)[] = [];
let terminalResizeTimer: number | undefined;

function currentWorkspace(): Workspace | null {
  if (!ui.data?.selectedWorkspaceId) return null;
  return ui.data.workspaces.find((workspace) => workspace.id === ui.data?.selectedWorkspaceId) ?? null;
}

function threadView(threadId: string): ThreadViewState {
  let view = ui.threadViews.get(threadId);
  if (!view) {
    view = {
      entries: [],
      activeTurnId: null,
      turnStatus: 'idle',
      plan: [],
      planExplanation: '',
      diff: '',
      loaded: false,
    };
    ui.threadViews.set(threadId, view);
  }
  return view;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function basename(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? value;
}

function compactPath(value: string, max = 40): string {
  if (value.length <= max) return value;
  const parts = value.split('/').filter(Boolean);
  if (parts.length < 3) return `…${value.slice(-(max - 1))}`;
  const tail = parts.slice(-2).join('/');
  return `…/${tail}`.slice(-max);
}

function relativeTime(timestamp: unknown): string {
  const numeric = numberValue(timestamp);
  if (numeric === null) return 'Recently';
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const seconds = Math.max(0, Math.floor((Date.now() - milliseconds) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function toast(message: string, kind: 'success' | 'error' = 'success'): void {
  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.innerHTML = `${icon(kind === 'success' ? 'check' : 'alert', 17)}<div>${escapeHtml(message)}</div>`;
  toastRoot.append(element);
  window.setTimeout(() => element.remove(), 4200);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  return stringValue(record.message, String(error));
}

async function withBusy<T>(key: string, operation: () => Promise<T>): Promise<T | null> {
  if (ui.busyActions.has(key)) return null;
  ui.busyActions.add(key);
  renderAll();
  try {
    return await operation();
  } catch (error) {
    toast(errorMessage(error), 'error');
    return null;
  } finally {
    ui.busyActions.delete(key);
    renderAll();
  }
}

function resultToast(result: ActionResult | null): void {
  if (!result) return;
  toast(result.message, result.ok ? 'success' : 'error');
}

function renderAll(options: { preserveFocus?: boolean } = {}): void {
  const focus = options.preserveFocus ? captureFocus() : null;
  appElement.innerHTML = [renderTitlebar(), renderSidebar(), renderMainColumn(), renderContextPanel(), renderStatusbar()].join('');
  renderOverlay();
  restoreFocus(focus);
  updateTerminalOutput();
}

interface FocusSnapshot {
  id: string;
  start: number | null;
  end: number | null;
}

function captureFocus(): FocusSnapshot | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) || !active.id) return null;
  return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
}

function restoreFocus(snapshot: FocusSnapshot | null): void {
  if (!snapshot) return;
  const target = document.getElementById(snapshot.id);
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  target.focus();
  if (snapshot.start !== null && snapshot.end !== null) target.setSelectionRange(snapshot.start, snapshot.end);
}

function renderTitlebar(): string {
  const workspace = currentWorkspace();
  return `
    <header class="titlebar">
      <div class="titlebar-brand">
        <span class="brand-mark">${icon('logo', 30)}</span>
        <span>Workbench</span>
      </div>
      <div class="titlebar-center">
        <button class="command-trigger" data-action="open-palette" aria-label="Open command palette">
          ${icon('search', 14)}
          <span>${workspace ? `Search ${escapeHtml(workspace.name)} or run anything…` : 'Search or run anything…'}</span>
          <kbd class="keycap">Ctrl K</kbd>
        </button>
      </div>
      <div class="titlebar-context-label">
        ${icon('context', 14)}
        <span>Context pack</span>
      </div>
    </header>`;
}

function renderSidebar(): string {
  const workspaces = ui.data?.workspaces ?? [];
  const selectedId = ui.data?.selectedWorkspaceId;
  const distribution = selectedDistribution();
  const systemLabel = distribution?.name ?? (ui.system ? 'WSL not detected' : 'Inspecting system…');
  const systemDetail = distribution?.codexVersion ?? (distribution ? 'Codex not found' : 'Windows + WSL');
  const items = workspaces.map((workspace) => `
    <button class="workspace-item ${workspace.id === selectedId ? 'is-active' : ''}" data-action="select-workspace" data-workspace-id="${escapeHtml(workspace.id)}">
      <span class="workspace-icon">${icon(workspace.icon, 17)}</span>
      <span class="workspace-copy">
        <span class="workspace-name">${escapeHtml(workspace.name)}</span>
        <span class="workspace-path">${escapeHtml(compactPath(workspace.root, 32))}</span>
      </span>
      <span class="workspace-menu icon-button" data-action="edit-workspace" data-workspace-id="${escapeHtml(workspace.id)}" title="Edit workspace">${icon('more', 15)}</span>
    </button>`).join('');

  return `
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="eyebrow">Workspaces</span>
        <button class="icon-button" data-action="new-workspace" title="New workspace">${icon('plus', 16)}</button>
      </div>
      <nav class="workspace-list">
        ${items || `<div class="empty-inline">Your projects, research, and learning environments will appear here.</div>`}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-system" data-action="settings">
          <span class="workspace-icon">${icon('settings', 16)}</span>
          <span class="sidebar-system-copy"><strong>${escapeHtml(systemLabel)}</strong><span>${escapeHtml(systemDetail)}</span></span>
          ${icon('chevron', 13)}
        </div>
      </div>
    </aside>`;
}

function selectedDistribution() {
  const workspace = currentWorkspace();
  if (!workspace) return ui.system?.distributions.find((item) => item.isDefault) ?? ui.system?.distributions[0];
  return ui.system?.distributions.find((item) => item.name === workspace.distro);
}

function renderMainColumn(): string {
  const workspace = currentWorkspace();
  return `
    <main class="main-column">
      <div class="workspace-topbar">
        <div class="workspace-heading">
          ${workspace ? `<span class="workspace-icon">${icon(workspace.icon, 16)}</span><div><h1>${escapeHtml(workspace.name)}</h1></div><span class="workspace-heading-path">${escapeHtml(workspace.root)}</span>` : `<h1>Welcome</h1>`}
        </div>
        <nav class="tab-strip">
          ${renderTab('overview', 'overview', 'Overview')}
          ${renderTab('codex', 'sparkle', 'Codex')}
          ${renderTab('terminal', 'terminal', 'Terminal')}
        </nav>
      </div>
      <section class="main-content" id="main-content">${renderMainContent()}</section>
    </main>`;
}

function renderTab(tab: MainTab, iconName: string, label: string): string {
  return `<button class="tab-button ${ui.activeTab === tab ? 'is-active' : ''}" data-action="set-tab" data-tab="${tab}">${icon(iconName, 14)}<span>${label}</span></button>`;
}

function renderMainContent(): string {
  const workspace = currentWorkspace();
  if (!workspace) return renderWelcome();
  if (ui.activeTab === 'codex') return renderCodexPage(workspace);
  if (ui.activeTab === 'terminal') return renderTerminalPage(workspace);
  return renderOverview(workspace);
}

function renderWelcome(): string {
  return `
    <div class="empty-state">
      <div class="empty-state-card">
        <div class="empty-state-icon">${icon('logo', 42)}</div>
        <h2>Build your local work environment.</h2>
        <p>Group a WSL project, commands, documents, terminal sessions, and Codex conversations into one focused workspace.</p>
        <button class="button primary" data-action="new-workspace">${icon('plus', 15)} Create your first workspace</button>
      </div>
    </div>`;
}

function renderOverview(workspace: Workspace): string {
  const git = ui.git.get(workspace.id);
  const distro = selectedDistribution();
  const threads = ui.threadLists.get(workspace.id) ?? [];
  const terminalCount = [...ui.terminals.values()].filter((terminal) => terminal.workspaceId === workspace.id && !terminal.exited).length;
  const gitValue = ui.gitLoading.has(workspace.id) ? 'Checking…' : git?.isRepository ? (git.branch ?? 'Detached') : 'Not a repository';
  const gitLabel = git?.isRepository
    ? git.clean ? 'Working tree clean' : `${git.changed + git.staged + git.untracked} pending changes`
    : git?.error ?? 'Git status unavailable';
  const codexState = ui.codexStatus.get(workspace.distro)?.state ?? (distro?.codexVersion ? 'ready' : 'missing');
  const remaining = remainingUsagePercent(ui.rateLimits.get(workspace.distro));
  const usageValue = remaining === null
    ? ui.codexMetadataLoading.has(workspace.distro) ? 'Loading…' : 'Unavailable'
    : `${remaining}% left`;

  const commands = workspace.commands.length
    ? workspace.commands.map((command) => renderActionRow(command)).join('')
    : `<div class="empty-inline">Add reusable commands from workspace settings.</div>`;
  const threadPreview = threads.length
    ? threads.slice(0, 4).map((thread) => `
      <button class="thread-preview-row" data-action="select-thread" data-thread-id="${escapeHtml(thread.id)}" data-go-codex="true">
        <span class="action-row-icon">${icon('message', 15)}</span>
        <span class="thread-preview-copy"><strong>${escapeHtml(thread.name ?? thread.preview ?? 'Codex thread')}</strong><small>${escapeHtml(thread.preview ?? 'Continue this Codex task')}</small></span>
        <span class="mini-chip">${relativeTime(thread.updatedAt)}</span>
      </button>`).join('')
    : `<div class="empty-inline">Open the Codex tab to load or start project conversations.</div>`;

  return `
    <div class="overview-page">
      <section class="hero">
        <div class="hero-copy">
          <div class="hero-kicker">${icon('sparkle', 14)} Local AI workspace</div>
          <h2>${escapeHtml(workspace.name)}</h2>
          <p>${escapeHtml(workspace.description || 'A focused environment for your project, commands, context, terminal sessions, and Codex work.')}</p>
          <div class="hero-actions">
            <button class="button primary" data-action="start-codex">${icon('sparkle', 15)} Work with Codex</button>
            <button class="button" data-action="open-intellij">${icon('code', 15)} Open IntelliJ</button>
            <button class="button" data-action="new-terminal">${icon('terminal', 15)} New terminal</button>
            <button class="button ghost" data-action="copy-context">${icon('copy', 15)} Copy context</button>
          </div>
        </div>
        <div class="hero-visual" aria-hidden="true"><span class="orbit"></span><span class="orbit"></span><span class="hero-core">${icon('logo', 43)}</span></div>
      </section>

      <div class="section-heading"><div><h3>Environment</h3><p>Live signals from this workspace</p></div><button class="button small ghost" data-action="refresh-workspace">${icon('refresh', 13)} Refresh</button></div>
      <section class="metrics-grid">
        ${renderMetric('branch', gitValue, gitLabel, git?.clean ? 'clean' : git ? 'dirty' : '')}
        ${renderMetric('terminal', `${terminalCount} open`, terminalCount === 1 ? 'Active terminal session' : 'Active terminal sessions')}
        ${renderMetric('context', `${workspace.contextItems.length} items`, 'Files, notes, and links')}
        ${renderMetric('sparkle', codexState === 'connected' ? 'Connected' : distro?.codexVersion ?? 'Not detected', `Codex · ${workspace.distro}`)}
        ${renderMetric('chart', usageValue, 'Codex primary usage limit')}
      </section>

      <div class="section-heading"><div><h3>Run and continue</h3><p>Deterministic commands and recent agent work</p></div></div>
      <section class="dashboard-grid">
        <article class="panel-card">
          <div class="panel-heading"><h3>Quick commands</h3><span>${workspace.commands.length} configured</span></div>
          <div class="action-list">${commands}</div>
        </article>
        <article class="panel-card">
          <div class="panel-heading"><h3>Codex threads</h3><button class="button small ghost" data-action="start-codex">View all</button></div>
          <div class="thread-preview-list">${threadPreview}</div>
        </article>
      </section>
      ${renderProjectPanel(workspace)}
    </div>`;
}

function renderProjectPanel(workspace: Workspace): string {
  const status = ui.projectSystems.get(workspace.id);
  const loading = ui.projectLoading.has(workspace.id);
  const files = status?.files.map((file) => `
    <span class="project-file ${file.exists && file.safe ? 'is-ready' : 'is-missing'}">
      ${icon(file.exists && file.safe ? 'check' : 'alert', 11)} ${escapeHtml(file.name)}
    </span>`).join('') ?? '';
  const tasks = status?.tasks ?? [];
  const taskRows = tasks.length
    ? tasks.slice(0, 10).map(renderProjectTask).join('')
    : `<div class="empty-inline">No queued tasks yet. Add one here instead of editing TASKS.md.</div>`;
  const unsafeFile = status?.files.find((file) => file.exists && !file.safe);

  return `
    <section class="project-panel panel-card">
      <div class="panel-heading">
        <div><h3>Project task queue</h3><span>Markdown-backed workflow in ${escapeHtml(workspace.root)}</span></div>
        <button class="button small ghost" data-action="refresh-project" ${loading ? 'disabled' : ''}>${icon('refresh', 12)} ${loading ? 'Checking…' : 'Refresh'}</button>
      </div>
      ${status ? `<div class="project-file-row">${files}</div>` : `<div class="empty-inline">${loading ? 'Inspecting project files…' : 'Project files have not been inspected.'}</div>`}
      ${unsafeFile ? `<div class="project-warning">${icon('alert', 13)} ${escapeHtml(unsafeFile.name)} resolves outside this workspace. Workbench will not modify it.</div>` : ''}
      ${status && !status.ready && !unsafeFile ? `<div class="project-setup"><p>Create the missing Markdown project guide, task queue, and progress log without replacing existing files.</p><button class="button small primary" data-action="initialize-project" ${loading ? 'disabled' : ''}>${icon('plus', 12)} Set up project files</button></div>` : ''}
      <div class="project-task-layout">
        <form class="task-compose" id="project-task-form">
          <label for="project-task-title">Add a task</label>
          <input id="project-task-title" name="title" required maxlength="180" placeholder="What should Codex accomplish?" />
          <textarea name="objective" maxlength="500" placeholder="Optional outcome or acceptance detail"></textarea>
          <button class="button small primary" type="submit" ${loading || Boolean(unsafeFile) ? 'disabled' : ''}>${icon('plus', 12)} Add to queue</button>
        </form>
        <div class="project-task-list">${taskRows}</div>
      </div>
    </section>`;
}

function renderProjectTask(task: ProjectTask): string {
  const prompt = task.objective || task.title;
  return `
    <article class="project-task-row">
      <span class="task-state state-${escapeHtml(task.state.replace(/\s+/g, '-'))}">${escapeHtml(task.state)}</span>
      <span class="project-task-copy"><strong>${escapeHtml(task.id)} · ${escapeHtml(task.title)}</strong><small>${escapeHtml(prompt)}</small></span>
      ${task.state === 'done' ? '' : `<button class="button small ghost" data-action="offer-project-task" data-task-id="${escapeHtml(task.id)}">Send to Codex</button>`}
    </article>`;
}

function renderMetric(iconName: string, value: string, label: string, status = ''): string {
  return `<article class="metric-card"><div class="metric-top"><span class="metric-icon">${icon(iconName, 15)}</span>${status ? `<span class="status-dot ${status}"></span>` : ''}</div><div class="metric-value">${escapeHtml(value)}</div><div class="metric-label">${escapeHtml(label)}</div></article>`;
}

function renderActionRow(command: WorkspaceCommand): string {
  return `
    <button class="action-row" data-action="run-command" data-command-id="${escapeHtml(command.id)}">
      <span class="action-row-icon">${icon('play', 15)}</span>
      <span class="action-row-copy"><strong>${escapeHtml(command.name)}</strong><small>${escapeHtml(command.description || command.command)}</small></span>
      <span class="mini-chip">${escapeHtml(command.command.split(/\s+/)[0] || 'run')}</span>
    </button>`;
}

function renderContextPanel(): string {
  const workspace = currentWorkspace();
  if (!workspace) {
    return `
      <aside class="context-panel">
        <div class="context-header"><div class="context-header-title">${icon('context', 15)}<h2>Context</h2></div></div>
        <div class="empty-inline">Select a workspace to assemble reusable context for ChatGPT and Codex.</div>
      </aside>`;
  }

  const grouped = new Map<ContextItem['type'], ContextItem[]>([
    ['file', []],
    ['note', []],
    ['url', []],
  ]);
  for (const item of workspace.contextItems) grouped.get(item.type)?.push(item);
  const labels: Record<ContextItem['type'], string> = { file: 'Files', note: 'Notes', url: 'Links' };
  const itemIcons: Record<ContextItem['type'], string> = { file: 'file', note: 'note', url: 'link' };
  const groups = (['file', 'note', 'url'] as const).map((type) => {
    const items = grouped.get(type) ?? [];
    if (!items.length) return '';
    return `<div class="context-group-label">${labels[type]}</div>${items.map((item) => `
      <div class="context-item">
        <span class="context-type-icon">${icon(itemIcons[type], 14)}</span>
        <span class="context-item-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(type === 'note' ? item.value.slice(0, 52) : compactPath(item.value, 38))}</small></span>
        <span class="context-item-actions">
          ${type === 'file' ? `<button class="icon-button ${item.includeContent ? 'is-active' : ''}" data-action="toggle-context-content" data-context-id="${escapeHtml(item.id)}" title="${item.includeContent ? 'Content included' : 'Path only'}">${icon(item.includeContent ? 'check' : 'file', 13)}</button>` : ''}
          <button class="icon-button" data-action="remove-context" data-context-id="${escapeHtml(item.id)}" title="Remove">${icon('close', 13)}</button>
        </span>
      </div>`).join('')}`;
  }).join('');

  const fileCount = grouped.get('file')?.length ?? 0;
  const noteCount = grouped.get('note')?.length ?? 0;
  return `
    <aside class="context-panel">
      <div class="context-header">
        <div class="context-header-title">${icon('context', 15)}<h2>Context pack</h2></div>
        <div class="context-actions">
          <button class="icon-button" data-action="preview-context" title="Preview context">${icon('search', 14)}</button>
          <button class="icon-button" data-action="save-context" title="Save Markdown">${icon('save', 14)}</button>
        </div>
      </div>
      <div class="context-summary">
        <p>Choose exactly what ChatGPT or Codex needs. File content stays inside the workspace boundary.</p>
        <div class="context-summary-stats"><span class="mini-chip">${fileCount} files</span><span class="mini-chip">${noteCount} notes</span><span class="mini-chip">${workspace.contextItems.length} total</span></div>
      </div>
      <div class="context-list">${groups || `<div class="empty-inline">Add project files, design notes, or reference links.</div>`}</div>
      <div class="context-footer">
        <button class="button primary" data-action="copy-context" ${ui.busyActions.has('copy-context') ? 'disabled' : ''}>${icon('copy', 14)} ${ui.busyActions.has('copy-context') ? 'Building…' : 'Copy for ChatGPT'}</button>
        <div class="context-add-row">
          <button class="button small" data-action="add-context-file">${icon('file', 12)} File</button>
          <button class="button small" data-action="add-context-note">${icon('note', 12)} Note</button>
          <button class="button small" data-action="add-context-url">${icon('link', 12)} Link</button>
        </div>
      </div>
    </aside>`;
}

function renderStatusbar(): string {
  const workspace = currentWorkspace();
  const git = workspace ? ui.git.get(workspace.id) : null;
  const codex = workspace ? ui.codexStatus.get(workspace.distro) : null;
  const distro = selectedDistribution();
  const pending = git && git.isRepository ? git.staged + git.changed + git.untracked : 0;
  return `
    <footer class="statusbar">
      <div class="status-group">
        <span class="status-item">${icon('branch', 12)}<span>${escapeHtml(git?.branch ?? 'No Git repository')}</span></span>
        ${git?.isRepository ? `<span class="status-item"><span class="status-dot ${git.clean ? 'clean' : 'dirty'}"></span><span>${git.clean ? 'Clean' : `${pending} changes`}</span></span>` : ''}
        ${workspace ? `<span class="status-item">${icon('folder', 11)}<span>${escapeHtml(compactPath(workspace.root, 45))}</span></span>` : ''}
      </div>
      <div class="status-group">
        <span class="status-item"><span class="status-dot ${distro ? 'connected' : 'error'}"></span><span>${escapeHtml(workspace?.distro ?? distro?.name ?? 'WSL')}</span></span>
        <span class="status-item"><span class="status-dot ${codex?.state ?? (distro?.codexVersion ? 'connected' : 'error')}"></span><span>${escapeHtml(codex?.state === 'connected' ? 'Codex connected' : distro?.codexVersion ?? 'Codex not found')}</span></span>
        <span class="status-item">Local only</span>
      </div>
    </footer>`;
}

function renderCodexPage(workspace: Workspace): string {
  const threads = ui.threadLists.get(workspace.id) ?? [];
  const activeThreadId = ui.activeThread.get(workspace.id) ?? null;
  const view = activeThreadId ? threadView(activeThreadId) : null;
  const status = ui.codexStatus.get(workspace.distro);
  const loading = ui.threadsLoading.has(workspace.id);
  const threadItems = threads.map((thread) => {
    const active = thread.id === activeThreadId;
    const label = thread.name ?? thread.preview ?? 'Untitled Codex thread';
    return `
      <button class="thread-item ${active ? 'is-active' : ''}" data-action="select-thread" data-thread-id="${escapeHtml(thread.id)}">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(thread.preview ?? 'Continue this conversation')}</span>
        <small>${relativeTime(thread.updatedAt ?? thread.createdAt)}</small>
      </button>`;
  }).join('');

  return `
    <div class="codex-page">
      <aside class="thread-rail">
        <div class="thread-rail-header">
          <strong>Codex threads</strong>
          <div>
            <button class="icon-button" data-action="refresh-threads" title="Refresh">${icon('refresh', 13)}</button>
            <button class="icon-button" data-action="new-thread" title="New thread">${icon('plus', 14)}</button>
          </div>
        </div>
        <div class="thread-list">
          ${loading ? renderThreadSkeletons() : threadItems || `<div class="empty-inline">No project threads yet.<br><br><button class="button small primary" data-action="new-thread">Start one</button></div>`}
        </div>
      </aside>
      <section class="codex-conversation">
        ${activeThreadId && view ? renderConversation(workspace, activeThreadId, view, status) : renderCodexLanding(workspace, status)}
      </section>
    </div>`;
}

function renderThreadSkeletons(): string {
  return Array.from({ length: 4 }, (_, index) => `<div class="thread-item"><div class="loading-skeleton" style="width:${70 - index * 5}%;height:10px"></div><div class="loading-skeleton" style="width:92%;height:8px;margin-top:10px"></div><div class="loading-skeleton" style="width:30%;height:7px;margin-top:11px"></div></div>`).join('');
}

function renderCodexLanding(workspace: Workspace, status?: CodexConnectionStatus): string {
  const connecting = status?.state === 'connecting' || ui.busyActions.has('codex-connect');
  return `
    <div class="codex-landing">
      ${renderCodexControls(workspace, null)}
      <div class="empty-state">
        <div class="empty-state-card">
          <div class="empty-state-icon">${icon('sparkle', 31)}</div>
          <h2>Codex, inside your workspace.</h2>
          <p>Start a project thread with <code>${escapeHtml(workspace.root)}</code> as its working directory. Workbench streams plans, commands, diffs, reviews, and approval requests directly from Codex.</p>
          <button class="button primary" data-action="new-thread" ${connecting ? 'disabled' : ''}>${icon('plus', 15)} ${connecting ? 'Connecting…' : 'Start a Codex thread'}</button>
        </div>
      </div>
    </div>`;
}

function sessionModelPreference(workspace: Workspace, threadId: string | null): CodexModelPreference {
  return chooseCodexModelPreference(
    ui.codexModels.get(workspace.distro) ?? [],
    ui.codexPreferences.get(workspace.id, threadId),
    threadId !== null,
  );
}

function renderCodexControls(workspace: Workspace, threadId: string | null): string {
  const models = ui.codexModels.get(workspace.distro) ?? [];
  const preference = sessionModelPreference(workspace, threadId);
  const selected = models.find((model) => model.model === preference.model);
  const efforts = selected?.supportedReasoningEfforts ?? [];
  const loading = ui.codexMetadataLoading.has(workspace.distro);
  const error = ui.codexMetadataErrors.get(workspace.distro);
  const remaining = remainingUsagePercent(ui.rateLimits.get(workspace.distro));
  const reset = primaryRateLimit(ui.rateLimits.get(workspace.distro))?.primary?.resetsAt;
  const usage = remaining === null ? (loading ? 'Loading usage…' : 'Usage unavailable') : `${remaining}% remaining`;
  const unavailableModel = preference.model && !selected ? preference.model : null;
  const unavailableModelOption = unavailableModel
    ? `<option value="${escapeHtml(unavailableModel)}" selected disabled>${escapeHtml(unavailableModel)} (Unavailable)</option>`
    : '';
  const modelOptions = unavailableModelOption + models.map((model) => `<option value="${escapeHtml(model.model)}" ${model.model === preference.model ? 'selected' : ''}>${escapeHtml(model.displayName || model.model)}</option>`).join('');
  const unavailableEffortOption = unavailableModel && preference.effort
    ? `<option value="${escapeHtml(preference.effort)}" selected disabled>${escapeHtml(titleCase(preference.effort))} (Unavailable)</option>`
    : '';
  const effortOptions = unavailableEffortOption + efforts.map((option) => `<option value="${escapeHtml(option.reasoningEffort)}" ${option.reasoningEffort === preference.effort ? 'selected' : ''}>${escapeHtml(titleCase(option.reasoningEffort))}</option>`).join('');

  return `
    <div class="codex-config-bar">
      <span class="codex-config-scope">${threadId ? 'This thread' : 'New thread'}</span>
      <label class="codex-selector"><span>Model</span><select data-codex-setting="model" aria-label="Codex session model" ${!models.length || loading ? 'disabled' : ''}>${modelOptions || '<option>Unavailable</option>'}</select></label>
      <label class="codex-selector"><span>Reasoning</span><select data-codex-setting="effort" aria-label="Codex session reasoning effort" ${unavailableModel || !efforts.length || loading ? 'disabled' : ''}>${effortOptions || '<option>Default</option>'}</select></label>
      <div class="codex-usage" title="Codex primary usage window">${icon('chart', 13)}<span><strong>${escapeHtml(usage)}</strong>${reset ? `<small>Resets ${escapeHtml(formatResetTime(reset))}</small>` : ''}</span></div>
      ${error ? `<span class="codex-metadata-error" title="${escapeHtml(error)}">${icon('alert', 12)} Metadata unavailable</span>` : ''}
      <button class="icon-button" data-action="refresh-codex-metadata" title="Refresh models and usage" ${loading ? 'disabled' : ''}>${icon('refresh', 13)}</button>
    </div>`;
}

function titleCase(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function formatResetTime(timestampSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    .format(new Date(timestampSeconds * 1_000));
}

function renderConversation(
  workspace: Workspace,
  threadId: string,
  view: ThreadViewState,
  status?: CodexConnectionStatus,
): string {
  const summary = (ui.threadLists.get(workspace.id) ?? []).find((thread) => thread.id === threadId);
  const title = summary?.name ?? summary?.preview ?? 'Codex thread';
  const entries = view.entries.map(renderCodexEntry).join('');
  const approvalCards = [...ui.approvals.values()]
    .filter((request) => approvalBelongsToThread(request, threadId, workspace.distro))
    .map(renderApprovalCard)
    .join('');
  const plan = view.plan.length ? renderPlan(view) : '';
  const diff = view.diff ? renderDiffCard(view.diff) : '';
  const running = view.turnStatus === 'inProgress' || Boolean(view.activeTurnId);
  const composer = ui.composerText.get(threadId) ?? '';
  const connected = status?.state === 'connected' || window.workbench === undefined;

  return `
    <div class="conversation-header">
      <div class="conversation-title"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(threadId)} · ${escapeHtml(workspace.root)}</span></div>
      <div class="conversation-actions">
        <button class="button small" data-action="review-thread" title="Review uncommitted changes">${icon('review', 13)} Review diff</button>
        ${running ? `<button class="button small danger" data-action="interrupt-turn">${icon('stop', 12)} Stop</button>` : ''}
        <button class="icon-button" data-action="archive-thread" title="Archive thread">${icon('archive', 14)}</button>
      </div>
    </div>
    ${renderCodexControls(workspace, threadId)}
    <div class="message-scroll" id="message-scroll">
      <div class="message-list">
        ${entries || `<div class="empty-inline">Ask Codex to inspect, implement, test, explain, or review something in this workspace.</div>`}
        ${plan}
        ${approvalCards}
        ${diff}
        ${running && !view.entries.some((entry) => entry.type === 'agent' && !entry.text) ? `<div class="message agent"><div class="message-avatar">${icon('sparkle', 14)}</div><div class="message-content"><div class="message-meta"><strong>Codex</strong><span>working</span></div><div class="typing-indicator"><i></i><i></i><i></i></div></div></div>` : ''}
      </div>
    </div>
    <div class="composer-wrap">
      <form class="composer" id="codex-form">
        <textarea id="codex-composer" name="prompt" placeholder="Ask Codex to work in ${escapeHtml(workspace.name)}…" ${!connected ? 'disabled' : ''}>${escapeHtml(composer)}</textarea>
        <div class="composer-footer">
          <span>${escapeHtml(ui.data?.settings.approvalPolicy ?? 'onRequest')} approvals · ${ui.data?.settings.networkAccess ? 'network allowed' : 'network blocked'} · Ctrl+Enter to send</span>
          <button class="button small primary" type="submit" ${!connected || !composer.trim() || ui.busyActions.has('codex-turn') ? 'disabled' : ''}>${icon('send', 12)} Send</button>
        </div>
      </form>
    </div>`;
}

function approvalBelongsToThread(request: CodexServerRequestEnvelope, threadId: string, distro: string): boolean {
  if (request.distro !== distro) return false;
  const requestThread = stringValue(request.params.threadId);
  return !requestThread || requestThread === threadId;
}

function renderCodexEntry(entry: CodexEntry): string {
  if (entry.type === 'command') {
    return `
      <article class="command-card">
        <div class="command-card-header"><span>${icon('terminal', 13)} Command</span><code>${escapeHtml(entry.command || entry.text || 'shell command')}</code><span>${escapeHtml(entry.status ?? 'running')}</span></div>
        ${entry.output ? `<pre class="command-card-output">${escapeHtml(entry.output)}</pre>` : ''}
      </article>`;
  }
  if (entry.type === 'file') {
    return `
      <article class="command-card">
        <div class="command-card-header"><span>${icon('file', 13)} File change</span><code>${escapeHtml(entry.text || 'Workspace files')}</code><span>${escapeHtml(entry.status ?? 'updated')}</span></div>
        ${entry.output ? `<pre class="command-card-output">${escapeHtml(entry.output)}</pre>` : ''}
      </article>`;
  }
  if (entry.type === 'system') {
    return `<div class="status-chip">${icon('alert', 11)} ${escapeHtml(entry.text)}</div>`;
  }
  const isUser = entry.type === 'user';
  const isReview = entry.type === 'review';
  const role = isUser ? 'You' : isReview ? 'Codex review' : 'Codex';
  const avatar = isUser ? 'message' : isReview ? 'review' : 'sparkle';
  return `
    <article class="message ${isUser ? 'user' : 'agent'}">
      <div class="message-avatar">${icon(avatar, 14)}</div>
      <div class="message-content">
        <div class="message-meta"><strong>${role}</strong>${entry.phase ? `<span>${escapeHtml(entry.phase)}</span>` : ''}${entry.status ? `<span>${escapeHtml(entry.status)}</span>` : ''}</div>
        <div class="message-body">${entry.text ? renderMarkdown(entry.text) : `<span class="typing-indicator"><i></i><i></i><i></i></span>`}</div>
      </div>
    </article>`;
}

function renderPlan(view: ThreadViewState): string {
  return `
    <article class="plan-card">
      <div class="plan-card-header"><span>${icon('overview', 13)} Plan</span><span>${escapeHtml(view.planExplanation)}</span></div>
      <div class="plan-card-body">${view.plan.map((step, index) => `
        <div class="plan-step ${escapeHtml(step.status)}">
          <span class="plan-step-marker">${step.status === 'completed' ? icon('check', 10) : step.status === 'inProgress' ? '•' : index + 1}</span>
          <span>${escapeHtml(step.step)}</span>
        </div>`).join('')}</div>
    </article>`;
}

function renderDiffCard(diff: string): string {
  return `<article class="diff-card"><div class="diff-card-header"><span>${icon('git', 13)} Current turn diff</span><span>${diff.split(/\r?\n/).length} lines</span></div>${renderDiff(diff)}</article>`;
}

function renderApprovalCard(request: CodexServerRequestEnvelope): string {
  const isCommand = request.method.includes('commandExecution');
  const title = isCommand ? 'Command approval required' : 'File change approval required';
  const reason = stringValue(request.params.reason, 'Codex needs permission to continue.');
  const commandValue = request.params.command;
  const command = Array.isArray(commandValue)
    ? commandValue.map((part) => String(part)).join(' ')
    : stringValue(commandValue, stringValue(request.params.path, 'Workspace change'));
  return `
    <article class="approval-card">
      <div class="approval-card-header"><span>${icon('shield', 13)} ${title}</span><span>${escapeHtml(request.method)}</span></div>
      <div class="approval-card-body">${escapeHtml(reason)}<code>${escapeHtml(command)}</code></div>
      <div class="approval-actions">
        <button class="button small primary" data-action="respond-approval" data-request-id="${escapeHtml(String(request.id))}" data-decision="accept">Allow once</button>
        <button class="button small" data-action="respond-approval" data-request-id="${escapeHtml(String(request.id))}" data-decision="acceptForSession">Allow for session</button>
        <button class="button small danger" data-action="respond-approval" data-request-id="${escapeHtml(String(request.id))}" data-decision="decline">Decline</button>
      </div>
    </article>`;
}

function renderTerminalPage(workspace: Workspace): string {
  const sessions = [...ui.terminals.values()].filter((terminal) => terminal.workspaceId === workspace.id);
  const activeHandle = ui.activeTerminal.get(workspace.id) ?? sessions.at(-1)?.info.handle ?? null;
  const active = activeHandle ? ui.terminals.get(activeHandle) : null;
  const tabs = sessions.map((terminal, index) => `
    <button class="terminal-tab ${terminal.info.handle === activeHandle ? 'is-active' : ''}" data-action="select-terminal" data-terminal-handle="${escapeHtml(terminal.info.handle)}">
      ${icon('terminal', 12)}<span>${escapeHtml(terminal.info.title)} ${index + 1}${terminal.exited ? ' · exited' : ''}</span>
      <span class="terminal-tab-close" data-action="close-terminal" data-terminal-handle="${escapeHtml(terminal.info.handle)}">${icon('close', 11)}</span>
    </button>`).join('');

  return `
    <div class="terminal-page">
      <div class="terminal-toolbar">
        <div class="terminal-tabs">${tabs}</div>
        <div class="conversation-actions">
          <button class="button small ghost" data-action="clear-terminal" ${!active ? 'disabled' : ''}>Clear</button>
          <button class="button small" data-action="new-terminal" ${ui.busyActions.has('new-terminal') ? 'disabled' : ''}>${icon('plus', 12)} New terminal</button>
        </div>
      </div>
      ${active ? `
        <div class="terminal-surface">
          <pre class="terminal-output" id="terminal-output"></pre>
          <form class="terminal-input-row" id="terminal-form">
            <span class="terminal-prompt">›</span>
            <input class="terminal-input" id="terminal-input" name="command" autocomplete="off" spellcheck="false" placeholder="Type a command and press Enter" ${active.exited ? 'disabled' : ''} />
            <button class="button small primary" type="submit" ${active.exited ? 'disabled' : ''}>Run</button>
          </form>
        </div>` : `
        <div class="empty-state">
          <div class="empty-state-card">
            <div class="empty-state-icon">${icon('terminal', 29)}</div>
            <h2>A terminal for this workspace.</h2>
            <p>Open a persistent shell in <code>${escapeHtml(workspace.root)}</code>. Workbench first uses Codex’s native process protocol and automatically falls back to a direct WSL shell.</p>
            <button class="button primary" data-action="new-terminal">${icon('plus', 14)} New terminal</button>
          </div>
        </div>`}
    </div>`;
}

function updateTerminalOutput(): void {
  if (ui.activeTab !== 'terminal') return;
  const workspace = currentWorkspace();
  if (!workspace) return;
  const handle = ui.activeTerminal.get(workspace.id);
  const terminal = handle ? ui.terminals.get(handle) : null;
  const output = document.querySelector<HTMLElement>('#terminal-output');
  if (!terminal || !output) return;
  const nearBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 100;
  output.textContent = terminal.buffer.toString();
  if (nearBottom || output.scrollTop === 0) output.scrollTop = output.scrollHeight;
}

function renderOverlay(): void {
  if (ui.paletteOpen) {
    overlayRoot.innerHTML = renderPalette();
    window.setTimeout(() => document.querySelector<HTMLInputElement>('#palette-input')?.focus(), 0);
    return;
  }
  if (!ui.modal) {
    overlayRoot.innerHTML = '';
    return;
  }
  overlayRoot.innerHTML = renderModal(ui.modal);
  window.setTimeout(() => {
    document.querySelector<HTMLElement>('[data-autofocus="true"]')?.focus();
  }, 0);
}

function renderModal(modal: Exclude<ModalState, null>): string {
  if (modal.kind === 'workspace') return renderWorkspaceModal(modal.workspaceId);
  if (modal.kind === 'settings') return renderSettingsModal();
  if (modal.kind === 'context') return renderContextModal(modal.contextType);
  if (modal.kind === 'preview') return renderPreviewModal(modal.result);
  return renderDeleteModal(modal.workspaceId);
}

function modalFrame(title: string, subtitle: string, body: string, footer: string, wide = false): string {
  return `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <header class="modal-header"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="icon-button" data-action="close-modal">${icon('close', 15)}</button></header>
        <div class="modal-body">${body}</div>
        <footer class="modal-footer">${footer}</footer>
      </section>
    </div>`;
}

function renderWorkspaceModal(workspaceId?: string): string {
  const existing = workspaceId ? ui.data?.workspaces.find((workspace) => workspace.id === workspaceId) : undefined;
  const defaultDistro = existing?.distro ?? selectedDistribution()?.name ?? '';
  const defaultHome = ui.system?.distributions.find((item) => item.name === defaultDistro)?.home ?? '/home/user';
  const icons: WorkspaceIcon[] = ['code', 'chart', 'book', 'briefcase', 'language', 'folder'];
  const commands = existing?.commands.map((command) => `${command.name} :: ${command.command}${command.description ? ` :: ${command.description}` : ''}`).join('\n') ?? '';
  const distroOptions = (ui.system?.distributions ?? []).map((distro) => `<option value="${escapeHtml(distro.name)}" ${distro.name === defaultDistro ? 'selected' : ''}>${escapeHtml(distro.name)}${distro.isDefault ? ' (default)' : ''}</option>`).join('');
  const body = `
    <form id="workspace-form">
      <input type="hidden" name="workspaceId" value="${escapeHtml(existing?.id ?? '')}" />
      <input type="hidden" id="workspace-icon-value" name="icon" value="${escapeHtml(existing?.icon ?? 'code')}" />
      <div class="form-grid">
        <div class="form-field full"><label for="workspace-name">Name</label><input id="workspace-name" name="name" data-autofocus="true" required maxlength="100" value="${escapeHtml(existing?.name ?? '')}" placeholder="Curve Server" /></div>
        <div class="form-field full"><label for="workspace-description">Description</label><textarea id="workspace-description" name="description" placeholder="What belongs in this workspace?">${escapeHtml(existing?.description ?? '')}</textarea></div>
        <div class="form-field full"><span class="field-label">Icon</span><div class="icon-picker">${icons.map((candidate) => `<button type="button" class="icon-choice ${candidate === (existing?.icon ?? 'code') ? 'is-active' : ''}" data-action="choose-workspace-icon" data-icon="${candidate}">${icon(candidate, 17)}</button>`).join('')}</div></div>
        <div class="form-field"><label for="workspace-distro">WSL distribution</label><select id="workspace-distro" name="distro" required>${distroOptions || `<option value="${escapeHtml(defaultDistro)}">${escapeHtml(defaultDistro || 'Ubuntu')}</option>`}</select></div>
        <div class="form-field"><label for="workspace-root">Linux project root</label><input id="workspace-root" name="root" required value="${escapeHtml(existing?.root ?? '')}" placeholder="${escapeHtml(`${defaultHome}/projects/my-project`)}" /><small>Use an absolute WSL path. Context files are restricted to this root.</small></div>
        ${existing ? '' : `<div class="form-field full"><label class="checkbox-row"><input type="checkbox" name="initializeProject" checked /><span class="checkbox-copy"><strong>Set up the Markdown project workflow</strong><span>Create missing AGENTS.md, TASKS.md, and WORKBENCH_PROGRESS.md files. Existing files are never replaced.</span></span></label></div>`}
        <div class="form-field full"><label for="workspace-commands">Quick commands</label><textarea id="workspace-commands" name="commands" spellcheck="false" placeholder="Run tests :: ./gradlew test :: Complete test suite\nStart app :: ./gradlew bootRun">${escapeHtml(commands)}</textarea><div class="commands-help">One command per line: Name :: shell command :: optional description</div></div>
      </div>
    </form>`;
  const footer = `${existing ? `<button class="button danger" data-action="delete-workspace-prompt" data-workspace-id="${escapeHtml(existing.id)}">${icon('trash', 13)} Delete</button>` : ''}<span style="flex:1"></span><button class="button" data-action="close-modal">Cancel</button><button class="button primary" data-action="submit-workspace">${existing ? 'Save changes' : 'Create workspace'}</button>`;
  return modalFrame(existing ? 'Edit workspace' : 'New workspace', 'Connect a WSL directory to your local tools.', body, footer);
}

function renderSettingsModal(): string {
  const settings = ui.data?.settings;
  const body = `
    <form id="settings-form">
      <div class="form-grid">
        <div class="form-field full"><label for="intellij-path">IntelliJ executable</label><input id="intellij-path" name="intellijPath" data-autofocus="true" value="${escapeHtml(settings?.intellijPath ?? '')}" placeholder="C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe" /><small>Leave blank when <code>idea64.exe</code> is already available on PATH.</small></div>
        <div class="form-field"><label for="approval-policy">Codex approval policy</label><select id="approval-policy" name="approvalPolicy">
          <option value="onRequest" ${settings?.approvalPolicy === 'onRequest' ? 'selected' : ''}>Ask when needed</option>
          <option value="unlessTrusted" ${settings?.approvalPolicy === 'unlessTrusted' ? 'selected' : ''}>Unless trusted</option>
          <option value="never" ${settings?.approvalPolicy === 'never' ? 'selected' : ''}>Never ask</option>
        </select></div>
        <div class="form-field"><label for="context-size">Maximum bytes per context file</label><input id="context-size" name="maxContextFileBytes" type="number" min="10000" max="1000000" step="10000" value="${settings?.maxContextFileBytes ?? 120000}" /></div>
        <div class="form-field full"><label class="checkbox-row"><input type="checkbox" name="networkAccess" ${settings?.networkAccess ? 'checked' : ''} /><span class="checkbox-copy"><strong>Allow network access during Codex turns</strong><span>Disabled by default. Workbench still allows Codex authentication, but sandboxed commands cannot access the network.</span></span></label></div>
      </div>
    </form>`;
  return modalFrame('Settings', 'Local applications, Codex permissions, and context limits.', body, `<button class="button" data-action="inspect-system">${icon('refresh', 13)} Inspect WSL</button><span style="flex:1"></span><button class="button" data-action="close-modal">Cancel</button><button class="button primary" data-action="submit-settings">Save settings</button>`);
}

function renderContextModal(type: 'note' | 'url'): string {
  const isNote = type === 'note';
  const body = `
    <form id="context-form">
      <input type="hidden" name="contextType" value="${type}" />
      <div class="form-grid">
        <div class="form-field full"><label for="context-label">Label</label><input id="context-label" name="label" data-autofocus="true" required maxlength="120" placeholder="${isNote ? 'Design constraints' : 'Project documentation'}" /></div>
        <div class="form-field full"><label for="context-value">${isNote ? 'Note' : 'URL'}</label>${isNote ? `<textarea id="context-value" name="value" required placeholder="Important assumptions, decisions, or instructions…"></textarea>` : `<input id="context-value" name="value" type="url" required placeholder="https://…" />`}</div>
      </div>
    </form>`;
  return modalFrame(`Add ${isNote ? 'note' : 'link'}`, 'This item will be included in the generated context pack.', body, `<button class="button" data-action="close-modal">Cancel</button><button class="button primary" data-action="submit-context">Add ${isNote ? 'note' : 'link'}</button>`);
}

function renderPreviewModal(result: ContextBuildResult): string {
  const warning = result.warnings.length ? `${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}` : 'No warnings';
  const body = `<div class="context-summary-stats" style="margin:0 0 12px"><span class="mini-chip">${result.includedFiles} files</span><span class="mini-chip">${result.truncatedFiles} truncated</span><span class="mini-chip">${escapeHtml(warning)}</span></div><pre class="context-preview-code">${escapeHtml(result.markdown)}</pre>`;
  return modalFrame('Context preview', 'This Markdown is ready to paste into ChatGPT.', body, `<button class="button" data-action="close-modal">Close</button><button class="button primary" data-action="copy-context-from-preview">${icon('copy', 13)} Copy</button>`, true);
}

function renderDeleteModal(workspaceId: string): string {
  const workspace = ui.data?.workspaces.find((candidate) => candidate.id === workspaceId);
  const body = `<p style="margin:0;color:var(--text-soft);line-height:1.6">Remove <strong>${escapeHtml(workspace?.name ?? 'this workspace')}</strong> from Workbench? The project files in WSL are not deleted.</p>`;
  return modalFrame('Remove workspace', 'This only removes the saved Workbench configuration.', body, `<button class="button" data-action="close-modal">Cancel</button><button class="button danger" data-action="confirm-delete-workspace" data-workspace-id="${escapeHtml(workspaceId)}">Remove workspace</button>`);
}

function paletteActions(): PaletteAction[] {
  const workspace = currentWorkspace();
  const actions: PaletteAction[] = [];
  for (const candidate of ui.data?.workspaces ?? []) {
    actions.push({ id: `workspace:${candidate.id}`, label: candidate.name, description: candidate.root, icon: candidate.icon, section: 'Switch workspace' });
  }
  actions.push({ id: 'global:new-workspace', label: 'New workspace', description: 'Connect another WSL directory', icon: 'plus', section: 'Workbench' });
  actions.push({ id: 'global:settings', label: 'Open settings', description: 'Configure IntelliJ, WSL, and Codex permissions', icon: 'settings', section: 'Workbench' });
  if (workspace) {
    actions.push(
      { id: 'action:codex', label: 'Work with Codex', description: `Open Codex in ${workspace.name}`, icon: 'sparkle', section: 'Current workspace' },
      { id: 'action:terminal', label: 'New terminal', description: workspace.root, icon: 'terminal', section: 'Current workspace' },
      { id: 'action:intellij', label: 'Open in IntelliJ', description: workspace.root, icon: 'code', section: 'Current workspace' },
      { id: 'action:context', label: 'Copy context for ChatGPT', description: `${workspace.contextItems.length} context items`, icon: 'copy', section: 'Current workspace' },
    );
    for (const command of workspace.commands) {
      actions.push({ id: `command:${command.id}`, label: command.name, description: command.description || command.command, icon: 'play', section: 'Commands' });
    }
  }
  return actions;
}

function filteredPaletteActions(): PaletteAction[] {
  const query = ui.paletteQuery.trim().toLowerCase();
  const actions = paletteActions();
  if (!query) return actions;
  return actions.filter((action) => `${action.label} ${action.description} ${action.section}`.toLowerCase().includes(query));
}

function renderPalette(): string {
  const actions = filteredPaletteActions();
  if (ui.paletteIndex >= actions.length) ui.paletteIndex = Math.max(0, actions.length - 1);
  let lastSection = '';
  const results = actions.map((action, index) => {
    const heading = action.section !== lastSection ? `<div class="palette-section">${escapeHtml(action.section)}</div>` : '';
    lastSection = action.section;
    return `${heading}<button class="palette-result ${index === ui.paletteIndex ? 'is-selected' : ''}" data-action="palette-result" data-palette-id="${escapeHtml(action.id)}" data-palette-index="${index}"><span class="palette-result-icon">${icon(action.icon, 14)}</span><span class="palette-result-copy"><strong>${escapeHtml(action.label)}</strong><span>${escapeHtml(action.description)}</span></span>${icon('arrow', 13)}</button>`;
  }).join('');
  return `
    <div class="palette-backdrop" data-action="close-palette-backdrop">
      <section class="command-palette">
        <div class="palette-search">${icon('search', 17)}<input class="palette-input" id="palette-input" value="${escapeHtml(ui.paletteQuery)}" placeholder="Search workspaces, actions, and commands…" autocomplete="off" /><kbd class="keycap">Esc</kbd></div>
        <div class="palette-results">${results || `<div class="empty-inline">No matching action.</div>`}</div>
      </section>
    </div>`;
}

function renderMainArea(preserveFocus = false, scrollToBottom = false): void {
  const container = document.querySelector<HTMLElement>('#main-content');
  if (!container) {
    renderAll({ preserveFocus });
    return;
  }
  const focus = preserveFocus ? captureFocus() : null;
  container.innerHTML = renderMainContent();
  restoreFocus(focus);
  updateTerminalOutput();
  if (scrollToBottom) {
    window.requestAnimationFrame(() => {
      const scroll = document.querySelector<HTMLElement>('#message-scroll');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    });
  }
}

let streamRenderTimer: number | undefined;
function scheduleStreamRender(scrollToBottom = true): void {
  if (streamRenderTimer !== undefined) return;
  streamRenderTimer = window.setTimeout(() => {
    streamRenderTimer = undefined;
    if (ui.activeTab === 'codex') renderMainArea(true, scrollToBottom);
  }, 55);
}

async function loadInitialState(): Promise<void> {
  disposers.push(
    api.codex.onEvent(handleCodexEvent),
    api.codex.onServerRequest(handleCodexServerRequest),
    api.codex.onStatus(handleCodexStatus),
    api.terminal.onData(handleTerminalData),
    api.terminal.onExit(handleTerminalExit),
  );

  ui.data = await api.state.get();
  renderAll();

  void api.system.inspect().then((inspection) => {
    ui.system = inspection;
    renderAll({ preserveFocus: true });
  }).catch((error) => toast(errorMessage(error), 'error'));

  const workspace = currentWorkspace();
  if (workspace) {
    void refreshGit(workspace);
    void ensureProjectSystem(workspace);
    void ensureCodexMetadata(workspace);
  }
}

async function refreshGit(workspace: Workspace): Promise<void> {
  if (ui.gitLoading.has(workspace.id)) return;
  ui.gitLoading.add(workspace.id);
  renderAll({ preserveFocus: true });
  try {
    ui.git.set(workspace.id, await api.system.gitStatus(workspace.id));
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    ui.gitLoading.delete(workspace.id);
    renderAll({ preserveFocus: true });
  }
}

async function ensureCodexMetadata(workspace: Workspace, force = false): Promise<void> {
  if (ui.codexMetadataLoading.has(workspace.distro)) return;
  if (!force && ui.codexModels.has(workspace.distro) && ui.rateLimits.has(workspace.distro)) return;
  ui.codexMetadataLoading.add(workspace.distro);
  ui.codexMetadataErrors.delete(workspace.distro);
  renderAll({ preserveFocus: true });
  try {
    await api.codex.connect(workspace.id);
    const [modelsResult, limitsResult] = await Promise.allSettled([
      api.codex.listModels(workspace.id),
      api.codex.getRateLimits(workspace.id),
    ]);
    const failures: string[] = [];
    if (modelsResult.status === 'fulfilled') {
      const models = modelsResult.value.data.filter((model) => !model.hidden);
      ui.codexModels.set(workspace.distro, models);
    } else {
      failures.push(errorMessage(modelsResult.reason));
    }
    if (limitsResult.status === 'fulfilled') ui.rateLimits.set(workspace.distro, limitsResult.value);
    else failures.push(errorMessage(limitsResult.reason));
    if (failures.length) ui.codexMetadataErrors.set(workspace.distro, failures.join(' · '));
  } catch (error) {
    ui.codexMetadataErrors.set(workspace.distro, errorMessage(error));
  } finally {
    ui.codexMetadataLoading.delete(workspace.distro);
    renderAll({ preserveFocus: true });
  }
}

async function ensureProjectSystem(workspace: Workspace, force = false, notifyFailure = false): Promise<void> {
  if (ui.projectLoading.has(workspace.id)) return;
  if (!force && ui.projectSystems.has(workspace.id)) return;
  ui.projectLoading.add(workspace.id);
  renderAll({ preserveFocus: true });
  try {
    ui.projectSystems.set(workspace.id, await api.project.inspect(workspace.id));
  } catch (error) {
    if (notifyFailure) toast(errorMessage(error), 'error');
  } finally {
    ui.projectLoading.delete(workspace.id);
    renderAll({ preserveFocus: true });
  }
}

async function initializeProject(workspace: Workspace): Promise<void> {
  ui.projectLoading.add(workspace.id);
  renderAll({ preserveFocus: true });
  try {
    ui.projectSystems.set(workspace.id, await api.project.initialize(workspace.id));
    toast('Missing project Markdown files created.');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    ui.projectLoading.delete(workspace.id);
    renderAll({ preserveFocus: true });
  }
}

async function submitProjectTask(): Promise<void> {
  const workspace = currentWorkspace();
  const form = document.querySelector<HTMLFormElement>('#project-task-form');
  if (!workspace || !form || !form.reportValidity()) return;
  const data = new FormData(form);
  ui.projectLoading.add(workspace.id);
  renderAll({ preserveFocus: true });
  try {
    ui.projectSystems.set(workspace.id, await api.project.addTask(workspace.id, {
      title: String(data.get('title') ?? ''),
      objective: String(data.get('objective') ?? ''),
    }));
    renderAll({ preserveFocus: true });
    toast('Task added to TASKS.md.');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    ui.projectLoading.delete(workspace.id);
    renderAll({ preserveFocus: true });
  }
}

async function saveCodexSetting(workspace: Workspace, setting: 'model' | 'effort', value: string): Promise<void> {
  const models = ui.codexModels.get(workspace.distro) ?? [];
  const threadId = ui.activeThread.get(workspace.id) ?? null;
  const previous = sessionModelPreference(workspace, threadId);
  const preference = changeCodexModelPreference(models, previous, setting, value);
  ui.codexPreferences.set(workspace.id, threadId, preference);
  renderAll({ preserveFocus: true });
  if (!threadId) return;
  try {
    await api.codex.updateThreadSettings(workspace.id, threadId, preference);
  } catch (error) {
    ui.codexPreferences.set(workspace.id, threadId, previous);
    renderAll({ preserveFocus: true });
    toast(errorMessage(error), 'error');
  }
}

async function offerProjectTask(workspace: Workspace, taskId: string): Promise<void> {
  const task = ui.projectSystems.get(workspace.id)?.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return;
  ui.activeTab = 'codex';
  renderAll();
  await Promise.all([ensureCodexMetadata(workspace), ensureThreads(workspace)]);
  if (!ui.activeThread.get(workspace.id)) await startNewThread(workspace);
  const threadId = ui.activeThread.get(workspace.id);
  if (!threadId) return;
  ui.composerText.set(threadId, `Work on ${task.id} — ${task.title}. ${task.objective}`.trim());
  renderAll({ preserveFocus: true });
  window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('#codex-composer')?.focus(), 0);
}

async function ensureThreads(workspace: Workspace, force = false): Promise<void> {
  if (ui.threadsLoading.has(workspace.id)) return;
  if (!force && ui.threadLists.has(workspace.id)) return;
  ui.threadsLoading.add(workspace.id);
  renderMainArea(true);
  try {
    await api.codex.connect(workspace.id);
    const response = await api.codex.listThreads(workspace.id);
    ui.threadLists.set(workspace.id, response.data ?? []);
    if (!ui.activeThread.has(workspace.id) && response.data?.[0]) {
      ui.activeThread.set(workspace.id, response.data[0].id);
      await loadThread(workspace, response.data[0].id, false);
    }
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    ui.threadsLoading.delete(workspace.id);
    renderAll({ preserveFocus: true });
  }
}

async function loadThread(workspace: Workspace, threadId: string, shouldRender = true): Promise<void> {
  const view = threadView(threadId);
  ui.activeThread.set(workspace.id, threadId);
  if (shouldRender) renderMainArea(true);
  try {
    const resumeResponse = await api.codex.resumeThread(workspace.id, threadId);
    rememberThreadModelPreference(workspace, threadId, resumeResponse);
    const response = await api.codex.readThread(workspace.id, threadId);
    hydrateThreadView(view, response);
  } catch (error) {
    view.entries.push({ id: `error-${Date.now()}`, type: 'system', text: errorMessage(error) });
  }
  view.loaded = true;
  if (shouldRender) renderMainArea(true, true);
}

function rememberThreadModelPreference(
  workspace: Workspace,
  threadId: string,
  response: Record<string, unknown>,
  fallback?: CodexModelPreference,
): void {
  const model = stringValue(response.model, fallback?.model ?? '');
  const effort = stringValue(response.reasoningEffort, stringValue(response.effort, fallback?.effort ?? ''));
  ui.codexPreferences.set(workspace.id, threadId, {
    model: model || null,
    effort: effort || null,
  });
}

function hydrateThreadView(view: ThreadViewState, response: Record<string, unknown>): void {
  const thread = asRecord(response.thread ?? response);
  const turns = asArray(thread.turns);
  const entries: CodexEntry[] = [];
  for (const turnValue of turns) {
    const turn = asRecord(turnValue);
    for (const itemValue of asArray(turn.items)) {
      const entry = normalizeCodexItem(asRecord(itemValue));
      if (entry) entries.push(entry);
    }
  }
  if (entries.length) view.entries = deduplicateEntries(entries);
  view.loaded = true;
}

function deduplicateEntries(entries: CodexEntry[]): CodexEntry[] {
  const seen = new Map<string, CodexEntry>();
  for (const entry of entries) seen.set(entry.id, entry);
  return [...seen.values()];
}

function normalizeCodexItem(item: Record<string, unknown>): CodexEntry | null {
  if (!shouldShowCodexItemInTranscript(item)) return null;
  const type = stringValue(item.type);
  const id = stringValue(item.id, `${type || 'item'}-${Date.now()}-${Math.random()}`);
  if (type === 'userMessage') {
    return { id, type: 'user', text: contentText(item.content) };
  }
  if (type === 'agentMessage') {
    return { id, type: 'agent', text: stringValue(item.text), phase: stringValue(item.phase) };
  }
  if (type === 'commandExecution') {
    const commandValue = item.command ?? item.argv;
    const command = Array.isArray(commandValue)
      ? commandValue.map((part) => String(part)).join(' ')
      : stringValue(commandValue);
    return {
      id,
      type: 'command',
      text: command,
      command,
      output: stringValue(item.aggregatedOutput, stringValue(item.output)),
      status: stringValue(item.status),
    };
  }
  if (type === 'fileChange') {
    const changes = asArray(item.changes).map((change) => {
      const record = asRecord(change);
      return stringValue(record.path, stringValue(record.filePath, JSON.stringify(record)));
    }).filter(Boolean);
    return {
      id,
      type: 'file',
      text: changes.join(', ') || stringValue(item.path, 'Workspace files'),
      output: changes.length ? changes.join('\n') : '',
      status: stringValue(item.status, 'updated'),
    };
  }
  if (type === 'enteredReviewMode') {
    return { id, type: 'system', text: `Review started: ${stringValue(item.review, 'current changes')}` };
  }
  if (type === 'exitedReviewMode') {
    return { id, type: 'review', text: stringValue(item.review, 'Review completed.') };
  }
  if (type === 'plan') {
    return { id, type: 'agent', text: stringValue(item.text), phase: 'plan' };
  }
  if (type === 'error') {
    return { id, type: 'system', text: stringValue(item.message, 'Codex reported an error.') };
  }
  return null;
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  return asArray(value).map((part) => {
    const record = asRecord(part);
    return stringValue(record.text, stringValue(record.content));
  }).filter(Boolean).join('\n');
}

function findThreadId(event: CodexEventEnvelope): string | null {
  const direct = stringValue(event.params.threadId);
  if (direct) return direct;
  const thread = asRecord(event.params.thread);
  const threadId = stringValue(thread.id);
  if (threadId) return threadId;
  const workspace = currentWorkspace();
  if (workspace?.distro === event.distro) return ui.activeThread.get(workspace.id) ?? null;
  return null;
}

function upsertEntry(view: ThreadViewState, entry: CodexEntry): CodexEntry {
  const existing = view.entries.find((candidate) => candidate.id === entry.id);
  if (existing) {
    Object.assign(existing, entry);
    return existing;
  }
  view.entries.push(entry);
  return entry;
}

function reconcileUserEntry(view: ThreadViewState, entry: CodexEntry): CodexEntry {
  for (let index = view.entries.length - 1; index >= 0; index -= 1) {
    const candidate = view.entries[index];
    if (candidate.id.startsWith('local-user-') && candidate.type === 'user' && candidate.text === entry.text) {
      Object.assign(candidate, entry);
      return candidate;
    }
  }
  return upsertEntry(view, entry);
}

function handleCodexEvent(event: CodexEventEnvelope): void {
  const method = event.method;
  if (method === 'account/rateLimits/updated') {
    const limits = rateLimitsFromNotification(event.params);
    if (limits) ui.rateLimits.set(event.distro, limits);
    renderAll({ preserveFocus: true });
    return;
  }
  if (method === 'thread/settings/updated') {
    const threadId = stringValue(event.params.threadId);
    const settings = asRecord(event.params.threadSettings);
    const knownWorkspaceId = ui.codexPreferences.workspaceIdForThread(threadId);
    const workspace = (ui.data?.workspaces ?? []).find((candidate) =>
      candidate.distro === event.distro
      && (knownWorkspaceId
        ? candidate.id === knownWorkspaceId
        : ui.activeThread.get(candidate.id) === threadId
          || (ui.threadLists.get(candidate.id) ?? []).some((thread) => thread.id === threadId)));
    if (threadId && workspace) {
      rememberThreadModelPreference(workspace, threadId, {
        model: settings.model,
        effort: settings.effort,
      });
    }
    renderAll({ preserveFocus: true });
    return;
  }
  if (!shouldShowCodexNotificationInTranscript(method)) return;
  const threadId = findThreadId(event);

  if (method === 'thread/started') {
    const thread = asRecord(event.params.thread);
    const id = stringValue(thread.id);
    if (id) {
      const workspace = (ui.data?.workspaces ?? []).find((candidate) => candidate.distro === event.distro && (!thread.cwd || candidate.root === thread.cwd))
        ?? currentWorkspace();
      if (workspace) {
        const list = ui.threadLists.get(workspace.id) ?? [];
        if (!list.some((candidate) => candidate.id === id)) list.unshift(thread as CodexThreadSummary);
        ui.threadLists.set(workspace.id, list);
      }
    }
    renderAll({ preserveFocus: true });
    return;
  }

  if (method === 'thread/archived') {
    const archivedId = stringValue(event.params.threadId, stringValue(asRecord(event.params.thread).id));
    for (const [workspaceId, list] of ui.threadLists) {
      ui.threadLists.set(workspaceId, list.filter((thread) => thread.id !== archivedId));
      if (ui.activeThread.get(workspaceId) === archivedId) ui.activeThread.delete(workspaceId);
    }
    ui.codexPreferences.deleteThread(archivedId);
    renderAll({ preserveFocus: true });
    return;
  }

  if (method === 'serverRequest/resolved') {
    const requestId = String(event.params.requestId ?? event.params.id ?? '');
    if (requestId) ui.approvals.delete(requestId);
    scheduleStreamRender(false);
    return;
  }

  if (!threadId) return;
  const view = threadView(threadId);

  if (method === 'turn/started') {
    const turn = asRecord(event.params.turn);
    view.activeTurnId = stringValue(turn.id, stringValue(event.params.turnId));
    view.turnStatus = stringValue(turn.status, 'inProgress');
    view.diff = '';
    view.plan = [];
  } else if (method === 'turn/completed') {
    const turn = asRecord(event.params.turn);
    view.turnStatus = stringValue(turn.status, 'completed');
    view.activeTurnId = null;
    const error = asRecord(turn.error);
    if (stringValue(error.message)) {
      upsertEntry(view, { id: `turn-error-${stringValue(turn.id, Date.now().toString())}`, type: 'system', text: stringValue(error.message) });
    }
    void refreshGitForThread(threadId);
  } else if (method === 'turn/diff/updated') {
    view.diff = stringValue(event.params.diff);
  } else if (method === 'turn/plan/updated') {
    view.planExplanation = stringValue(event.params.explanation);
    view.plan = asArray(event.params.plan).map((candidate) => {
      const step = asRecord(candidate);
      return { step: stringValue(step.step), status: stringValue(step.status, 'pending') };
    }).filter((step) => step.step);
  } else if (method === 'item/started' || method === 'item/completed') {
    const item = asRecord(event.params.item);
    const normalized = normalizeCodexItem(item);
    if (normalized) {
      if (normalized.type === 'user') reconcileUserEntry(view, normalized);
      else upsertEntry(view, normalized);
    }
  } else if (method === 'item/agentMessage/delta') {
    const itemId = stringValue(event.params.itemId, `agent-${view.activeTurnId ?? Date.now()}`);
    const entry = view.entries.find((candidate) => candidate.id === itemId)
      ?? upsertEntry(view, { id: itemId, type: 'agent', text: '' });
    entry.text += stringValue(event.params.delta);
  } else if (method === 'item/commandExecution/outputDelta') {
    const itemId = stringValue(event.params.itemId, `command-${view.activeTurnId ?? Date.now()}`);
    const entry = view.entries.find((candidate) => candidate.id === itemId)
      ?? upsertEntry(view, { id: itemId, type: 'command', text: 'Command', command: 'Command', output: '' });
    entry.output = `${entry.output ?? ''}${stringValue(event.params.delta)}`;
  } else if (method === 'warning' || method === 'configWarning') {
    upsertEntry(view, {
      id: `warning-${Date.now()}-${Math.random()}`,
      type: 'system',
      text: stringValue(event.params.message, stringValue(event.params.summary, 'Codex warning.')),
    });
  } else if (method === 'error') {
    const error = asRecord(event.params.error);
    upsertEntry(view, {
      id: `error-${Date.now()}-${Math.random()}`,
      type: 'system',
      text: stringValue(error.message, 'Codex reported an error.'),
    });
  }

  scheduleStreamRender(true);
}

async function refreshGitForThread(threadId: string): Promise<void> {
  const workspace = (ui.data?.workspaces ?? []).find((candidate) => ui.activeThread.get(candidate.id) === threadId);
  if (workspace) await refreshGit(workspace);
}

function handleCodexServerRequest(request: CodexServerRequestEnvelope): void {
  ui.approvals.set(String(request.id), request);
  if (ui.activeTab === 'codex') scheduleStreamRender(true);
  toast('Codex is waiting for your approval.', 'error');
}

function handleCodexStatus(status: CodexConnectionStatus): void {
  ui.codexStatus.set(status.distro, status);
  renderAll({ preserveFocus: true });
}

function handleTerminalData(event: { handle: string; data: string }): void {
  const terminal = ui.terminals.get(event.handle);
  if (!terminal) {
    ui.orphanTerminalData.set(event.handle, `${ui.orphanTerminalData.get(event.handle) ?? ''}${event.data}`);
    return;
  }
  terminal.buffer.append(event.data);
  updateTerminalOutput();
}

function handleTerminalExit(event: { handle: string; exitCode: number | null }): void {
  const terminal = ui.terminals.get(event.handle);
  if (!terminal) return;
  terminal.exited = true;
  terminal.buffer.append(`\r\n[process exited with code ${event.exitCode ?? 'unknown'}]\r\n`);
  renderMainArea(true);
}

appElement.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const actionElement = target.closest<HTMLElement>('[data-action]');
  if (!actionElement) return;
  event.preventDefault();
  void executeAction(actionElement.dataset.action ?? '', actionElement);
});

overlayRoot.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const actionElement = target.closest<HTMLElement>('[data-action]');
  if (!actionElement) return;
  const actionName = actionElement.dataset.action ?? '';
  if ((actionName === 'close-modal-backdrop' || actionName === 'close-palette-backdrop') && event.target !== actionElement) return;
  event.preventDefault();
  void executeAction(actionName, actionElement);
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement && target.id === 'codex-composer') {
    const workspace = currentWorkspace();
    const threadId = workspace ? ui.activeThread.get(workspace.id) : null;
    if (threadId) ui.composerText.set(threadId, target.value);
    const submit = document.querySelector<HTMLButtonElement>('#codex-form button[type="submit"]');
    if (submit) submit.disabled = !target.value.trim() || ui.busyActions.has('codex-turn');
  }
  if (target instanceof HTMLInputElement && target.id === 'palette-input') {
    ui.paletteQuery = target.value;
    ui.paletteIndex = 0;
    const focus = captureFocus();
    renderOverlay();
    restoreFocus(focus);
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const setting = target.dataset.codexSetting;
  const workspace = currentWorkspace();
  if (workspace && (setting === 'model' || setting === 'effort')) {
    void saveCodexSetting(workspace, setting, target.value);
  }
});

document.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === 'codex-form') void sendCodexTurn();
  if (form.id === 'terminal-form') void sendTerminalCommand();
  if (form.id === 'workspace-form') void submitWorkspaceForm();
  if (form.id === 'settings-form') void submitSettingsForm();
  if (form.id === 'context-form') void submitContextForm();
  if (form.id === 'project-task-form') void submitProjectTask();
});

document.addEventListener('keydown', (event) => {
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  if (ctrlOrMeta && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    ui.paletteOpen = true;
    ui.paletteQuery = '';
    ui.paletteIndex = 0;
    renderOverlay();
    return;
  }
  if (event.key === 'Escape') {
    if (ui.paletteOpen || ui.modal) {
      event.preventDefault();
      ui.paletteOpen = false;
      ui.modal = null;
      renderOverlay();
    }
    return;
  }
  if (ui.paletteOpen) {
    const actions = filteredPaletteActions();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      ui.paletteIndex = Math.min(actions.length - 1, ui.paletteIndex + 1);
      renderOverlay();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      ui.paletteIndex = Math.max(0, ui.paletteIndex - 1);
      renderOverlay();
    } else if (event.key === 'Enter' && actions[ui.paletteIndex]) {
      event.preventDefault();
      void executePaletteAction(actions[ui.paletteIndex].id);
    }
    return;
  }
  if (ctrlOrMeta && event.key === 'Enter' && document.activeElement?.id === 'codex-composer') {
    event.preventDefault();
    void sendCodexTurn();
  }
  if (event.ctrlKey && event.key.toLowerCase() === 'c' && document.activeElement?.id === 'terminal-input') {
    const selection = window.getSelection()?.toString();
    if (!selection) {
      event.preventDefault();
      void sendRawTerminalInput('\u0003');
    }
  }
});

window.addEventListener('resize', () => {
  if (terminalResizeTimer !== undefined) window.clearTimeout(terminalResizeTimer);
  terminalResizeTimer = window.setTimeout(() => void resizeActiveTerminal(), 180);
});

window.addEventListener('beforeunload', () => {
  for (const dispose of disposers) dispose();
});

async function executeAction(actionName: string, element: HTMLElement): Promise<void> {
  const workspace = currentWorkspace();
  switch (actionName) {
    case 'open-palette':
      ui.paletteOpen = true;
      ui.paletteQuery = '';
      ui.paletteIndex = 0;
      renderOverlay();
      break;
    case 'close-palette-backdrop':
    case 'close-modal-backdrop':
    case 'close-modal':
      ui.paletteOpen = false;
      ui.modal = null;
      renderOverlay();
      break;
    case 'new-workspace':
      ui.modal = { kind: 'workspace' };
      renderOverlay();
      break;
    case 'edit-workspace':
      ui.modal = { kind: 'workspace', workspaceId: element.dataset.workspaceId };
      renderOverlay();
      break;
    case 'select-workspace':
      if (element.dataset.workspaceId) await selectWorkspace(element.dataset.workspaceId);
      break;
    case 'settings':
      ui.modal = { kind: 'settings' };
      renderOverlay();
      break;
    case 'set-tab':
      if (element.dataset.tab) await setTab(element.dataset.tab as MainTab);
      break;
    case 'refresh-workspace':
      if (workspace) {
        await Promise.all([
          refreshGit(workspace),
          ensureProjectSystem(workspace, true, true),
          ensureCodexMetadata(workspace, true),
          ui.threadLists.has(workspace.id) ? ensureThreads(workspace, true) : Promise.resolve(),
        ]);
      }
      break;
    case 'refresh-project':
      if (workspace) await ensureProjectSystem(workspace, true, true);
      break;
    case 'initialize-project':
      if (workspace) await initializeProject(workspace);
      break;
    case 'offer-project-task':
      if (workspace && element.dataset.taskId) await offerProjectTask(workspace, element.dataset.taskId);
      break;
    case 'refresh-codex-metadata':
      if (workspace) await ensureCodexMetadata(workspace, true);
      break;
    case 'open-intellij':
      if (workspace) resultToast(await withBusy('open-intellij', () => api.system.openInIntelliJ(workspace.id)));
      break;
    case 'open-explorer':
      if (workspace) resultToast(await withBusy('open-explorer', () => api.system.openInExplorer(workspace.id)));
      break;
    case 'start-codex':
      if (workspace) await openCodex(workspace);
      break;
    case 'new-terminal':
      if (workspace) await createTerminal(workspace);
      break;
    case 'select-terminal':
      if (workspace && element.dataset.terminalHandle) {
        ui.activeTerminal.set(workspace.id, element.dataset.terminalHandle);
        renderMainArea(true);
      }
      break;
    case 'close-terminal':
      if (workspace && element.dataset.terminalHandle) await closeTerminal(workspace, element.dataset.terminalHandle);
      break;
    case 'clear-terminal': {
      const terminal = activeTerminalForWorkspace(workspace);
      if (terminal) {
        terminal.buffer.clear();
        updateTerminalOutput();
      }
      break;
    }
    case 'run-command':
      if (workspace && element.dataset.commandId) await runWorkspaceQuickCommand(workspace, element.dataset.commandId);
      break;
    case 'copy-context':
      if (workspace) await copyContext(workspace);
      break;
    case 'save-context':
      if (workspace) resultToast(await withBusy('save-context', () => api.context.save(workspace.id)));
      break;
    case 'preview-context':
      if (workspace) await previewContext(workspace);
      break;
    case 'copy-context-from-preview':
      if (workspace) {
        await copyContext(workspace);
        ui.modal = null;
        renderOverlay();
      }
      break;
    case 'add-context-file':
      if (workspace) await addContextFile(workspace);
      break;
    case 'add-context-note':
      ui.modal = { kind: 'context', contextType: 'note' };
      renderOverlay();
      break;
    case 'add-context-url':
      ui.modal = { kind: 'context', contextType: 'url' };
      renderOverlay();
      break;
    case 'remove-context':
      if (workspace && element.dataset.contextId) await removeContext(workspace, element.dataset.contextId);
      break;
    case 'toggle-context-content':
      if (workspace && element.dataset.contextId) await toggleContextContent(workspace, element.dataset.contextId);
      break;
    case 'choose-workspace-icon':
      chooseWorkspaceIcon(element.dataset.icon as WorkspaceIcon);
      break;
    case 'submit-workspace':
      await submitWorkspaceForm();
      break;
    case 'delete-workspace-prompt':
      if (element.dataset.workspaceId) {
        ui.modal = { kind: 'delete', workspaceId: element.dataset.workspaceId };
        renderOverlay();
      }
      break;
    case 'confirm-delete-workspace':
      if (element.dataset.workspaceId) await deleteWorkspace(element.dataset.workspaceId);
      break;
    case 'submit-settings':
      await submitSettingsForm();
      break;
    case 'inspect-system':
      await inspectSystemNow();
      break;
    case 'submit-context':
      await submitContextForm();
      break;
    case 'refresh-threads':
      if (workspace) await ensureThreads(workspace, true);
      break;
    case 'new-thread':
      if (workspace) await startNewThread(workspace);
      break;
    case 'select-thread':
      if (workspace && element.dataset.threadId) {
        if (element.dataset.goCodex === 'true') ui.activeTab = 'codex';
        await loadThread(workspace, element.dataset.threadId);
        renderAll({ preserveFocus: true });
      }
      break;
    case 'interrupt-turn':
      if (workspace) await interruptActiveTurn(workspace);
      break;
    case 'review-thread':
      if (workspace) await reviewActiveThread(workspace);
      break;
    case 'archive-thread':
      if (workspace) await archiveActiveThread(workspace);
      break;
    case 'respond-approval':
      if (workspace && element.dataset.requestId && element.dataset.decision) {
        await respondApproval(workspace, element.dataset.requestId, element.dataset.decision);
      }
      break;
    case 'palette-result':
      if (element.dataset.paletteId) await executePaletteAction(element.dataset.paletteId);
      break;
  }
}

async function selectWorkspace(workspaceId: string): Promise<void> {
  ui.data = await api.state.selectWorkspace(workspaceId);
  renderAll();
  const workspace = currentWorkspace();
  if (workspace) {
    void refreshGit(workspace);
    void ensureProjectSystem(workspace);
    void ensureCodexMetadata(workspace);
    if (ui.activeTab === 'codex') void ensureThreads(workspace);
  }
}

async function setTab(tab: MainTab): Promise<void> {
  ui.activeTab = tab;
  renderAll({ preserveFocus: true });
  const workspace = currentWorkspace();
  if (workspace && tab === 'codex') await Promise.all([ensureCodexMetadata(workspace), ensureThreads(workspace)]);
  if (tab === 'terminal') window.setTimeout(() => document.querySelector<HTMLInputElement>('#terminal-input')?.focus(), 0);
}

async function openCodex(workspace: Workspace): Promise<void> {
  ui.activeTab = 'codex';
  renderAll();
  await Promise.all([ensureCodexMetadata(workspace), ensureThreads(workspace)]);
}

async function createTerminal(workspace: Workspace): Promise<TerminalViewState | null> {
  const result = await withBusy('new-terminal', () => api.terminal.create(workspace.id));
  if (!result) return null;
  const terminal: TerminalViewState = {
    info: result,
    workspaceId: workspace.id,
    buffer: new TerminalBuffer(),
    exited: false,
  };
  const orphan = ui.orphanTerminalData.get(result.handle);
  if (orphan) {
    terminal.buffer.append(orphan);
    ui.orphanTerminalData.delete(result.handle);
  }
  ui.terminals.set(result.handle, terminal);
  ui.activeTerminal.set(workspace.id, result.handle);
  ui.activeTab = 'terminal';
  renderAll();
  window.setTimeout(() => {
    updateTerminalOutput();
    document.querySelector<HTMLInputElement>('#terminal-input')?.focus();
    void resizeActiveTerminal();
  }, 0);
  return terminal;
}

function activeTerminalForWorkspace(workspace: Workspace | null): TerminalViewState | null {
  if (!workspace) return null;
  const handle = ui.activeTerminal.get(workspace.id);
  return handle ? ui.terminals.get(handle) ?? null : null;
}

async function closeTerminal(workspace: Workspace, handle: string): Promise<void> {
  const terminal = ui.terminals.get(handle);
  if (terminal && !terminal.exited) resultToast(await api.terminal.close(workspace.id, handle));
  ui.terminals.delete(handle);
  const remaining = [...ui.terminals.values()].filter((candidate) => candidate.workspaceId === workspace.id);
  ui.activeTerminal.set(workspace.id, remaining.at(-1)?.info.handle ?? '');
  if (!remaining.length) ui.activeTerminal.delete(workspace.id);
  renderMainArea(true);
}

async function runWorkspaceQuickCommand(workspace: Workspace, commandId: string): Promise<void> {
  const command = workspace.commands.find((candidate) => candidate.id === commandId);
  if (!command) return;
  const terminal = await createTerminal(workspace);
  if (!terminal) return;
  await api.terminal.write(workspace.id, terminal.info.handle, `${command.command}\n`);
}

async function sendTerminalCommand(): Promise<void> {
  const workspace = currentWorkspace();
  const terminal = activeTerminalForWorkspace(workspace);
  const input = document.querySelector<HTMLInputElement>('#terminal-input');
  if (!workspace || !terminal || !input || !input.value.trim()) return;
  const command = input.value;
  input.value = '';
  const result = await api.terminal.write(workspace.id, terminal.info.handle, `${command}\n`);
  if (!result.ok) resultToast(result);
}

async function sendRawTerminalInput(data: string): Promise<void> {
  const workspace = currentWorkspace();
  const terminal = activeTerminalForWorkspace(workspace);
  if (!workspace || !terminal) return;
  await api.terminal.write(workspace.id, terminal.info.handle, data);
}

async function resizeActiveTerminal(): Promise<void> {
  const workspace = currentWorkspace();
  const terminal = activeTerminalForWorkspace(workspace);
  const surface = document.querySelector<HTMLElement>('.terminal-surface');
  if (!workspace || !terminal || !surface || terminal.exited) return;
  const cols = Math.max(40, Math.floor((surface.clientWidth - 40) / 7.2));
  const rows = Math.max(12, Math.floor((surface.clientHeight - 80) / 19));
  await api.terminal.resize(workspace.id, terminal.info.handle, cols, rows);
}

async function copyContext(workspace: Workspace): Promise<void> {
  const result = await withBusy('copy-context', () => api.context.copy(workspace.id));
  if (result) toast(`Context copied: ${result.includedFiles} file${result.includedFiles === 1 ? '' : 's'}, ${workspace.contextItems.length} item${workspace.contextItems.length === 1 ? '' : 's'}.`);
}

async function previewContext(workspace: Workspace): Promise<void> {
  const result = await withBusy('preview-context', () => api.context.build(workspace.id));
  if (!result) return;
  ui.modal = { kind: 'preview', result };
  renderOverlay();
}

async function addContextFile(workspace: Workspace): Promise<void> {
  try {
    const filePath = await api.system.chooseContextFile(workspace.id);
    if (!filePath) return;
    ui.data = await api.state.addContextItem(workspace.id, {
      type: 'file',
      label: basename(filePath),
      value: filePath,
      includeContent: true,
    });
    renderAll({ preserveFocus: true });
    toast(`${basename(filePath)} added to context.`);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function removeContext(workspace: Workspace, itemId: string): Promise<void> {
  try {
    ui.data = await api.state.removeContextItem(workspace.id, itemId);
    renderAll({ preserveFocus: true });
    toast('Context item removed.');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function toggleContextContent(workspace: Workspace, itemId: string): Promise<void> {
  const contextItems = workspace.contextItems.map((item) => item.id === itemId ? { ...item, includeContent: !item.includeContent } : item);
  try {
    ui.data = await api.state.saveWorkspace({ ...workspace, contextItems });
    renderAll({ preserveFocus: true });
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

function chooseWorkspaceIcon(workspaceIcon: WorkspaceIcon): void {
  const input = document.querySelector<HTMLInputElement>('#workspace-icon-value');
  if (input) input.value = workspaceIcon;
  for (const choice of document.querySelectorAll<HTMLElement>('.icon-choice')) {
    choice.classList.toggle('is-active', choice.dataset.icon === workspaceIcon);
  }
}

function parseCommands(value: string, existing: WorkspaceCommand[] = []): WorkspaceCommand[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name = '', command = '', description = ''] = line.split('::').map((part) => part.trim());
    const matched = existing.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    return {
      id: matched?.id ?? globalThis.crypto.randomUUID(),
      name,
      command,
      description,
    };
  }).filter((command) => command.name && command.command);
}

async function submitWorkspaceForm(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('#workspace-form');
  if (!form || !form.reportValidity()) return;
  const data = new FormData(form);
  const workspaceId = String(data.get('workspaceId') ?? '') || undefined;
  const existing = workspaceId ? ui.data?.workspaces.find((workspace) => workspace.id === workspaceId) : undefined;
  const draft: WorkspaceDraft = {
    id: workspaceId,
    name: String(data.get('name') ?? ''),
    description: String(data.get('description') ?? ''),
    icon: String(data.get('icon') ?? 'folder') as WorkspaceIcon,
    distro: String(data.get('distro') ?? ''),
    root: String(data.get('root') ?? ''),
    commands: parseCommands(String(data.get('commands') ?? ''), existing?.commands),
    contextItems: existing?.contextItems ?? [],
  };
  const initializeProject = !existing && data.get('initializeProject') === 'on';
  const result = await withBusy('save-workspace', () => api.state.saveWorkspace(draft));
  if (!result) return;
  ui.data = result;
  ui.modal = null;
  renderAll();
  const workspace = currentWorkspace();
  if (workspace) {
    void refreshGit(workspace);
    void ensureCodexMetadata(workspace);
    if (initializeProject) {
      try {
        ui.projectSystems.set(workspace.id, await api.project.initialize(workspace.id));
        renderAll({ preserveFocus: true });
        toast('Workspace and project files created.');
        return;
      } catch (error) {
        toast(`Workspace created, but project setup failed: ${errorMessage(error)}`, 'error');
        return;
      }
    }
    void ensureProjectSystem(workspace);
  }
  toast(existing ? 'Workspace updated.' : 'Workspace created.');
}

async function deleteWorkspace(workspaceId: string): Promise<void> {
  try {
    ui.data = await api.state.deleteWorkspace(workspaceId);
    ui.git.delete(workspaceId);
    ui.projectSystems.delete(workspaceId);
    for (const thread of ui.threadLists.get(workspaceId) ?? []) {
      ui.codexPreferences.deleteThread(thread.id);
    }
    ui.threadLists.delete(workspaceId);
    ui.activeThread.delete(workspaceId);
    ui.codexPreferences.deleteWorkspace(workspaceId);
    for (const [handle, terminal] of ui.terminals) {
      if (terminal.workspaceId === workspaceId) ui.terminals.delete(handle);
    }
    ui.modal = null;
    renderAll();
    const workspace = currentWorkspace();
    if (workspace) void refreshGit(workspace);
    toast('Workspace removed.');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function submitSettingsForm(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('#settings-form');
  if (!form || !form.reportValidity() || !ui.data) return;
  const data = new FormData(form);
  const result = await withBusy('save-settings', () => api.state.saveSettings({
    intellijPath: String(data.get('intellijPath') ?? ''),
    approvalPolicy: String(data.get('approvalPolicy') ?? 'onRequest') as PersistedState['settings']['approvalPolicy'],
    networkAccess: data.get('networkAccess') === 'on',
    maxContextFileBytes: Number(data.get('maxContextFileBytes') ?? 120_000),
  }));
  if (!result) return;
  ui.data = result;
  ui.modal = null;
  renderAll();
  toast('Settings saved.');
}

async function inspectSystemNow(): Promise<void> {
  const result = await withBusy('inspect-system', () => api.system.inspect());
  if (!result) return;
  ui.system = result;
  renderAll({ preserveFocus: true });
  toast(result.wslAvailable || result.platform !== 'win32' ? 'Environment inspected.' : 'WSL was not detected.', result.wslAvailable || result.platform !== 'win32' ? 'success' : 'error');
}

async function submitContextForm(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('#context-form');
  const workspace = currentWorkspace();
  if (!form || !workspace || !form.reportValidity()) return;
  const data = new FormData(form);
  const contextType = String(data.get('contextType')) as 'note' | 'url';
  const value = String(data.get('value') ?? '').trim();
  try {
    ui.data = await api.state.addContextItem(workspace.id, {
      type: contextType,
      label: String(data.get('label') ?? '').trim(),
      value,
      includeContent: true,
    });
    ui.modal = null;
    renderAll();
    toast(`${contextType === 'note' ? 'Note' : 'Link'} added to context.`);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function startNewThread(workspace: Workspace): Promise<void> {
  const preference = sessionModelPreference(workspace, null);
  const result = await withBusy('new-thread', async () => {
    await api.codex.connect(workspace.id);
    return api.codex.startThread(workspace.id, preference);
  });
  if (!result) return;
  const thread = asRecord(result.thread ?? result);
  const threadId = stringValue(thread.id);
  if (!threadId) {
    toast('Codex did not return a thread id.', 'error');
    return;
  }
  const summary = thread as CodexThreadSummary;
  const list = ui.threadLists.get(workspace.id) ?? [];
  ui.threadLists.set(workspace.id, [summary, ...list.filter((candidate) => candidate.id !== threadId)]);
  ui.activeThread.set(workspace.id, threadId);
  rememberThreadModelPreference(workspace, threadId, result, preference);
  threadView(threadId).loaded = true;
  ui.activeTab = 'codex';
  renderAll();
  window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('#codex-composer')?.focus(), 0);
}

async function sendCodexTurn(): Promise<void> {
  const workspace = currentWorkspace();
  const threadId = workspace ? ui.activeThread.get(workspace.id) : null;
  if (!workspace || !threadId) return;
  const text = ui.composerText.get(threadId)?.trim() ?? document.querySelector<HTMLTextAreaElement>('#codex-composer')?.value.trim() ?? '';
  if (!text) return;
  const view = threadView(threadId);
  ui.composerText.set(threadId, '');
  const userEntry: CodexEntry = { id: `local-user-${Date.now()}`, type: 'user', text };
  view.entries.push(userEntry);
  view.turnStatus = 'inProgress';
  renderMainArea(false, true);
  const preference = sessionModelPreference(workspace, threadId);
  const result = await withBusy('codex-turn', () => api.codex.startTurn(workspace.id, threadId, text, preference));
  if (!result) {
    view.turnStatus = 'failed';
    view.entries.push({ id: `local-error-${Date.now()}`, type: 'system', text: 'The Codex turn could not be started.' });
    renderMainArea(false, true);
    return;
  }
  const turn = asRecord(result.turn ?? result);
  view.activeTurnId = stringValue(turn.id, view.activeTurnId ?? '');
  view.turnStatus = stringValue(turn.status, 'inProgress');
  renderMainArea(false, true);
}

async function interruptActiveTurn(workspace: Workspace): Promise<void> {
  const threadId = ui.activeThread.get(workspace.id);
  if (!threadId) return;
  const view = threadView(threadId);
  if (!view.activeTurnId) return;
  resultToast(await withBusy('interrupt-turn', () => api.codex.interruptTurn(workspace.id, threadId, view.activeTurnId!)));
}

async function reviewActiveThread(workspace: Workspace): Promise<void> {
  const threadId = ui.activeThread.get(workspace.id);
  if (!threadId) return;
  const result = await withBusy('review-thread', () => api.codex.reviewUncommitted(workspace.id, threadId));
  if (!result) return;
  const turn = asRecord(result.turn);
  const view = threadView(threadId);
  view.activeTurnId = stringValue(turn.id, view.activeTurnId ?? '');
  view.turnStatus = stringValue(turn.status, 'inProgress');
  renderMainArea(true, true);
}

async function archiveActiveThread(workspace: Workspace): Promise<void> {
  const threadId = ui.activeThread.get(workspace.id);
  if (!threadId) return;
  const result = await withBusy('archive-thread', () => api.codex.archiveThread(workspace.id, threadId));
  resultToast(result);
  if (!result?.ok) return;
  const list = (ui.threadLists.get(workspace.id) ?? []).filter((thread) => thread.id !== threadId);
  ui.threadLists.set(workspace.id, list);
  ui.activeThread.delete(workspace.id);
  if (list[0]) {
    ui.activeThread.set(workspace.id, list[0].id);
    void loadThread(workspace, list[0].id);
  }
  renderAll();
}

async function respondApproval(workspace: Workspace, requestId: string, decision: string): Promise<void> {
  const request = ui.approvals.get(requestId);
  if (!request) return;
  const result = await withBusy(`approval-${requestId}`, () => api.codex.respondToRequest(workspace.id, request.id, { decision }));
  resultToast(result);
  if (result?.ok) ui.approvals.delete(requestId);
  renderMainArea(true);
}

async function executePaletteAction(actionId: string): Promise<void> {
  ui.paletteOpen = false;
  ui.paletteQuery = '';
  renderOverlay();
  if (actionId.startsWith('workspace:')) {
    await selectWorkspace(actionId.slice('workspace:'.length));
    return;
  }
  if (actionId === 'global:new-workspace') {
    ui.modal = { kind: 'workspace' };
    renderOverlay();
    return;
  }
  if (actionId === 'global:settings') {
    ui.modal = { kind: 'settings' };
    renderOverlay();
    return;
  }
  const workspace = currentWorkspace();
  if (!workspace) return;
  if (actionId === 'action:codex') await openCodex(workspace);
  else if (actionId === 'action:terminal') await createTerminal(workspace);
  else if (actionId === 'action:intellij') resultToast(await api.system.openInIntelliJ(workspace.id));
  else if (actionId === 'action:context') await copyContext(workspace);
  else if (actionId.startsWith('command:')) await runWorkspaceQuickCommand(workspace, actionId.slice('command:'.length));
}

void loadInitialState().catch((error) => {
  appElement.innerHTML = `<div class="empty-state"><div class="empty-state-card"><div class="empty-state-icon">${icon('alert', 30)}</div><h2>Workbench could not start.</h2><p>${escapeHtml(errorMessage(error))}</p></div></div>`;
});
