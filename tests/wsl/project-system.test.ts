import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Workspace } from '../../src/shared/types';
import {
  addProjectTask,
  initializeProjectSystem,
} from '../../src/main/project-system';

function temporaryWorkspace(run: (workspace: Workspace, directory: string) => Promise<void>): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-project-'));
  const workspace: Workspace = {
    id: 'workspace', name: 'Project', description: '', icon: 'code', distro: 'Local Linux',
    root: directory, commands: [], contextItems: [], codexModel: null, codexEffort: null,
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

    const updated = await addProjectTask(workspace, { title: 'Expose usage', objective: 'Show the remaining quota.' });
    assert.equal(updated.tasks.at(-1)?.title, 'Expose usage');
    assert.equal(updated.tasks.at(-1)?.state, 'pending');
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
