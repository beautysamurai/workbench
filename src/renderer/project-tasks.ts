import type { ProjectTask, ProjectTaskImageDraft } from '../shared/types.js';

const MAX_TASK_IMAGES = 4;
const MAX_TASK_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;

export interface ProjectTaskTreeNode {
  task: ProjectTask;
  children: ProjectTaskTreeNode[];
  issue: string | null;
}

function structuralIssue(
  task: ProjectTask,
  counts: Map<string, number>,
  byId: Map<string, ProjectTask>,
): string | null {
  if ((counts.get(task.id) ?? 0) > 1) return 'Duplicate task id';
  const seen = new Set([task.id]);
  let parentId: string | null = task.parentId;
  while (parentId) {
    if (seen.has(parentId)) return 'Parent cycle detected';
    if (!byId.has(parentId)) return `Parent ${parentId} was not found`;
    if ((counts.get(parentId) ?? 0) > 1) return `Parent ${parentId} is ambiguous`;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return null;
}

export function buildProjectTaskTree(tasks: ProjectTask[]): ProjectTaskTreeNode[] {
  const counts = new Map<string, number>();
  const byId = new Map<string, ProjectTask>();
  for (const task of tasks) {
    counts.set(task.id, (counts.get(task.id) ?? 0) + 1);
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  const nodes = tasks.map((task) => ({
    task,
    children: [],
    issue: structuralIssue(task, counts, byId),
  } satisfies ProjectTaskTreeNode));
  const uniqueNode = new Map<string, ProjectTaskTreeNode>();
  for (const node of nodes) {
    if ((counts.get(node.task.id) ?? 0) === 1) uniqueNode.set(node.task.id, node);
  }
  const roots: ProjectTaskTreeNode[] = [];
  for (const node of nodes) {
    const parent = node.issue || !node.task.parentId ? null : uniqueNode.get(node.task.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function mergeProjectTaskImages<T extends Pick<ProjectTaskImageDraft, 'bytes'>>(
  current: T[],
  incoming: T[],
): T[] {
  const combined = [...current, ...incoming];
  if (combined.length > MAX_TASK_IMAGES) throw new Error(`Attach no more than ${MAX_TASK_IMAGES} task images.`);
  if (combined.reduce((total, image) => total + image.bytes.byteLength, 0) > MAX_TASK_IMAGE_TOTAL_BYTES) {
    throw new Error('Task images must total 12 MB or less.');
  }
  return combined;
}

export function removeSubmittedProjectTaskImages<T>(
  current: readonly T[],
  submitted: readonly T[],
): T[] {
  const submittedImages = new Set(submitted);
  return current.filter((image) => !submittedImages.has(image));
}
