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
  inspectProjectSystem,
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

test('treats the durable task append as success when the follow-up inspection fails', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    await initializeProjectSystem(workspace);
    const tasksPath = path.join(directory, 'TASKS.md');
    const sequencePath = path.join(directory, '.workbench/task-sequence');
    let forcedInspectionFailure = false;
    const watcher = fs.watch(directory, (_event, filename) => {
      if (forcedInspectionFailure) return;
      if (filename !== 'TASKS.md' || !fs.existsSync(tasksPath)) return;
      const markdown = fs.readFileSync(tasksPath, 'utf8');
      if (!markdown.includes('Committed task')) return;
      forcedInspectionFailure = true;
      fs.writeFileSync(sequencePath, 'corrupt-after-append\n', 'utf8');
    });
    try {
      const updated = await addProjectTask(workspace, {
        title: 'Committed task',
        priority: 'P1',
        images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: tinyPng() }],
      });
      assert.equal(updated.tasks.at(-1)?.title, 'Committed task');
      assert.equal(updated.tasks.at(-1)?.id, 'WB-001');
      assert.equal(updated.tasks.at(-1)?.attachments[0]?.path, '.workbench/task-images/WB-001-01.png');
      assert.equal(updated.nextTaskId, 'WB-002');
    } finally {
      watcher.close();
    }
    assert.equal(forcedInspectionFailure, true);
    assert.equal((fs.readFileSync(tasksPath, 'utf8').match(/^### WB-001 — Committed task$/gm) ?? []).length, 1);
    assert.deepEqual(fs.readFileSync(path.join(directory, '.workbench/task-images/WB-001-01.png')), Buffer.from(tinyPng()));
  });
});

test('allocates increasing ids and persists a structured child with an image byte-for-byte', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const tasksPath = path.join(directory, 'TASKS.md');
    fs.writeFileSync(tasksPath, '# Tasks\n\n### P1-004 — Existing\n\n- **State:** pending\n- **Objective:** Existing task.\n', 'utf8');
    fs.chmodSync(tasksPath, 0o640);
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
    const imagePath = path.join(directory, '.workbench/task-images/WB-005-01.png');
    assert.deepEqual(fs.readFileSync(imagePath), Buffer.from(png));
    const imageStat = fs.lstatSync(imagePath);
    assert.equal(imageStat.isFile(), true);
    assert.equal(imageStat.nlink, 1);
    assert.equal(imageStat.mode & 0o777, 0o644);
    const tasksStat = fs.lstatSync(tasksPath);
    assert.equal(tasksStat.isFile(), true);
    assert.equal(tasksStat.nlink, 1);
    assert.equal(tasksStat.mode & 0o777, 0o640);
    assert.deepEqual(fs.readdirSync(directory).filter((name) => name.includes('.TASKS.md.workbench-')), []);
  });
});

test('allows an unambiguous named legacy task to become a parent', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    fs.writeFileSync(path.join(directory, 'TASKS.md'), `# Tasks

### TASK-A — Named legacy task

- **State:** pending
`, 'utf8');
    const updated = await addProjectTask(workspace, {
      title: 'Named child',
      priority: 'P1',
      parentId: 'TASK-A',
    });
    const child = updated.tasks.find((task) => task.title === 'Named child');
    assert.equal(child?.parentId, 'TASK-A');
    assert.equal(updated.tasks.find((task) => task.id === 'TASK-A')?.title, 'Named legacy task');
  });
});

