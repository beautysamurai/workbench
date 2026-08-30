import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexModelInfo, CodexRateLimits } from '../src/shared/types';
import {
  changeCodexModelPreference,
  chooseCodexModelPreference,
  rateLimitsFromNotification,
  remainingUsagePercent,
} from '../src/renderer/codex-metadata';

const models: CodexModelInfo[] = [
  {
    id: 'sol', model: 'sol', displayName: 'Sol', description: '', hidden: false, isDefault: true,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'high', description: '' }],
  },
  {
    id: 'terra', model: 'terra', displayName: 'Terra', description: '', hidden: false, isDefault: false,
    defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '' }],
  },
];

test('keeps valid model preferences and repairs stale selections from the live catalog', () => {
  assert.deepEqual(chooseCodexModelPreference(models, { model: 'sol', effort: 'high' }), { model: 'sol', effort: 'high' });
  assert.deepEqual(chooseCodexModelPreference(models, { model: 'removed', effort: 'ultra' }), { model: 'sol', effort: 'low' });
  assert.deepEqual(changeCodexModelPreference(models, { model: 'sol', effort: 'high' }, 'model', 'terra'), { model: 'terra', effort: 'medium' });
});

test('reports the remaining primary Codex quota and accepts rolling notifications', () => {
  const limits: CodexRateLimits = {
    rateLimits: { limitId: 'codex', limitName: null, primary: { usedPercent: 27.4, windowDurationMins: 300, resetsAt: 2_000_000_000 }, secondary: null },
  };
  assert.equal(remainingUsagePercent(limits), 73);
  assert.equal(remainingUsagePercent(rateLimitsFromNotification({ rateLimits: limits.rateLimits })), 73);
  assert.equal(rateLimitsFromNotification({}), null);
});
