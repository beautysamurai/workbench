import { randomUUID } from 'node:crypto';
import type {
  ProjectSystemFile,
  ProjectSystemStatus,
  ProjectTask,
  ProjectTaskDraft,
  ProjectTaskState,
  Workspace,
} from '../shared/types';
import { shellQuote } from './path-utils';
import { runWslCommand } from './wsl';

const PROJECT_FILES = ['AGENTS.md', 'TASKS.md', 'WORKBENCH_PROGRESS.md'] as const;

const PROJECT_TEMPLATES: Record<(typeof PROJECT_FILES)[number], string> = {
  'AGENTS.md': `# Project agent guide

Read TASKS.md before starting work. Keep changes scoped, verify relevant checks, preserve unrelated work, and record meaningful outcomes in WORKBENCH_PROGRESS.md.
`,
  'TASKS.md': `# Project tasks

States: \`pending\` · \`in progress\` · \`blocked\` · \`done\`

## Queue

Add tasks from Workbench or as headings in this form:

### WB-001 — Example task

- **State:** pending
- **Objective:** Describe the desired outcome.
`,
  'WORKBENCH_PROGRESS.md': `# Project progress

Append concise evidence for completed work: date, task, files changed, checks run, remaining risks, and next action.
`,
};

function cleanSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function normalizeTaskState(value: string): ProjectTaskState {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'in progress' || normalized === 'blocked' || normalized === 'done') return normalized;
  return 'pending';
}

export function parseProjectTasks(markdown: string): ProjectTask[] {
  const heading = /^###\s+(.+?)\s+(?:—|-)\s+(.+)$/gm;
  const matches = [...markdown.matchAll(heading)];
  return matches.map((match, index) => {
    const blockStart = (match.index ?? 0) + match[0].length;
    const blockEnd = matches[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(blockStart, blockEnd);
    const state = /-\s+\*\*State:\*\*\s*([^\n]+)/i.exec(block)?.[1] ?? 'pending';
    const objective = /-\s+\*\*Objective:\*\*\s*([^\n]+)/i.exec(block)?.[1] ?? '';
    return {
      id: cleanSingleLine(match[1], 100),
      title: cleanSingleLine(match[2], 180),
      state: normalizeTaskState(state),
      objective: cleanSingleLine(objective, 500),
    };
  }).filter((task) => task.id && task.title);
}

export function formatProjectTask(task: ProjectTaskDraft, id = `WB-${randomUUID().slice(0, 8).toUpperCase()}`): string {
  const title = cleanSingleLine(task.title, 180);
  const objective = cleanSingleLine(task.objective, 500);
  if (!title) throw new Error('Enter a task title.');
  return `### ${id} — ${title}\n\n- **State:** pending\n- **Objective:** ${objective || title}\n`;
}

function rootSetup(workspace: Workspace): string[] {
  return [
    `root=${shellQuote(workspace.root)}`,
    'root_real=$(realpath -- "$root") || { printf "Workspace root not found" >&2; exit 2; }',
    'if [ ! -d "$root_real" ]; then printf "Workspace root is not a directory" >&2; exit 2; fi',
  ];
}

async function runProjectScript(workspace: Workspace, statements: string[]): Promise<string> {
  const result = await runWslCommand(workspace.distro, [...rootSetup(workspace), ...statements].join('; '), 30_000);
  if (result.code !== 0) {
    throw new Error(result.timedOut ? 'Project Markdown operation timed out.' : result.stderr.trim() || 'Project Markdown operation failed.');
  }
  return result.stdout;
}

async function inspectFiles(workspace: Workspace): Promise<ProjectSystemFile[]> {
  const statements = PROJECT_FILES.flatMap((name) => [
    `target="$root_real/${name}"`,
    `if [ ! -e "$target" ] && [ ! -L "$target" ]; then printf '${name}\\tmissing\\n'; else target_real=$(realpath -- "$target" 2>/dev/null || true); case "$target_real" in "$root_real"/*) printf '${name}\\tpresent\\n' ;; *) printf '${name}\\tunsafe\\n' ;; esac; fi`,
  ]);
  const output = await runProjectScript(workspace, statements);
  const states = new Map(output.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t', 2) as [string, string]));
  return PROJECT_FILES.map((name) => ({
    name,
    exists: states.get(name) !== 'missing',
    safe: states.get(name) !== 'unsafe',
  }));
}

async function readTasks(workspace: Workspace): Promise<string> {
  return runProjectScript(workspace, [
    'target="$root_real/TASKS.md"',
    'if [ ! -e "$target" ]; then exit 0; fi',
    'target_real=$(realpath -- "$target") || { printf "TASKS.md cannot be resolved" >&2; exit 3; }',
    'case "$target_real" in "$root_real"/*) ;; *) printf "TASKS.md resolves outside the workspace" >&2; exit 4 ;; esac',
    'cat -- "$target_real"',
  ]);
}

export async function inspectProjectSystem(workspace: Workspace): Promise<ProjectSystemStatus> {
  const files = await inspectFiles(workspace);
  const tasksFile = files.find((file) => file.name === 'TASKS.md');
  const tasks = tasksFile?.exists && tasksFile.safe ? parseProjectTasks(await readTasks(workspace)) : [];
  return { files, tasks, ready: files.every((file) => file.exists && file.safe) };
}

export async function initializeProjectSystem(workspace: Workspace): Promise<ProjectSystemStatus> {
  const statements: string[] = [];
  for (const name of PROJECT_FILES) {
    statements.push(
      `target="$root_real/${name}"`,
      'if [ -L "$target" ]; then target_real=$(realpath -- "$target" 2>/dev/null || true); case "$target_real" in "$root_real"/*) ;; *) printf "Refusing unsafe project-file symlink: %s" "$target" >&2; exit 4 ;; esac; fi',
      `if [ ! -e "$target" ]; then printf %s ${shellQuote(PROJECT_TEMPLATES[name])} > "$target"; fi`,
    );
  }
  await runProjectScript(workspace, statements);
  return inspectProjectSystem(workspace);
}

export async function addProjectTask(workspace: Workspace, draft: ProjectTaskDraft): Promise<ProjectSystemStatus> {
  await initializeProjectSystem(workspace);
  const task = formatProjectTask(draft);
  await runProjectScript(workspace, [
    'target="$root_real/TASKS.md"',
    'target_real=$(realpath -- "$target") || { printf "TASKS.md cannot be resolved" >&2; exit 3; }',
    'case "$target_real" in "$root_real"/*) ;; *) printf "TASKS.md resolves outside the workspace" >&2; exit 4 ;; esac',
    `printf '\\n%s\\n' ${shellQuote(task)} >> "$target_real"`,
  ]);
  return inspectProjectSystem(workspace);
}