test('rejects a stale parent snapshot before appending a prepared child', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-parent-race-tools-'));
    const tasksPath = path.join(directory, 'TASKS.md');
    const marker = path.join(toolsDirectory, 'changed');
    const catWrapper = path.join(toolsDirectory, 'cat');
    fs.writeFileSync(tasksPath, '# Tasks\n\n### P1-004 — Parent\n\n- **State:** pending\n- **Priority:** P1\n- **Objective:** Parent.\n', 'utf8');
    fs.writeFileSync(catWrapper, `#!/bin/bash
set -u
/usr/bin/cat "$@"
status=$?
if [ "$status" -eq 0 ] && [ "$#" -eq 0 ] && [ ! -e "$WORKBENCH_TEST_PARENT_RACE_MARKER" ]; then
  : > "$WORKBENCH_TEST_PARENT_RACE_MARKER"
  printf '# Tasks\\n' > "$WORKBENCH_TEST_PARENT_RACE_TASKS"
fi
exit "$status"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      marker: process.env.WORKBENCH_TEST_PARENT_RACE_MARKER,
      tasks: process.env.WORKBENCH_TEST_PARENT_RACE_TASKS,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_PARENT_RACE_MARKER = marker;
    process.env.WORKBENCH_TEST_PARENT_RACE_TASKS = tasksPath;
    try {
      await assert.rejects(addProjectTask(workspace, {
        title: 'Racing child',
        priority: 'P1',
        parentId: 'P1-004',
        images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: tinyPng() }],
      }), /existing parent/);
      assert.equal(fs.existsSync(marker), true, 'The test must remove the parent after image writing.');
      assert.equal(fs.readFileSync(tasksPath, 'utf8'), '# Tasks\n');
      assert.deepEqual(fs.readdirSync(path.join(directory, '.workbench/task-images')), []);
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_PARENT_RACE_MARKER;
      else process.env.WORKBENCH_TEST_PARENT_RACE_MARKER = oldEnvironment.marker;
      if (oldEnvironment.tasks === undefined) delete process.env.WORKBENCH_TEST_PARENT_RACE_TASKS;
      else process.env.WORKBENCH_TEST_PARENT_RACE_TASKS = oldEnvironment.tasks;
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
  });
});

test('atomically rejects a parent edit at the task-file commit point', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-parent-commit-race-tools-'));
    const tasksPath = path.join(directory, 'TASKS.md');
    const marker = path.join(toolsDirectory, 'changed');
    const mvWrapper = path.join(toolsDirectory, 'mv');
    fs.writeFileSync(tasksPath, '# Tasks\n\n### P1-004 — Parent\n\n- **State:** pending\n- **Priority:** P1\n- **Objective:** Parent.\n', 'utf8');
    fs.writeFileSync(mvWrapper, `#!/bin/bash
set -u
source_path="\${@: -2:1}"
claim_path="\${@: -1}"
if [[ "$source_path" == */TASKS.md ]] && [[ "$claim_path" == */.TASKS.md.workbench-previous-* ]] && [ ! -e "$WORKBENCH_TEST_PARENT_COMMIT_MARKER" ]; then
  : > "$WORKBENCH_TEST_PARENT_COMMIT_MARKER"
  printf '# Tasks\\n' > "$WORKBENCH_TEST_PARENT_COMMIT_TASKS.editor"
  /usr/bin/mv -fT -- "$WORKBENCH_TEST_PARENT_COMMIT_TASKS.editor" "$WORKBENCH_TEST_PARENT_COMMIT_TASKS"
fi
exec /usr/bin/mv "$@"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      marker: process.env.WORKBENCH_TEST_PARENT_COMMIT_MARKER,
      tasks: process.env.WORKBENCH_TEST_PARENT_COMMIT_TASKS,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_PARENT_COMMIT_MARKER = marker;
    process.env.WORKBENCH_TEST_PARENT_COMMIT_TASKS = tasksPath;
    try {
      await assert.rejects(addProjectTask(workspace, {
        title: 'Atomic racing child',
        priority: 'P1',
        parentId: 'P1-004',
        images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: tinyPng() }],
      }), /existing parent/);
      assert.equal(fs.existsSync(marker), true, 'The test must remove the parent immediately before the atomic claim.');
      assert.equal(fs.readFileSync(tasksPath, 'utf8'), '# Tasks\n');
      assert.deepEqual(fs.readdirSync(path.join(directory, '.workbench/task-images')), []);
      assert.deepEqual(fs.readdirSync(directory).filter((name) => name.includes('.TASKS.md.workbench-')), []);
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_PARENT_COMMIT_MARKER;
      else process.env.WORKBENCH_TEST_PARENT_COMMIT_MARKER = oldEnvironment.marker;
      if (oldEnvironment.tasks === undefined) delete process.env.WORKBENCH_TEST_PARENT_COMMIT_TASKS;
      else process.env.WORKBENCH_TEST_PARENT_COMMIT_TASKS = oldEnvironment.tasks;
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
  });
});

