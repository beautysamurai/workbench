import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectTask } from '../src/shared/types';
import { buildProjectTaskTree, mergeProjectTaskImages } from '../src/renderer/project-tasks';

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
});

test('marks descendants of an invalid parent chain as invalid too', () => {
  const tree = buildProjectTaskTree([
    task('WB-001', 'WB-404'), task('WB-002', 'WB-001'),
  ]);
  assert.equal(tree.length, 2);
  assert.match(tree[0]?.issue ?? '', /not found/);
  assert.match(tree[1]?.issue ?? '', /not found/);
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
