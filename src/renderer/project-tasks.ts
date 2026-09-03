import type { ProjectTask, ProjectTaskImageDraft } from '../shared/types.js';

const MAX_TASK_IMAGES = 4;
const MAX_TASK_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;

export interface ProjectTaskTreeNode {
  task: ProjectTask;
  children: ProjectTaskTreeNode[];
  issue: string | null;
  isTaskIdUnique: boolean;
}

function resolveStructuralIssues(
  counts: Map<string, number>,
  byId: Map<string, ProjectTask>,
): Map<string, string | null> {
  const resolved = new Map<string, string | null>();
  for (const [taskId, count] of counts) {
    if (count !== 1 || resolved.has(taskId)) continue;
    const path: string[] = [];
    const pathIds = new Set<string>();
    let currentId = taskId;
    let issue: string | null = null;
    while (true) {
      if (resolved.has(currentId)) {
        issue = resolved.get(currentId) ?? null;
        break;
      }
      if (pathIds.has(currentId)) {
        issue = 'Parent cycle detected';
        break;
      }
      pathIds.add(currentId);
      path.push(currentId);
      const parentId = byId.get(currentId)?.parentId ?? null;
      if (!parentId) break;
      const parentCount = counts.get(parentId) ?? 0;
      if (parentCount === 0) {
        issue = `Parent ${parentId} was not found`;
        break;
      }
      if (parentCount > 1) {
        issue = `Parent ${parentId} is ambiguous`;
        break;
      }
      currentId = parentId;
    }
    for (const resolvedId of path) resolved.set(resolvedId, issue);
  }
  return resolved;
}

export function buildProjectTaskTree(tasks: ProjectTask[]): ProjectTaskTreeNode[] {
  const counts = new Map<string, number>();
  const byId = new Map<string, ProjectTask>();
  for (const task of tasks) {
    counts.set(task.id, (counts.get(task.id) ?? 0) + 1);
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  const issues = resolveStructuralIssues(counts, byId);
  const nodes = tasks.map((task) => ({
    task,
    children: [],
    issue: (counts.get(task.id) ?? 0) > 1 ? 'Duplicate task id' : issues.get(task.id) ?? null,
    isTaskIdUnique: (counts.get(task.id) ?? 0) === 1,
  } satisfies ProjectTaskTreeNode));
  const uniqueNode = new Map<string, ProjectTaskTreeNode>();
  for (const node of nodes) {
    if ((counts.get(node.task.id) ?? 0) === 1) uniqueNode.set(node.task.id, node);
  }
  const roots: ProjectTaskTreeNode[] = [];
  for (const node of nodes) {
    const parentId = node.task.parentId;
    const parent = node.issue || !parentId ? null : uniqueNode.get(parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function canOfferProjectTask(node: ProjectTaskTreeNode): boolean {
  return node.isTaskIdUnique && node.issue === null && node.task.state !== 'done';
}

export function findOfferableProjectTask(tasks: ProjectTask[], taskId: string): ProjectTask | null {
  const matches = flattenProjectTaskTree(buildProjectTaskTree(tasks))
    .filter((node) => node.task.id === taskId);
  return matches.length === 1 && matches[0] && canOfferProjectTask(matches[0])
    ? matches[0].task
    : null;
}

export function flattenProjectTaskTree(nodes: readonly ProjectTaskTreeNode[]): ProjectTaskTreeNode[] {
  const flattened: ProjectTaskTreeNode[] = [];
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    flattened.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (child) stack.push(child);
    }
  }
  return flattened;
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

export function normalizeProjectTaskParentId(
  parentId: string,
  validParentIds: ReadonlySet<string>,
): string {
  return parentId && validParentIds.has(parentId) ? parentId : '';
}

interface ProjectTaskDraftFields {
  title: string;
  priority: string;
  parentId: string;
  objective: string;
  acceptanceCriteria: string;
}

export function projectTaskDraftMatches(
  current: ProjectTaskDraftFields,
  submitted: ProjectTaskDraftFields,
): boolean {
  return current.title === submitted.title
    && current.priority === submitted.priority
    && current.parentId === submitted.parentId
    && current.objective === submitted.objective
    && current.acceptanceCriteria === submitted.acceptanceCriteria;
}