test('does not clobber a task file created while the validated entry is claimed', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-task-install-race-tools-'));
    const tasksPath = path.join(directory, 'TASKS.md');
    const marker = path.join(toolsDirectory, 'changed');
    const lnWrapper = path.join(toolsDirectory, 'ln');
    fs.writeFileSync(tasksPath, '# Tasks\n\n### P1-004 — Parent\n\n- **State:** pending\n- **Priority:** P1\n- **Objective:** Parent.\n', 'utf8');
    fs.writeFileSync(lnWrapper, `#!/bin/bash
set -u
source_path="\${@: -2:1}"
target_path="\${@: -1}"
if [[ "$source_path" == /proc/*/fd/3 ]] && [[ "$target_path" == */TASKS.md ]] && [ ! -e "$WORKBENCH_TEST_TASK_INSTALL_MARKER" ]; then
  : > "$WORKBENCH_TEST_TASK_INSTALL_MARKER"
  printf '# Tasks\\n' > "$WORKBENCH_TEST_TASK_INSTALL_TARGET"
fi
exec /usr/bin/ln "$@"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      marker: process.env.WORKBENCH_TEST_TASK_INSTALL_MARKER,
      tasks: process.env.WORKBENCH_TEST_TASK_INSTALL_TARGET,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_TASK_INSTALL_MARKER = marker;
    process.env.WORKBENCH_TEST_TASK_INSTALL_TARGET = tasksPath;
    try {
      await assert.rejects(addProjectTask(workspace, {
        title: 'No-clobber child',
        priority: 'P1',
        parentId: 'P1-004',
        images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: tinyPng() }],
      }), /existing parent/);
      assert.equal(fs.existsSync(marker), true, 'The test must create a competing task file before installation.');
      assert.equal(fs.readFileSync(tasksPath, 'utf8'), '# Tasks\n');
      assert.deepEqual(fs.readdirSync(path.join(directory, '.workbench/task-images')), []);
      assert.deepEqual(fs.readdirSync(directory).filter((name) => name.includes('.TASKS.md.workbench-')), []);
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_TASK_INSTALL_MARKER;
      else process.env.WORKBENCH_TEST_TASK_INSTALL_MARKER = oldEnvironment.marker;
      if (oldEnvironment.tasks === undefined) delete process.env.WORKBENCH_TEST_TASK_INSTALL_TARGET;
      else process.env.WORKBENCH_TEST_TASK_INSTALL_TARGET = oldEnvironment.tasks;
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
  });
});

test('revalidates the prepared task candidate at the installation boundary', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-task-candidate-race-tools-'));
    const tasksPath = path.join(directory, 'TASKS.md');
    const marker = path.join(toolsDirectory, 'changed');
    const lnWrapper = path.join(toolsDirectory, 'ln');
    fs.writeFileSync(tasksPath, '# Tasks\n\n### P1-004 — Parent\n\n- **State:** pending\n- **Priority:** P1\n- **Objective:** Parent.\n', 'utf8');
    fs.writeFileSync(lnWrapper, `#!/bin/bash
set -u
source_path="\${@: -2:1}"
target_path="\${@: -1}"
if [[ "$source_path" == /proc/*/fd/3 ]] && [[ "$target_path" == */TASKS.md ]] && [ ! -e "$WORKBENCH_TEST_CANDIDATE_MARKER" ]; then
  : > "$WORKBENCH_TEST_CANDIDATE_MARKER"
  for candidate in "$WORKBENCH_TEST_CANDIDATE_ROOT"/.TASKS.md.workbench-next-*; do
    if [ -f "$candidate" ]; then
      printf '# Concurrent candidate rewrite\\n' > "$candidate"
      break
    fi
  done
fi
exec /usr/bin/ln "$@"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      marker: process.env.WORKBENCH_TEST_CANDIDATE_MARKER,
      root: process.env.WORKBENCH_TEST_CANDIDATE_ROOT,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_CANDIDATE_MARKER = marker;
    process.env.WORKBENCH_TEST_CANDIDATE_ROOT = directory;
    try {
      const updated = await addProjectTask(workspace, {
        title: 'Candidate-safe child',
        priority: 'P1',
        parentId: 'P1-004',
      });
      assert.equal(fs.existsSync(marker), true, 'The test must rewrite the candidate during its first installation.');
      assert.equal(updated.tasks.at(-1)?.title, 'Candidate-safe child');
      const markdown = fs.readFileSync(tasksPath, 'utf8');
      assert.match(markdown, /^### P1-004 — Parent$/m);
      assert.equal((markdown.match(/^### WB-005 — Candidate-safe child$/gm) ?? []).length, 1);
      assert.doesNotMatch(markdown, /Concurrent candidate rewrite/);
      assert.deepEqual(fs.readdirSync(directory).filter((name) => name.includes('.TASKS.md.workbench-')), []);
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_CANDIDATE_MARKER;
      else process.env.WORKBENCH_TEST_CANDIDATE_MARKER = oldEnvironment.marker;
      if (oldEnvironment.root === undefined) delete process.env.WORKBENCH_TEST_CANDIDATE_ROOT;
      else process.env.WORKBENCH_TEST_CANDIDATE_ROOT = oldEnvironment.root;
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
  });
});

test('retries an atomic task update without losing a compatible concurrent edit', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-task-update-retry-tools-'));
    const tasksPath = path.join(directory, 'TASKS.md');
    const marker = path.join(toolsDirectory, 'changed');
    const mvWrapper = path.join(toolsDirectory, 'mv');
    fs.writeFileSync(tasksPath, '# Tasks\n\n### P1-004 — Parent\n\n- **State:** pending\n- **Priority:** P1\n- **Objective:** Parent.\n', 'utf8');
    fs.writeFileSync(mvWrapper, `#!/bin/bash
set -u
source_path="\${@: -2:1}"
claim_path="\${@: -1}"
if [[ "$source_path" == */TASKS.md ]] && [[ "$claim_path" == */.TASKS.md.workbench-previous-* ]] && [ ! -e "$WORKBENCH_TEST_UPDATE_RETRY_MARKER" ]; then
  : > "$WORKBENCH_TEST_UPDATE_RETRY_MARKER"
  printf '\\nConcurrent user note.\\n' >> "$WORKBENCH_TEST_UPDATE_RETRY_TASKS"
  chmod 0600 "$WORKBENCH_TEST_UPDATE_RETRY_TASKS"
fi
exec /usr/bin/mv "$@"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      marker: process.env.WORKBENCH_TEST_UPDATE_RETRY_MARKER,
      tasks: process.env.WORKBENCH_TEST_UPDATE_RETRY_TASKS,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_UPDATE_RETRY_MARKER = marker;
    process.env.WORKBENCH_TEST_UPDATE_RETRY_TASKS = tasksPath;
    try {
      const updated = await addProjectTask(workspace, {
        title: 'Retried child',
        priority: 'P1',
        parentId: 'P1-004',
      });
      assert.equal(fs.existsSync(marker), true, 'The test must edit the task file immediately before the first claim.');
      assert.equal(updated.tasks.at(-1)?.title, 'Retried child');
      const markdown = fs.readFileSync(tasksPath, 'utf8');
      assert.match(markdown, /Concurrent user note\./);
      assert.equal((markdown.match(/^### WB-005 — Retried child$/gm) ?? []).length, 1);
      assert.equal(fs.statSync(tasksPath).mode & 0o777, 0o600);
      assert.deepEqual(fs.readdirSync(directory).filter((name) => name.includes('.TASKS.md.workbench-')), []);
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_UPDATE_RETRY_MARKER;
      else process.env.WORKBENCH_TEST_UPDATE_RETRY_MARKER = oldEnvironment.marker;
      if (oldEnvironment.tasks === undefined) delete process.env.WORKBENCH_TEST_UPDATE_RETRY_TASKS;
      else process.env.WORKBENCH_TEST_UPDATE_RETRY_TASKS = oldEnvironment.tasks;
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
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

test('pins and revalidates the task-sequence candidate during installation', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const baseline = await addProjectTask(workspace, { title: 'Baseline', priority: 'P1' });
    assert.equal(baseline.tasks.at(-1)?.id, 'WB-001');
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-sequence-candidate-tools-'));
    const marker = path.join(toolsDirectory, 'changed');
    const sequencePath = path.join(directory, '.workbench/task-sequence');
    fs.writeFileSync(path.join(toolsDirectory, 'mv'), `#!/bin/bash
set -u
source_path="\${@: -2:1}"
target_path="\${@: -1}"
if [[ "$source_path" == */.task-sequence.* ]] && [[ "$target_path" == */task-sequence ]] && [ ! -e "$WORKBENCH_TEST_SEQUENCE_MARKER" ]; then
  : > "$WORKBENCH_TEST_SEQUENCE_MARKER"
  printf 'corrupt-counter\\n' > "$source_path"
fi
exec /usr/bin/mv "$@"
`, { mode: 0o755 });
    fs.writeFileSync(path.join(toolsDirectory, 'ln'), `#!/bin/bash
set -u
source_path="\${@: -2:1}"
target_path="\${@: -1}"
if [[ "$source_path" == /proc/*/fd/3 ]] && [[ "$target_path" == */task-sequence ]] && [ ! -e "$WORKBENCH_TEST_SEQUENCE_MARKER" ]; then
  : > "$WORKBENCH_TEST_SEQUENCE_MARKER"
  for candidate in "$WORKBENCH_TEST_SEQUENCE_ROOT"/.workbench/.task-sequence.*; do
    if [ -f "$candidate" ]; then
      printf 'corrupt-counter\\n' > "$candidate"
      break
    fi
  done
fi
exec /usr/bin/ln "$@"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      marker: process.env.WORKBENCH_TEST_SEQUENCE_MARKER,
      root: process.env.WORKBENCH_TEST_SEQUENCE_ROOT,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_SEQUENCE_MARKER = marker;
    process.env.WORKBENCH_TEST_SEQUENCE_ROOT = directory;
    try {
      await assert.rejects(
        addProjectTask(workspace, { title: 'Racing reservation', priority: 'P1' }),
        /sequence candidate changed/,
      );
      assert.equal(fs.existsSync(marker), true, 'The test must rewrite the sequence candidate during installation.');
      assert.equal(fs.readFileSync(sequencePath, 'utf8'), '1\n');
      assert.doesNotMatch(fs.readFileSync(path.join(directory, 'TASKS.md'), 'utf8'), /Racing reservation/);
      const retried = await addProjectTask(workspace, { title: 'Safe retry', priority: 'P1' });
      assert.equal(retried.tasks.at(-1)?.id, 'WB-002');
      assert.equal(fs.readFileSync(sequencePath, 'utf8'), '2\n');
      assert.deepEqual(
        fs.readdirSync(path.join(directory, '.workbench')).filter((name) => name.startsWith('.task-sequence')),
        [],
      );
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_SEQUENCE_MARKER;
      else process.env.WORKBENCH_TEST_SEQUENCE_MARKER = oldEnvironment.marker;
      if (oldEnvironment.root === undefined) delete process.env.WORKBENCH_TEST_SEQUENCE_ROOT;
      else process.env.WORKBENCH_TEST_SEQUENCE_ROOT = oldEnvironment.root;
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
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

test('preserves a concurrently replaced image when task failure cleanup runs', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-image-cleanup-race-tools-'));
    const marker = path.join(toolsDirectory, 'changed');
    const imagePath = path.join(directory, '.workbench/task-images/WB-001-01.png');
    const sha256sumWrapper = path.join(toolsDirectory, 'sha256sum');
    const mvWrapper = path.join(toolsDirectory, 'mv');
    const replacement = Buffer.from('concurrent replacement\n', 'utf8');
    await initializeProjectSystem(workspace);
    fs.writeFileSync(sha256sumWrapper, `#!/bin/bash
set -u
target="\${@: -1}"
if [[ "$target" == /proc/*/fd/4 ]]; then
  printf 'forced task digest failure' >&2
  exit 1
fi
exec /usr/bin/sha256sum "$@"
`, { mode: 0o755 });
    fs.writeFileSync(mvWrapper, `#!/bin/bash
set -u
source_path="\${@: -2:1}"
claim_path="\${@: -1}"
if [[ "$source_path" == */WB-001-01.png ]] && [[ "$claim_path" == */.WB-*.workbench-cleanup.* ]] && [ ! -e "$WORKBENCH_TEST_IMAGE_CLEANUP_MARKER" ]; then
  : > "$WORKBENCH_TEST_IMAGE_CLEANUP_MARKER"
  rm -f -- "$source_path"
  printf 'concurrent replacement\\n' > "$source_path"
  chmod 0600 "$source_path"
fi
exec /usr/bin/mv "$@"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      marker: process.env.WORKBENCH_TEST_IMAGE_CLEANUP_MARKER,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_IMAGE_CLEANUP_MARKER = marker;
    try {
      await assert.rejects(addProjectTask(workspace, {
        title: 'Cleanup race',
        priority: 'P1',
        images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: tinyPng() }],
      }), /could not be revalidated/);
      assert.equal(fs.existsSync(marker), true, 'The test must replace the installed image at the cleanup claim.');
      assert.deepEqual(fs.readFileSync(imagePath), replacement);
      assert.equal(fs.statSync(imagePath).mode & 0o777, 0o600);
      assert.doesNotMatch(fs.readFileSync(path.join(directory, 'TASKS.md'), 'utf8'), /Cleanup race/);
      assert.deepEqual(fs.readdirSync(path.dirname(imagePath)).filter((name) => name.includes('workbench-cleanup')), []);
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_IMAGE_CLEANUP_MARKER;
      else process.env.WORKBENCH_TEST_IMAGE_CLEANUP_MARKER = oldEnvironment.marker;
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
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

test('does not follow an image-directory replacement after validation', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-image-race-outside-'));
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-image-race-tools-'));
    const imageDirectory = path.join(directory, '.workbench/task-images');
    const marker = path.join(toolsDirectory, 'swapped');
    const realpathWrapper = path.join(toolsDirectory, 'realpath');
    fs.writeFileSync(realpathWrapper, `#!/bin/bash
set -eu
actual=/usr/bin/realpath
resolved=$("$actual" "$@")
if [ "$resolved" = "\${WORKBENCH_TEST_SWAP_IMAGE_DIR:-}" ] && [ ! -e "\${WORKBENCH_TEST_SWAP_MARKER:-}" ]; then
  : > "$WORKBENCH_TEST_SWAP_MARKER"
  mv -- "$WORKBENCH_TEST_SWAP_IMAGE_DIR" "$WORKBENCH_TEST_SWAP_IMAGE_DIR-original"
  ln -s -- "$WORKBENCH_TEST_IMAGE_OUTSIDE" "$WORKBENCH_TEST_SWAP_IMAGE_DIR"
fi
printf '%s\\n' "$resolved"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      imageDirectory: process.env.WORKBENCH_TEST_SWAP_IMAGE_DIR,
      marker: process.env.WORKBENCH_TEST_SWAP_MARKER,
      outside: process.env.WORKBENCH_TEST_IMAGE_OUTSIDE,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_SWAP_IMAGE_DIR = imageDirectory;
    process.env.WORKBENCH_TEST_SWAP_MARKER = marker;
    process.env.WORKBENCH_TEST_IMAGE_OUTSIDE = outside;
    let rejected = false;
    try {
      await addProjectTask(workspace, {
        title: 'Anchored image',
        priority: 'P1',
        images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: tinyPng() }],
      }).catch(() => { rejected = true; });
      assert.equal(rejected, true, `Image write escaped into: ${fs.readdirSync(outside).join(', ')}`);
      assert.deepEqual(fs.readdirSync(outside), []);
      assert.doesNotMatch(fs.readFileSync(path.join(directory, 'TASKS.md'), 'utf8'), /Anchored image/);
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.imageDirectory === undefined) delete process.env.WORKBENCH_TEST_SWAP_IMAGE_DIR;
      else process.env.WORKBENCH_TEST_SWAP_IMAGE_DIR = oldEnvironment.imageDirectory;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_SWAP_MARKER;
      else process.env.WORKBENCH_TEST_SWAP_MARKER = oldEnvironment.marker;
      if (oldEnvironment.outside === undefined) delete process.env.WORKBENCH_TEST_IMAGE_OUTSIDE;
      else process.env.WORKBENCH_TEST_IMAGE_OUTSIDE = oldEnvironment.outside;
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
  });
});

test('does not follow a temporary image replacement between writing and installation', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-image-temp-race-outside-'));
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-image-temp-race-tools-'));
    const imageDirectory = path.join(directory, '.workbench/task-images');
    const outsideFile = path.join(outside, 'private.bin');
    const marker = path.join(toolsDirectory, 'swapped');
    const catWrapper = path.join(toolsDirectory, 'cat');
    const png = tinyPng();
    const outsideBytes = Buffer.alloc(png.length, 0x78);
    fs.writeFileSync(outsideFile, outsideBytes, { mode: 0o600 });
    fs.writeFileSync(catWrapper, `#!/bin/bash
set -u
actual=/usr/bin/cat
"$actual" "$@"
status=$?
if [ "$status" -eq 0 ] && [ ! -e "${marker}" ] && [ -d "${imageDirectory}" ]; then
  temporary=$(find "${imageDirectory}" -maxdepth 1 -type f -name '.WB-*' -print -quit)
  if [ -n "$temporary" ]; then
    : > "${marker}"
    rm -f -- "$temporary"
    ln -s -- "${outsideFile}" "$temporary"
  fi
fi
exit "$status"
`, { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${toolsDirectory}:${oldPath ?? ''}`;
    try {
      await assert.rejects(addProjectTask(workspace, {
        title: 'Pinned temporary image',
        priority: 'P1',
        images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: png }],
      }), /temporary file changed during writing|could not be installed/);
      assert.equal(fs.existsSync(marker), true, 'The test must replace the temporary image after cat returns.');
      assert.deepEqual(fs.readFileSync(outsideFile), outsideBytes);
      assert.equal(fs.statSync(outsideFile).mode & 0o777, 0o600);
      assert.equal(fs.lstatSync(path.join(imageDirectory, 'WB-001-01.png'), { throwIfNoEntry: false }), undefined);
      assert.doesNotMatch(fs.readFileSync(path.join(directory, 'TASKS.md'), 'utf8'), /Pinned temporary image/);
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
  });
});

test('does not follow a task-metadata directory replacement after lock validation', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-metadata-race-outside-'));
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-metadata-race-tools-'));
    const metadataDirectory = path.join(directory, '.workbench');
    const marker = path.join(toolsDirectory, 'swapped');
    const statWrapper = path.join(toolsDirectory, 'stat');
    fs.writeFileSync(statWrapper, `#!/bin/bash
set -eu
actual=/usr/bin/stat
target="\${!#}"
if [[ "$target" == */task-sequence.lock ]] && [ ! -e "\${WORKBENCH_TEST_SWAP_MARKER:-}" ]; then
  result=$("$actual" "$@")
  : > "$WORKBENCH_TEST_SWAP_MARKER"
  mv -- "$WORKBENCH_TEST_METADATA_DIR" "$WORKBENCH_TEST_METADATA_DIR-original"
  ln -s -- "$WORKBENCH_TEST_METADATA_OUTSIDE" "$WORKBENCH_TEST_METADATA_DIR"
  printf '%s\\n' "$result"
  exit 0
fi
exec "$actual" "$@"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      metadataDirectory: process.env.WORKBENCH_TEST_METADATA_DIR,
      marker: process.env.WORKBENCH_TEST_SWAP_MARKER,
      outside: process.env.WORKBENCH_TEST_METADATA_OUTSIDE,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_METADATA_DIR = metadataDirectory;
    process.env.WORKBENCH_TEST_SWAP_MARKER = marker;
    process.env.WORKBENCH_TEST_METADATA_OUTSIDE = outside;
    let rejected = false;
    try {
      await addProjectTask(workspace, { title: 'Anchored metadata', priority: 'P1' })
        .catch(() => { rejected = true; });
      assert.equal(rejected, true, 'The replaced task-metadata path should be rejected before append.');
      assert.deepEqual(fs.readdirSync(outside), []);
      assert.doesNotMatch(fs.readFileSync(path.join(directory, 'TASKS.md'), 'utf8'), /Anchored metadata/);
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.metadataDirectory === undefined) delete process.env.WORKBENCH_TEST_METADATA_DIR;
      else process.env.WORKBENCH_TEST_METADATA_DIR = oldEnvironment.metadataDirectory;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_SWAP_MARKER;
      else process.env.WORKBENCH_TEST_SWAP_MARKER = oldEnvironment.marker;
      if (oldEnvironment.outside === undefined) delete process.env.WORKBENCH_TEST_METADATA_OUTSIDE;
      else process.env.WORKBENCH_TEST_METADATA_OUTSIDE = oldEnvironment.outside;
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
  });
});

test('does not follow a TASKS.md replacement after file validation', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-tasks-race-outside-'));
    const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-tasks-race-tools-'));
    const tasksPath = path.join(directory, 'TASKS.md');
    const outsideTasks = path.join(outside, 'TASKS.md');
    const outsideContents = '# External tasks\n';
    const marker = path.join(toolsDirectory, 'swapped');
    const statWrapper = path.join(toolsDirectory, 'stat');
    fs.writeFileSync(outsideTasks, outsideContents, 'utf8');
    fs.writeFileSync(statWrapper, `#!/bin/bash
set -eu
actual=/usr/bin/stat
target="\${!#}"
if [[ "$target" == */TASKS.md ]] && [ -f "$WORKBENCH_TEST_TASK_ROOT/.workbench/task-sequence" ] && [ ! -e "$WORKBENCH_TEST_SWAP_MARKER" ]; then
  result=$("$actual" "$@")
  : > "$WORKBENCH_TEST_SWAP_MARKER"
  mv -- "$WORKBENCH_TEST_TASK_ROOT/TASKS.md" "$WORKBENCH_TEST_TASK_ROOT/TASKS.md-original"
  ln -s -- "$WORKBENCH_TEST_TASKS_OUTSIDE" "$WORKBENCH_TEST_TASK_ROOT/TASKS.md"
  printf '%s\\n' "$result"
  exit 0
fi
exec "$actual" "$@"
`, { mode: 0o755 });
    const oldEnvironment = {
      path: process.env.PATH,
      root: process.env.WORKBENCH_TEST_TASK_ROOT,
      marker: process.env.WORKBENCH_TEST_SWAP_MARKER,
      outside: process.env.WORKBENCH_TEST_TASKS_OUTSIDE,
    };
    process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
    process.env.WORKBENCH_TEST_TASK_ROOT = directory;
    process.env.WORKBENCH_TEST_SWAP_MARKER = marker;
    process.env.WORKBENCH_TEST_TASKS_OUTSIDE = outsideTasks;
    let rejected = false;
    try {
      await addProjectTask(workspace, { title: 'Anchored task append', priority: 'P1' })
        .catch(() => { rejected = true; });
      assert.equal(rejected, true, 'The replaced TASKS.md path should be rejected before append.');
      assert.equal(fs.readFileSync(outsideTasks, 'utf8'), outsideContents);
      assert.doesNotMatch(fs.readFileSync(path.join(directory, 'TASKS.md-original'), 'utf8'), /Anchored task append/);
    } finally {
      if (oldEnvironment.path === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnvironment.path;
      if (oldEnvironment.root === undefined) delete process.env.WORKBENCH_TEST_TASK_ROOT;
      else process.env.WORKBENCH_TEST_TASK_ROOT = oldEnvironment.root;
      if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_SWAP_MARKER;
      else process.env.WORKBENCH_TEST_SWAP_MARKER = oldEnvironment.marker;
      if (oldEnvironment.outside === undefined) delete process.env.WORKBENCH_TEST_TASKS_OUTSIDE;
      else process.env.WORKBENCH_TEST_TASKS_OUTSIDE = oldEnvironment.outside;
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(toolsDirectory, { recursive: true, force: true });
    }
  });
});

