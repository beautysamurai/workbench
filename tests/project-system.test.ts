import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatProjectTask,
  nextProjectTaskId,
  parseProjectTasks,
  validateProjectTaskImage,
} from '../src/main/project-system';

function tinyPng(): Uint8Array {
  return Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
}

function tinyWebp(): Uint8Array {
  return Uint8Array.from(Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'));
}

function extendedTinyWebp(): Uint8Array {
  const imageChunk = tinyWebp().slice(12);
  const bytes = Buffer.alloc(30 + imageChunk.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  bytes.writeUInt32LE(10, 16);
  imageChunk.forEach((value, index) => { bytes[30 + index] = value; });
  return bytes;
}

test('parses task headings and normalizes supported states', () => {
  const tasks = parseProjectTasks('# Tasks\n\n### P0-001 — Ship it\n\n- **State:** in progress\n- **Objective:** Finish safely.\n');
  assert.deepEqual(tasks, [{
    id: 'P0-001', title: 'Ship it', state: 'in progress', priority: 'P0', objective: 'Finish safely.',
    parentId: null, acceptanceCriteria: [], attachments: [],
  }]);
  assert.match(formatProjectTask({ title: ' Add model picker ', objective: ' Use the catalog. ', priority: 'P1' }, 'WB-002'), /- \*\*Priority:\*\* P1/);
});

test('round-trips structured tasks and ignores placeholder headings', () => {
  const markdown = `${formatProjectTask({
    title: 'Child task', objective: 'Keep the structure.', priority: 'P1', parentId: 'P0-001',
    acceptanceCriteria: ['First result exists', 'Second result passes'],
  }, 'WB-005', [{ path: '.workbench/task-images/WB-005-01.png', mediaType: 'image/png' }])}\n### P?-NNN — Short outcome\n\n- **State:** pending\n`;
  const tasks = parseProjectTasks(markdown);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0], {
    id: 'WB-005', title: 'Child task', state: 'pending', priority: 'P1', objective: 'Keep the structure.',
    parentId: 'P0-001', acceptanceCriteria: ['First result exists', 'Second result passes'],
    attachments: [{ path: '.workbench/task-images/WB-005-01.png', mediaType: 'image/png' }],
  });
  assert.equal(nextProjectTaskId([...tasks, { ...tasks[0], id: 'P2-019' }]), 'WB-020');
});

test('only parses parent and attachment metadata from their top-level fields', () => {
  const markdown = `### WB-010 — Literal metadata examples

- **State:** pending
- **Priority:** P2
- **Objective:** Explain literal Markdown safely.
- **Acceptance criteria:**
  - [ ] - **Parent:** WB-001
  - [ ] ![Not an attachment](.workbench/task-images/WB-010-01.png)
`;
  const parsed = parseProjectTasks(markdown)[0];
  assert.equal(parsed?.parentId, null);
  assert.deepEqual(parsed?.attachments, []);
  assert.deepEqual(parsed?.acceptanceCriteria, [
    '- **Parent:** WB-001',
    '![Not an attachment](.workbench/task-images/WB-010-01.png)',
  ]);
});

test('validates supported image bytes without filesystem access', () => {
  assert.throws(() => validateProjectTaskImage({ bytes: Uint8Array.of(1, 2, 3) }), /PNG, JPEG, or WebP/);
  assert.throws(() => validateProjectTaskImage({ bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }), /PNG, JPEG, or WebP/);
  assert.equal(validateProjectTaskImage({ bytes: tinyPng() }).mediaType, 'image/png');
  assert.equal(validateProjectTaskImage({ bytes: tinyWebp() }).mediaType, 'image/webp');
  assert.equal(validateProjectTaskImage({ bytes: extendedTinyWebp() }).mediaType, 'image/webp');
});

test('rejects malformed WebP chunks and oversized bytes before copying', () => {
  const emptyVp8x = Buffer.alloc(20);
  emptyVp8x.write('RIFF', 0, 'ascii');
  emptyVp8x.writeUInt32LE(12, 4);
  emptyVp8x.write('WEBP', 8, 'ascii');
  emptyVp8x.write('VP8X', 12, 'ascii');
  emptyVp8x.writeUInt32LE(0, 16);
  assert.throws(() => validateProjectTaskImage({ bytes: emptyVp8x }), /PNG, JPEG, or WebP/);
  assert.throws(() => validateProjectTaskImage({ bytes: tinyWebp().slice(0, -1) }), /PNG, JPEG, or WebP/);

  const oversized = new Uint8Array((5 * 1024 * 1024) + 1);
  Object.defineProperty(oversized, Symbol.iterator, {
    value: () => { throw new Error('Oversized bytes were copied.'); },
  });
  assert.throws(() => validateProjectTaskImage({ bytes: oversized }), /5 MB or smaller/);
});
