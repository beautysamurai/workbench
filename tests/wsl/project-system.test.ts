import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import type { Workspace } from '../../src/shared/types';
import {
  addProjectTask,
  initializeProjectSystem,
  parseProjectTasks,
} from '../../src/main/project-system';

const execFileAsync = promisify(execFile);

function tinyPng(): Uint8Array {
  return Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
}

function temporaryWorkspace(run: (workspace: Workspace, directory: string) => Promise<void>): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-project-'));
  const workspace: Workspace = {
    id: 'workspace', name: 'Project', description: '', icon: 'code', distro: 'Local Linux',
    root: directory, commands: [], contextItems: [],
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  };
  return run(workspace, directory).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

test('creates missing project Markdown without overwriting existing guidance and appends GUI tasks', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    fs.writeFileSync(path.join(directory, 'AGENTS.md'), '# Existing guidance\n', 'utf8');
    const initialized = await initializeProjectSystem(workspace);
    assert.equal(initialized.ready, true);
    assert.equal(fs.readFileSync(path.join(directory, 'AGENTS.md'), 'utf8'), '# Existing guidance\n');

    const updated = await addProjectTask(workspace, { title: 'Expose usage', objective: 'Show the remaining quota.', priority: 'P2' });
    assert.equal(updated.tasks.at(-1)?.title, 'Expose usage');
    assert.equal(updated.tasks.at(-1)?.state, 'pending');
    assert.equal(updated.tasks.at(-1)?.id, 'WB-001');
    assert.equal(updated.nextTaskId, 'WB-002');
  });
});

test('allocates increasing ids and persists a structured child with an image byte-for-byte', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    fs.writeFileSync(path.join(directory, 'TASKS.md'), '# Tasks\n\n### P1-004 — Existing\n\n- **State:** pending\n- **Objective:** Existing task.\n', 'utf8');
    const png = tinyPng();
    const updated = await addProjectTask(workspace, {
      title: 'Structured child', objective: 'Persist all fields.', priority: 'P0', parentId: 'P1-004',
      acceptanceCriteria: ['Image is preserved'],
      images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: png }],
    });
    const created = updated.tasks.find((task) => task.id === 'WB-005');
    assert.equal(created?.parentId, 'P1-004');
    assert.equal(created?.priority, 'P0');
    assert.deepEqual(created?.acceptanceCriteria, ['Image is preserved']);
    assert.deepEqual(created?.attachments, [{ path: '.workbench/task-images/WB-005-01.png', mediaType: 'image/png' }]);
    assert.deepEqual(fs.readFileSync(path.join(directory, '.workbench/task-images/WB-005-01.png')), Buffer.from(png));
  });
});

test('serializes concurrent additions so automatically assigned ids remain unique', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const [first, second] = await Promise.all([
      addProjectTask(workspace, { title: 'First concurrent task', priority: 'P1' }),
      addProjectTask(workspace, { title: 'Second concurrent task', priority: 'P2' }),
    ]);
    assert.equal(first.tasks.at(-1)?.id, 'WB-001');
    assert.equal(second.tasks.at(-1)?.id, 'WB-002');
    const markdown = fs.readFileSync(path.join(directory, 'TASKS.md'), 'utf8');
    assert.equal((markdown.match(/^### WB-001 /gm) ?? []).length, 1);
    assert.equal((markdown.match(/^### WB-002 /gm) ?? []).length, 1);
  });
});

test('reserves ids durably after deletion and across concurrent processes', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    await addProjectTask(workspace, { title: 'Deleted task', priority: 'P2' });
    fs.writeFileSync(path.join(directory, 'TASKS.md'), '# Tasks\n', 'utf8');
    const afterDeletion = await addProjectTask(workspace, { title: 'Not reused', priority: 'P2' });
    assert.equal(afterDeletion.tasks.at(-1)?.id, 'WB-002');

    const modulePath = path.resolve(__dirname, '../../src/main/project-system.js');
    const childScript = `
      const { addProjectTask } = require(process.argv[1]);
      const workspace = JSON.parse(process.argv[2]);
      addProjectTask(workspace, { title: process.argv[3], priority: 'P2' })
        .then(() => process.exit(0))
        .catch((error) => { console.error(error); process.exit(1); });
    `;
    await Promise.all(Array.from({ length: 6 }, (_unused, index) => execFileAsync(
      process.execPath,
      ['-e', childScript, modulePath, JSON.stringify(workspace), `Process task ${index + 1}`],
      { timeout: 20_000 },
    )));
    const tasks = parseProjectTasks(fs.readFileSync(path.join(directory, 'TASKS.md'), 'utf8'));
    const processTasks = tasks.filter((task) => task.title.startsWith('Process task'));
    assert.equal(processTasks.length, 6);
    assert.deepEqual([...processTasks.map((task) => task.id)].sort(), [
      'WB-003', 'WB-004', 'WB-005', 'WB-006', 'WB-007', 'WB-008',
    ]);
  });
});