test('does not follow a workspace-root replacement after resolution', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-root-race-'));
  const originalDirectory = `${directory}-original`;
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-root-race-outside-'));
  const toolsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-root-race-tools-'));
  const marker = path.join(toolsDirectory, 'swapped');
  const realpathWrapper = path.join(toolsDirectory, 'realpath');
  const workspace: Workspace = {
    id: 'workspace', name: 'Project', description: '', icon: 'code', distro: 'Local Linux',
    root: directory, commands: [], contextItems: [],
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  };
  fs.writeFileSync(realpathWrapper, `#!/bin/bash
set -eu
actual=/usr/bin/realpath
target="\${!#}"
resolved=$("$actual" "$@")
if [ "$target" = "$WORKBENCH_TEST_ROOT_PATH" ] && [ ! -e "$WORKBENCH_TEST_SWAP_MARKER" ]; then
  : > "$WORKBENCH_TEST_SWAP_MARKER"
  mv -- "$WORKBENCH_TEST_ROOT_PATH" "$WORKBENCH_TEST_ROOT_PATH-original"
  ln -s -- "$WORKBENCH_TEST_ROOT_OUTSIDE" "$WORKBENCH_TEST_ROOT_PATH"
fi
printf '%s\\n' "$resolved"
`, { mode: 0o755 });
  const oldEnvironment = {
    path: process.env.PATH,
    root: process.env.WORKBENCH_TEST_ROOT_PATH,
    marker: process.env.WORKBENCH_TEST_SWAP_MARKER,
    outside: process.env.WORKBENCH_TEST_ROOT_OUTSIDE,
  };
  process.env.PATH = `${toolsDirectory}:${oldEnvironment.path ?? ''}`;
  process.env.WORKBENCH_TEST_ROOT_PATH = directory;
  process.env.WORKBENCH_TEST_SWAP_MARKER = marker;
  process.env.WORKBENCH_TEST_ROOT_OUTSIDE = outside;
  try {
    await assert.rejects(initializeProjectSystem(workspace), /Workspace root changed during validation/);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.deepEqual(fs.readdirSync(originalDirectory), []);
  } finally {
    if (oldEnvironment.path === undefined) delete process.env.PATH;
    else process.env.PATH = oldEnvironment.path;
    if (oldEnvironment.root === undefined) delete process.env.WORKBENCH_TEST_ROOT_PATH;
    else process.env.WORKBENCH_TEST_ROOT_PATH = oldEnvironment.root;
    if (oldEnvironment.marker === undefined) delete process.env.WORKBENCH_TEST_SWAP_MARKER;
    else process.env.WORKBENCH_TEST_SWAP_MARKER = oldEnvironment.marker;
    if (oldEnvironment.outside === undefined) delete process.env.WORKBENCH_TEST_ROOT_OUTSIDE;
    else process.env.WORKBENCH_TEST_ROOT_OUTSIDE = oldEnvironment.outside;
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(originalDirectory, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(toolsDirectory, { recursive: true, force: true });
  }
});

