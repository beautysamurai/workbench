import type {
  CodexConnectionStatus,
  CodexEventEnvelope,
  CodexModelPreference,
  CodexServerRequestEnvelope,
  ContextBuildResult,
  PersistedState,
  ProjectSystemStatus,
  ProjectTask,
  TerminalDataEnvelope,
  TerminalExitEnvelope,
  WorkbenchApi,
  Workspace,
  WorkspaceDraft,
} from '../shared/types.js';

function id(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

const now = new Date().toISOString();
const sampleWorkspaces: Workspace[] = [
  {
    id: 'curve-server',
    name: 'Curve Server',
    description: 'JPY curve generation, dependency graph, and pricing infrastructure.',
    icon: 'chart',
    distro: 'Ubuntu',
    root: '/home/kabes/projects/curve-server',
    commands: [
      { id: 'test', name: 'Run tests', command: './gradlew test', description: 'Run the complete Gradle test suite.' },
      { id: 'boot', name: 'Start service', command: './gradlew bootRun', description: 'Launch the Spring Boot service.' },
      { id: 'status', name: 'Git summary', command: 'git status --short', description: 'Show changed files.' },
    ],
    contextItems: [
      { id: 'readme', type: 'file', label: 'README.md', value: 'README.md', includeContent: true },
      { id: 'arch', type: 'file', label: 'Curve architecture', value: 'docs/curve-dependency.md', includeContent: true },
      { id: 'note', type: 'note', label: 'Design constraints', value: 'JPY dependencies are non-linear. Preserve compatibility with the shared regional implementation.', includeContent: true },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'rates-research',
    name: 'Rates Research',
    description: 'Papers, notebooks, curve-risk experiments, and market notes.',
    icon: 'book',
    distro: 'Ubuntu',
    root: '/home/kabes/research/rates',
    commands: [{ id: 'jupyter', name: 'Open Jupyter', command: 'jupyter lab', description: 'Start the research notebook server.' }],
    contextItems: [
      { id: 'ideas', type: 'note', label: 'Current question', value: 'Model RFQ skew using inventory and post-trade market response.', includeContent: true },
    ],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'spring-lab',
    name: 'Spring Lab',
    description: 'Spring Boot and AI integration experiments.',
    icon: 'code',
    distro: 'Ubuntu',
    root: '/home/kabes/projects/spring-lab',
    commands: [{ id: 'dev', name: 'Development server', command: './gradlew bootRun' }],
    contextItems: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'interview',
    name: 'Interview',
    description: 'CV, role notes, programming concepts, and mock questions.',
    icon: 'briefcase',
    distro: 'Ubuntu',
    root: '/home/kabes/career/interview',
    commands: [],
    contextItems: [],
    createdAt: now,
    updatedAt: now,
  },
];

let state: PersistedState = {
  version: 1,
  workspaces: sampleWorkspaces,
  selectedWorkspaceId: 'curve-server',
  settings: {
    intellijPath: '',
    approvalPolicy: 'onRequest',
    networkAccess: false,
    maxContextFileBytes: 120_000,
  },
};

const eventListeners = new Set<(event: CodexEventEnvelope) => void>();
const requestListeners = new Set<(event: CodexServerRequestEnvelope) => void>();
const statusListeners = new Set<(event: CodexConnectionStatus) => void>();
const terminalDataListeners = new Set<(event: TerminalDataEnvelope) => void>();
const terminalExitListeners = new Set<(event: TerminalExitEnvelope) => void>();
const projectTasks = new Map<string, ProjectTask[]>([
  ['curve-server', [
    { id: 'P0-101', title: 'Repair curve invalidation', state: 'in progress', priority: 'P0', objective: 'Fix the failing dependency-chain test.', parentId: null, acceptanceCriteria: ['Dependency-chain test passes'], attachments: [] },
    { id: 'P1-102', title: 'Profile allocation spike', state: 'pending', priority: 'P1', objective: 'Find avoidable pricing allocations.', parentId: 'P0-101', acceptanceCriteria: [], attachments: [] },
  ]],
]);
const mockThreadPreferences = new Map<string, CodexModelPreference>([
  ['thr-refactor', { model: 'gpt-5.6-terra', effort: 'medium' }],
  ['thr-tests', { model: 'gpt-5.6-sol', effort: 'high' }],
  ['thr-gc', { model: 'gpt-5.6-sol', effort: 'low' }],
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mockThreadPreference(threadId: string): CodexModelPreference {
  return clone(mockThreadPreferences.get(threadId) ?? { model: 'gpt-5.6-sol', effort: 'low' });
}

function saveWorkspace(draft: WorkspaceDraft): PersistedState {
  const existing = state.workspaces.find((workspace) => workspace.id === draft.id);
  const workspace: Workspace = {
    id: existing?.id ?? id(),
    name: draft.name,
    description: draft.description ?? '',
    icon: draft.icon ?? 'folder',
    distro: draft.distro,
    root: draft.root,
    commands: draft.commands ?? existing?.commands ?? [],
    contextItems: draft.contextItems ?? existing?.contextItems ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: new Date().toISOString(),
  };
  state.workspaces = existing
    ? state.workspaces.map((candidate) => candidate.id === existing.id ? workspace : candidate)
    : [workspace, ...state.workspaces];
  state.selectedWorkspaceId = workspace.id;
  return clone(state);
}

function contextResult(workspace: Workspace): ContextBuildResult {
  const fileItems = workspace.contextItems.filter((item) => item.type === 'file');
  const lines = [
    '# Workbench Context Pack',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Workspace',
    '',
    `- Name: ${workspace.name}`,
    `- Description: ${workspace.description}`,
    `- WSL distribution: ${workspace.distro}`,
    `- Root: ${workspace.root}`,
    '',
    '## Git',
    '',
    '- Branch: feature/curve-dependencies',
    '- Staged / changed / untracked: 0 / 3 / 1',
  ];
  for (const item of workspace.contextItems) {
    if (item.type === 'note') lines.push('', `## ${item.label}`, '', item.value);
    if (item.type === 'url') lines.push('', `- [${item.label}](${item.value})`);
    if (item.type === 'file') lines.push('', `## ${item.label}`, '', `Path: \`${item.value}\``, '', '```text', 'Preview content is available in the desktop application.', '```');
  }
  lines.push('', '## Request', '', '<Describe the task or question here.>');
  return { markdown: lines.join('\n'), includedFiles: fileItems.length, truncatedFiles: 0, warnings: [] };
}

function workspaceById(workspaceId: string): Workspace {
  const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) throw new Error('Workspace not found.');
  return workspace;
}

function mockProjectStatus(workspaceId: string): ProjectSystemStatus {
  const tasks = clone(projectTasks.get(workspaceId) ?? []);
  const maximum = tasks.reduce((current, task) => Math.max(current, Number(/-(\d+)$/.exec(task.id)?.[1] ?? 0)), 0);
  return {
    files: [
      { name: 'AGENTS.md', exists: true, safe: true },
      { name: 'TASKS.md', exists: true, safe: true },
      { name: 'WORKBENCH_PROGRESS.md', exists: true, safe: true },
    ],
    tasks,
    nextTaskId: `WB-${String(maximum + 1).padStart(3, '0')}`,
    ready: true,
  };
}

export function createMockApi(): WorkbenchApi {
  return {
    state: {
      get: async () => clone(state),
      saveWorkspace: async (draft) => saveWorkspace(draft),
      deleteWorkspace: async (workspaceId) => {
        state.workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
        if (state.selectedWorkspaceId === workspaceId) state.selectedWorkspaceId = state.workspaces[0]?.id ?? null;
        return clone(state);
      },
      selectWorkspace: async (workspaceId) => {
        state.selectedWorkspaceId = workspaceId;
        return clone(state);
      },
      saveSettings: async (settings) => {
        state.settings = clone(settings);
        return clone(state);
      },
      addContextItem: async (workspaceId, item) => {
        const workspace = workspaceById(workspaceId);
        workspace.contextItems.push({ ...clone(item), id: id() });
        return clone(state);
      },
      removeContextItem: async (workspaceId, itemId) => {
        const workspace = workspaceById(workspaceId);
        workspace.contextItems = workspace.contextItems.filter((item) => item.id !== itemId);
        return clone(state);
      },
    },
    project: {
      inspect: async (workspaceId) => mockProjectStatus(workspaceId),
      initialize: async (workspaceId) => mockProjectStatus(workspaceId),
      addTask: async (workspaceId, task) => {
        const tasks = projectTasks.get(workspaceId) ?? [];
        const maximum = tasks.reduce((current, candidate) => Math.max(current, Number(/-(\d+)$/.exec(candidate.id)?.[1] ?? 0)), 0);
        const taskId = `WB-${String(maximum + 1).padStart(3, '0')}`;
        tasks.push({
          id: taskId,
          title: task.title,
          objective: task.objective || task.title,
          state: 'pending',
          priority: task.priority,
          parentId: task.parentId || null,
          acceptanceCriteria: task.acceptanceCriteria ?? [],
          attachments: (task.images ?? []).map((image, index) => ({
            path: `.workbench/task-images/${taskId}-${String(index + 1).padStart(2, '0')}.${image.mediaType === 'image/jpeg' ? 'jpg' : image.mediaType.split('/')[1]}`,
            mediaType: image.mediaType,
          })),
        });
        projectTasks.set(workspaceId, tasks);
        return mockProjectStatus(workspaceId);
      },
    },
    system: {
      inspect: async () => ({
        platform: 'browser',
        wslAvailable: true,
        distributions: [{
          name: 'Ubuntu',
          isDefault: true,
          home: '/home/kabes',
          user: 'kabes',
          codexVersion: 'codex-cli 0.124.0',
        }],
        inspectedAt: new Date().toISOString(),
      }),
      gitStatus: async () => ({
        isRepository: true,
        branch: 'feature/curve-dependencies',
        upstream: 'origin/feature/curve-dependencies',
        ahead: 2,
        behind: 0,
        staged: 0,
        changed: 3,
        untracked: 1,
        clean: false,
        raw: '',
      }),
      openInIntelliJ: async () => ({ ok: true, message: 'Opening IntelliJ (preview).' }),
      openInExplorer: async () => ({ ok: true, message: 'Opening files (preview).' }),
      chooseContextFile: async () => 'src/main/java/com/example/CurveRepository.java',
    },
    context: {
      build: async (workspaceId) => contextResult(workspaceById(workspaceId)),
      copy: async (workspaceId) => contextResult(workspaceById(workspaceId)),
      save: async () => ({ ok: true, message: 'Context pack saved (preview).' }),
    },
    codex: {
      connect: async (workspaceId) => {
        const distro = workspaceById(workspaceId).distro;
        statusListeners.forEach((listener) => listener({ distro, state: 'connecting', message: 'Starting Codex…' }));
        setTimeout(() => statusListeners.forEach((listener) => listener({ distro, state: 'connected', message: 'Codex connected.' })), 450);
        return { ok: true, message: 'Codex connected.' };
      },
      listModels: async () => ({
        data: [
          { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', description: 'Highest capability', hidden: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'high', description: 'Thorough' }], isDefault: true },
          { id: 'gpt-5.6-terra', model: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', description: 'Balanced', hidden: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }, { reasoningEffort: 'high', description: 'Thorough' }], isDefault: false },
        ],
        nextCursor: null,
      }),
      getRateLimits: async () => ({
        rateLimits: { limitId: 'codex', limitName: null, primary: { usedPercent: 34, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3_600 }, secondary: null },
      }),
      listThreads: async () => ({
        data: [
          { id: 'thr-refactor', name: 'Refactor dependency graph', preview: 'Review the non-linear index dependency changes', cwd: '/home/kabes/projects/curve-server', updatedAt: Date.now() / 1000 },
          { id: 'thr-tests', name: 'Investigate failing tests', preview: 'Two integration tests fail after library replacement', cwd: '/home/kabes/projects/curve-server', updatedAt: Date.now() / 1000 - 3800 },
          { id: 'thr-gc', name: 'Allocation profile', preview: 'Find the source of the pricing allocation spike', cwd: '/home/kabes/projects/curve-server', updatedAt: Date.now() / 1000 - 84000 },
        ],
        nextCursor: null,
      }),
      startThread: async (_workspaceId, preference) => {
        const threadId = `thr-${id()}`;
        mockThreadPreferences.set(threadId, clone(preference));
        return {
          thread: { id: threadId, name: null, preview: '' },
          model: preference.model,
          reasoningEffort: preference.effort,
        };
      },
      resumeThread: async (_workspaceId, threadId) => {
        const preference = mockThreadPreference(threadId);
        return {
          thread: { id: threadId },
          model: preference.model,
          reasoningEffort: preference.effort,
        };
      },
      readThread: async (_workspaceId, threadId) => ({
        thread: {
          id: threadId,
          turns: [
            { items: [
              { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'Review the dependency graph refactor and run the tests.' }] },
              { id: 'a1', type: 'agentMessage', text: 'I inspected the graph construction and the invalidation path. The provider abstraction is sound, but one test still assumes a linear dependency chain.' },
              { id: 'c1', type: 'commandExecution', command: './gradlew test', status: 'completed', aggregatedOutput: '128 tests completed, 2 failed' },
            ] },
          ],
        },
      }),
      updateThreadSettings: async (workspaceId, threadId, preference) => {
        mockThreadPreferences.set(threadId, clone(preference));
        eventListeners.forEach((listener) => listener({
          distro: workspaceById(workspaceId).distro,
          method: 'thread/settings/updated',
          params: {
            threadId,
            threadSettings: { model: preference.model, effort: preference.effort },
          },
        }));
        return {};
      },
      startTurn: async (_workspaceId, threadId, text, preference) => {
        mockThreadPreferences.set(threadId, clone(preference));
        const turnId = `turn-${id()}`;
        eventListeners.forEach((listener) => listener({ distro: 'Ubuntu', method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress' } } }));
        eventListeners.forEach((listener) => listener({ distro: 'Ubuntu', method: 'item/started', params: { threadId, turnId, item: { id: `user-${id()}`, type: 'userMessage', content: [{ type: 'text', text }] } } }));
        const itemId = `agent-${id()}`;
        eventListeners.forEach((listener) => listener({ distro: 'Ubuntu', method: 'item/started', params: { threadId, turnId, item: { id: itemId, type: 'agentMessage', text: '' } } }));
        const chunks = ['I’ll inspect the current diff, ', 'trace the affected dependency paths, ', 'and run the focused tests before proposing a change.'];
        chunks.forEach((chunk, index) => setTimeout(() => {
          eventListeners.forEach((listener) => listener({ distro: 'Ubuntu', method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta: chunk } }));
          if (index === chunks.length - 1) {
            setTimeout(() => eventListeners.forEach((listener) => listener({ distro: 'Ubuntu', method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } })), 250);
          }
        }, 320 * (index + 1)));
        return { turn: { id: turnId, status: 'inProgress' } };
      },
      interruptTurn: async () => ({ ok: true, message: 'Interrupt requested.' }),
      reviewUncommitted: async () => ({ turn: { id: `review-${id()}`, status: 'inProgress' } }),
      archiveThread: async () => ({ ok: true, message: 'Thread archived.' }),
      respondToRequest: async () => ({ ok: true, message: 'Approval response sent.' }),
      onEvent: (callback) => { eventListeners.add(callback); return () => eventListeners.delete(callback); },
      onServerRequest: (callback) => { requestListeners.add(callback); return () => requestListeners.delete(callback); },
      onStatus: (callback) => { statusListeners.add(callback); return () => statusListeners.delete(callback); },
    },
    terminal: {
      create: async (workspaceId) => {
        const handle = `terminal-${id()}`;
        setTimeout(() => terminalDataListeners.forEach((listener) => listener({
          handle,
          data: `Welcome to Workbench · ${workspaceById(workspaceId).root}\r\n\u001b[38;5;114mkabes@wsl\u001b[0m $ `,
        })), 50);
        return { handle, mode: 'pty', title: workspaceById(workspaceId).name };
      },
      write: async (_workspaceId, handle, data) => {
        const command = data.replace(/[\r\n]+/g, '').trim();
        terminalDataListeners.forEach((listener) => listener({ handle, data }));
        setTimeout(() => {
          const output = command.includes('gradlew test')
            ? '> Task :test\r\n128 tests completed, 0 failed\r\nBUILD SUCCESSFUL in 4s\r\n'
            : command === 'git status --short'
              ? ' M src/main/java/com/example/CurveGraph.java\r\n?? docs/dependency-notes.md\r\n'
              : command ? `command executed: ${command}\r\n` : '';
          terminalDataListeners.forEach((listener) => listener({ handle, data: `${output}\u001b[38;5;114mkabes@wsl\u001b[0m $ ` }));
        }, 250);
        return { ok: true, message: 'Input sent.' };
      },
      resize: async () => ({ ok: true, message: 'Terminal resized.' }),
      close: async (_workspaceId, handle) => {
        terminalExitListeners.forEach((listener) => listener({ handle, exitCode: 0 }));
        return { ok: true, message: 'Terminal closed.' };
      },
      onData: (callback) => { terminalDataListeners.add(callback); return () => terminalDataListeners.delete(callback); },
      onExit: (callback) => { terminalExitListeners.add(callback); return () => terminalExitListeners.delete(callback); },
    },
  };
}