test('rejects corrupt sequence metadata and ambiguous parent ids', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    await initializeProjectSystem(workspace);
    fs.mkdirSync(path.join(directory, '.workbench'));
    fs.writeFileSync(path.join(directory, '.workbench/task-sequence'), 'not-a-number\n', 'utf8');
    await assert.rejects(addProjectTask(workspace, { title: 'No reset', priority: 'P2' }), /sequence is corrupt/);
  });
  await temporaryWorkspace(async (workspace, directory) => {
    fs.writeFileSync(path.join(directory, 'TASKS.md'), `# Tasks

### WB-001 — First copy

- **State:** pending

### WB-001 — Second copy

- **State:** pending
`, 'utf8');
    await assert.rejects(addProjectTask(workspace, {
      title: 'Ambiguous child', priority: 'P1', parentId: 'WB-001',
    }), /existing parent/);
  });
});

test('removes newly written images when the task append fails', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    await initializeProjectSystem(workspace);
    const tasksPath = path.join(directory, 'TASKS.md');
    fs.chmodSync(tasksPath, 0o444);
    try {
      await assert.rejects(addProjectTask(workspace, {
        title: 'Cannot append', priority: 'P1',
        images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: tinyPng() }],
      }), /Permission denied|operation failed/i);
      assert.deepEqual(fs.readdirSync(path.join(directory, '.workbench/task-images')), []);
      assert.doesNotMatch(fs.readFileSync(tasksPath, 'utf8'), /Cannot append/);
    } finally {
      fs.chmodSync(tasksPath, 0o644);
    }
  });
});

test('rejects invalid parents and unsafe task-image directory boundaries', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    await initializeProjectSystem(workspace);
    await assert.rejects(addProjectTask(workspace, { title: 'Orphan', priority: 'P1', parentId: 'WB-999' }), /existing parent/);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-images-outside-'));
    fs.mkdirSync(path.join(directory, '.workbench'));
    fs.symlinkSync(outside, path.join(directory, '.workbench/task-images'));
    try {
      const png = tinyPng();
      await assert.rejects(addProjectTask(workspace, {
        title: 'Unsafe image', priority: 'P1', images: [{ name: 'image.png', mediaType: 'image/png', bytes: png }],
      }), /unsafe task-image directory/);
      assert.deepEqual(fs.readdirSync(outside), []);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('refuses to follow an unsafe project-file symlink', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-outside-'));
    const outsideTasks = path.join(outside, 'TASKS.md');
    fs.writeFileSync(outsideTasks, '# Outside\n', 'utf8');
    fs.symlinkSync(outsideTasks, path.join(directory, 'TASKS.md'));
    try {
      await assert.rejects(initializeProjectSystem(workspace), /unsafe project-file symlink/);
      assert.equal(fs.readFileSync(outsideTasks, 'utf8'), '# Outside\n');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('refuses non-regular project files and task-sequence symlinks', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    fs.mkdirSync(path.join(directory, 'TASKS.md'));
    await assert.rejects(initializeProjectSystem(workspace), /not a regular file/);
  });
  await temporaryWorkspace(async (workspace, directory) => {
    await initializeProjectSystem(workspace);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-sequence-outside-'));
    const outsideSequence = path.join(outside, 'sequence');
    fs.writeFileSync(outsideSequence, '100\n', 'utf8');
    fs.mkdirSync(path.join(directory, '.workbench'));
    fs.symlinkSync(outsideSequence, path.join(directory, '.workbench/task-sequence'));
    try {
      await assert.rejects(addProjectTask(workspace, { title: 'Unsafe sequence', priority: 'P1' }), /sequence is unsafe/);
      assert.equal(fs.readFileSync(outsideSequence, 'utf8'), '100\n');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
