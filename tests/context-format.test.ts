import test from 'node:test';
import assert from 'node:assert/strict';
import { formatContextPack } from '../src/main/context-format';
import type { GitStatus, Workspace } from '../src/shared/types';

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Curve Server',
  description: 'JPY curve infrastructure',
  icon: 'chart',
  distro: 'Ubuntu',
  root: '/home/kabes/curve-server',
  commands: [],
  contextItems: [
    { id: 'note', type: 'note', label: 'Constraint', value: 'Dependencies are non-linear.', includeContent: true },
    { id: 'link', type: 'url', label: 'Documentation', value: 'https://example.com/docs', includeContent: true },
    { id: 'file', type: 'file', label: 'README', value: 'README.md', includeContent: true },
  ],
  codexModel: null,
  codexEffort: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};

const git: GitStatus = {
  isRepository: true,
  branch: 'feature/dependencies',
  upstream: 'origin/feature/dependencies',
  ahead: 2,
  behind: 0,
  staged: 1,
  changed: 2,
  untracked: 1,
  clean: false,
  raw: '',
};

test('formats project metadata, notes, links, files, and a request placeholder', () => {
  const markdown = formatContextPack({
    workspace,
    git,
    generatedAt: new Date('2026-08-28T10:00:00.000Z'),
    files: [{
      item: workspace.contextItems[2],
      absolutePath: '/home/kabes/curve-server/README.md',
      content: '# Curve Server\n\nUses ``` inside the file.',
      truncated: true,
    }],
  });

  assert.match(markdown, /# Workbench Context Pack/);
  assert.match(markdown, /Branch: feature\/dependencies/);
  assert.match(markdown, /Dependencies are non-linear\./);
  assert.match(markdown, /\[Documentation\]\(https:\/\/example\.com\/docs\)/);
  assert.match(markdown, /Path: `\/home\/kabes\/curve-server\/README\.md`/);
  assert.match(markdown, /Content truncated/);
  assert.match(markdown, /<Describe the task or question here/);
  assert.match(markdown, /````markdown/);
});

test('reports unreadable files without inventing content', () => {
  const markdown = formatContextPack({
    workspace,
    git: { ...git, isRepository: false, error: 'Not a repository.' },
    generatedAt: new Date('2026-08-28T10:00:00.000Z'),
    files: [{
      item: workspace.contextItems[2],
      absolutePath: '/home/kabes/curve-server/README.md',
      content: '',
      truncated: false,
      error: 'File not found',
    }],
  });
  assert.match(markdown, /Could not read this file: File not found/);
  assert.match(markdown, /Not available: Not a repository\./);
});
