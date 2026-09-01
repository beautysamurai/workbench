import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectTask } from '../src/shared/types';
import {
  buildProjectTaskTree,
  canOfferProjectTask,
  findOfferableProjectTask,
  flattenProjectTaskTree,
  mergeProjectTaskImages,
  projectTaskDraftMatches,
  removeSubmittedProjectTaskImages,
} from '../src/renderer/project-tasks';

function task(id: string, parentId: string | null = null): ProjectTask {
  return {
    id, parentId, title: id, state: 'pending', priority: 'P2', objective: id,
    acceptanceCriteria: [], attachments: [],
  };
}

test('builds arbitrary-depth task structure while preserving sibling order', () => {
  const tree = buildProjectTaskTree([
    task('WB-001'), task('WB-002', 'WB-001'), task('WB-003', 'WB-002'), task('WB-004', 'WB-001'),
  ]);
  assert.deepEqual(tree.map((node) => node.task.id), ['WB-001']);
  assert.deepEqual(tree[0]?.children.map((node) => node.task.id), ['WB-002', 'WB-004']);
  assert.deepEqual(tree[0]?.children[0]?.children.map((node) => node.task.id), ['WB-003']);
});

test('keeps orphaned, duplicate, and cyclic tasks visible with structural warnings', () => {
  const tree = buildProjectTaskTree([
    task('WB-001', 'WB-404'), task('WB-002', 'WB-003'), task('WB-003', 'WB-002'), task('WB-004'), task('WB-004'),
  ]);
  assert.equal(tree.length, 5);
  assert.match(tree[0]?.issue ?? '', /not found/);
  assert.match(tree[1]?.issue ?? '', /cycle/);
  assert.match(tree[2]?.issue ?? '', /cycle/);
  assert.match(tree[3]?.issue ?? '', /Duplicate/);
  assert.equal(tree[3]?.isTaskIdUnique, false);
  assert.equal(tree[4]?.isTaskIdUnique, false);
  assert.equal(canOfferProjectTask(tree[3]!), false);
  assert.equal(canOfferProjectTask(tree[4]!), false);
  assert.equal(canOfferProjectTask(tree[0]!), false);
  assert.equal(findOfferableProjectTask(tree.map((node) => node.task), 'WB-004'), null);
});

test('does not offer completed tasks to Codex', () => {
  const completed = task('WB-001');
  completed.state = 'done';
  assert.equal(canOfferProjectTask(buildProjectTaskTree([completed])[0]!), false);
  assert.equal(findOfferableProjectTask([completed], completed.id), null);
});

test('resolves only structurally valid tasks through offer actions', () => {
  const valid = task('WB-001');
  assert.equal(findOfferableProjectTask([valid], valid.id), valid);
  assert.equal(findOfferableProjectTask([valid], 'WB-404'), null);
});

test('marks descendants of an invalid parent chain as invalid too', () => {
  const tree = buildProjectTaskTree([
    task('WB-001', 'WB-404'), task('WB-002', 'WB-001'),
  ]);
  assert.equal(tree.length, 2);
  assert.match(tree[0]?.issue ?? '', /not found/);
  assert.match(tree[1]?.issue ?? '', /not found/);
});

test('resolves and flattens deep parent chains with linear parent reads', () => {
  let parentReads = 0;
  const tasks = Array.from({ length: 2_000 }, (_unused, index) => {
    const parentId = index ? `WB-${String(index).padStart(4, '0')}` : null;
    const candidate = task(`WB-${String(index + 1).padStart(4, '0')}`);
    Object.defineProperty(candidate, 'parentId', {
      enumerable: true,
      get: () => {
        parentReads += 1;
        return parentId;
      },
    });
    return candidate;
  });
  const flattened = flattenProjectTaskTree(buildProjectTaskTree(tasks));
  assert.equal(flattened.length, tasks.length);
  assert.equal(flattened.at(-1)?.task.id, 'WB-2000');
  assert.ok(parentReads <= tasks.length * 3, `Expected linear parent reads, received ${parentReads}.`);
});

test('merges overlapping image reads against the latest task draft', async () => {
  interface Image { id: string; bytes: Uint8Array }
  let images: Image[] = [];
  let finishFirst: ((image: Image) => void) | undefined;
  let finishSecond: ((image: Image) => void) | undefined;
  const firstRead = new Promise<Image>((resolve) => { finishFirst = resolve; });
  const secondRead = new Promise<Image>((resolve) => { finishSecond = resolve; });
  const additions = [firstRead, secondRead].map(async (read) => {
    const image = await read;
    images = mergeProjectTaskImages(images, [image]);
  });
  finishSecond?.({ id: 'second', bytes: Uint8Array.of(2) });
  finishFirst?.({ id: 'first', bytes: Uint8Array.of(1) });
  await Promise.all(additions);
  assert.deepEqual(images.map((image) => image.id), ['second', 'first']);
  assert.throws(
    () => mergeProjectTaskImages(images, Array.from({ length: 3 }, (_unused, index) => ({
      id: `extra-${index}`,
      bytes: Uint8Array.of(index),
    }))),
    /no more than 4/,
  );
});

test('keeps images added while an earlier task submission is pending', () => {
  const submitted = { id: 'submitted', bytes: Uint8Array.of(1) };
  const addedWhilePending = { id: 'new', bytes: Uint8Array.of(2) };
  assert.deepEqual(
    removeSubmittedProjectTaskImages([submitted, addedWhilePending], [submitted]),
    [addedWhilePending],
  );
});

test('distinguishes task-field edits made while a submission is pending', () => {
  const submitted = {
    title: 'Submitted task', priority: 'P2', parentId: '', objective: '', acceptanceCriteria: '',
  };
  assert.equal(projectTaskDraftMatches({ ...submitted }, submitted), true);
  assert.equal(projectTaskDraftMatches({ ...submitted, objective: 'A newer draft edit' }, submitted), false);
});