test('classifies project-file symlinks as unsafe before reserving or staging', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    await initializeProjectSystem(workspace);
    const linkedDirectory = path.join(directory, 'workflow');
    const linkedTasks = path.join(linkedDirectory, 'tasks.md');
    const tasksPath = path.join(directory, 'TASKS.md');
    fs.mkdirSync(linkedDirectory);
    fs.renameSync(tasksPath, linkedTasks);
    fs.symlinkSync('workflow/tasks.md', tasksPath);
    const inspected = await inspectProjectSystem(workspace);
    assert.equal(inspected.files.find((file) => file.name === 'TASKS.md')?.safe, false);
    assert.equal(inspected.ready, false);
    await assert.rejects(addProjectTask(workspace, {
      title: 'Rejected symlink task',
      priority: 'P1',
      images: [{ name: 'clipboard.png', mediaType: 'image/png', bytes: tinyPng() }],
    }), /unsafe project-file symlink/);
    assert.doesNotMatch(fs.readFileSync(linkedTasks, 'utf8'), /Rejected symlink task/);
    assert.equal(fs.existsSync(path.join(directory, '.workbench/task-sequence')), false);
    assert.equal(fs.existsSync(path.join(directory, '.workbench/task-images')), false);
  });
});

test('refuses to follow an escaping project-file symlink', async () => {
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

test('refuses a hard-linked task file without modifying its external inode', async () => {
  await temporaryWorkspace(async (workspace, directory) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-hardlink-outside-'));
    const outsideTasks = path.join(outside, 'TASKS.md');
    const original = '# External tasks\n';
    fs.writeFileSync(outsideTasks, original, 'utf8');
    fs.linkSync(outsideTasks, path.join(directory, 'TASKS.md'));
    try {
      const inspected = await inspectProjectSystem(workspace);
      assert.equal(inspected.files.find((file) => file.name === 'TASKS.md')?.safe, false);
      await assert.rejects(
        addProjectTask(workspace, { title: 'Must stay local', priority: 'P1' }),
        /multiply linked/,
      );
      assert.equal(fs.readFileSync(outsideTasks, 'utf8'), original);
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
