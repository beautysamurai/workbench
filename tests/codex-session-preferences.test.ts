import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexSessionPreferences } from '../src/renderer/codex-session-preferences';

test('keeps model choices isolated between Codex threads and the next-thread draft', () => {
  const preferences = new CodexSessionPreferences();
  preferences.set('workspace', null, { model: 'draft-model', effort: 'medium' });
  preferences.set('workspace', 'thread-a', { model: 'model-a', effort: 'high' });
  preferences.set('workspace', 'thread-b', { model: 'model-b', effort: 'low' });

  assert.deepEqual(preferences.get('workspace', null), { model: 'draft-model', effort: 'medium' });
  assert.deepEqual(preferences.get('workspace', 'thread-a'), { model: 'model-a', effort: 'high' });
  assert.deepEqual(preferences.get('workspace', 'thread-b'), { model: 'model-b', effort: 'low' });

  const threadA = preferences.get('workspace', 'thread-a');
  if (threadA) threadA.model = 'mutated-copy';
  assert.equal(preferences.get('workspace', 'thread-a')?.model, 'model-a');
  assert.equal(preferences.workspaceIdForThread('thread-b'), 'workspace');

  preferences.deleteWorkspace('workspace');
  assert.equal(preferences.get('workspace', null), null);
  assert.equal(preferences.get('workspace', 'thread-a'), null);
});
