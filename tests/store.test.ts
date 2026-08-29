import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkbenchStore } from '../src/main/store';

function withTemporaryStore(run: (store: WorkbenchStore, stateFile: string, directory: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-store-'));
  const stateFile = path.join(directory, 'workbench-state.json');
  try {
    run(new WorkbenchStore(stateFile), stateFile, directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('persists a validated workspace and reloads it', () => {
  withTemporaryStore((store, stateFile) => {
    const saved = store.saveWorkspace({
      name: ' Curve Server ',
      description: ' JPY pricing ',
      icon: 'chart',
      distro: ' Ubuntu ',
      root: '/home/dev/projects/curve-server/../curve-server',
      commands: [{ id: '', name: ' Test ', command: ' ./gradlew test ', description: '' }],
      contextItems: [],
    });

    assert.equal(saved.workspaces.length, 1);
    assert.equal(saved.workspaces[0].name, 'Curve Server');
    assert.equal(saved.workspaces[0].root, '/home/dev/projects/curve-server');
    assert.equal(saved.workspaces[0].commands[0].command, './gradlew test');
    assert.ok(fs.existsSync(stateFile));

    const reloaded = new WorkbenchStore(stateFile).getState();
    assert.equal(reloaded.selectedWorkspaceId, saved.workspaces[0].id);
    assert.equal(reloaded.workspaces[0].distro, 'Ubuntu');

    const preferred = store.saveCodexPreferences(
      saved.workspaces[0].id,
      'gpt-5.6-terra',
      'high',
    );
    assert.equal(preferred.workspaces[0].codexModel, 'gpt-5.6-terra');
    assert.equal(preferred.workspaces[0].codexEffort, 'high');
    const preferencesReloaded = new WorkbenchStore(stateFile).getState();
    assert.equal(preferencesReloaded.workspaces[0].codexModel, 'gpt-5.6-terra');
    assert.equal(preferencesReloaded.workspaces[0].codexEffort, 'high');
  });
});

test('rejects relative workspace roots', () => {
  withTemporaryStore((store) => {
    assert.throws(() => store.saveWorkspace({
      name: 'Bad',
      description: '',
      icon: 'folder',
      distro: 'Ubuntu',
      root: 'projects/bad',
      commands: [],
      contextItems: [],
    }), /absolute Linux path/);
  });
});

test('adds and removes context items without exposing mutable state', () => {
  withTemporaryStore((store) => {
    const initial = store.saveWorkspace({
      name: 'Research',
      description: '',
      icon: 'book',
      distro: 'Ubuntu',
      root: '/home/dev/research',
      commands: [],
      contextItems: [],
    });
    const workspaceId = initial.workspaces[0].id;
    const added = store.addContextItem(workspaceId, {
      type: 'note',
      label: 'Constraint',
      value: 'Keep the dependency graph non-linear.',
      includeContent: true,
    });
    assert.equal(added.workspaces[0].contextItems.length, 1);

    added.workspaces[0].name = 'Mutated outside store';
    assert.equal(store.getWorkspace(workspaceId).name, 'Research');

    const itemId = store.getWorkspace(workspaceId).contextItems[0].id;
    const removed = store.removeContextItem(workspaceId, itemId);
    assert.equal(removed.workspaces[0].contextItems.length, 0);
  });
});

test('backs up malformed state and starts clean', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-store-broken-'));
  const stateFile = path.join(directory, 'workbench-state.json');
  fs.writeFileSync(stateFile, '{not-json', 'utf8');
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const store = new WorkbenchStore(stateFile);
    assert.equal(store.getState().workspaces.length, 0);
    const backups = fs.readdirSync(directory).filter((name) => name.startsWith('workbench-state.json.broken-'));
    assert.equal(backups.length, 1);
  } finally {
    console.error = originalError;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
