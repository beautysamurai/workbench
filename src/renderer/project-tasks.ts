import type { ProjectTask } from '../shared/types.js';

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
