import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldShowCodexItemInTranscript,
  shouldShowCodexNotificationInTranscript,
} from '../src/renderer/codex-transcript';

test('omits internal reasoning items from the Codex transcript', () => {
  assert.equal(shouldShowCodexItemInTranscript({ type: 'reasoning', summary: [] }), false);
  assert.equal(shouldShowCodexItemInTranscript({ type: 'agentMessage', text: 'Done.' }), true);
});

test('omits streamed reasoning notifications from the Codex transcript', () => {
  assert.equal(shouldShowCodexNotificationInTranscript('item/reasoning/summaryTextDelta'), false);
  assert.equal(shouldShowCodexNotificationInTranscript('item/reasoning/textDelta'), false);
  assert.equal(shouldShowCodexNotificationInTranscript('item/agentMessage/delta'), true);
});
