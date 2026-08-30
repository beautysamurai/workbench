import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanCodexModelPreference,
  codexThreadModelOverrides,
  codexThreadStartModelOverrides,
} from '../src/main/codex-session';

test('serializes model choices as Codex thread-scoped protocol overrides', () => {
  const preference = { model: ' gpt-5.6-sol ', effort: ' high ' };
  assert.deepEqual(cleanCodexModelPreference(preference), { model: 'gpt-5.6-sol', effort: 'high' });
  assert.deepEqual(codexThreadStartModelOverrides(preference), {
    model: 'gpt-5.6-sol',
    config: { model_reasoning_effort: 'high' },
  });
  assert.deepEqual(codexThreadModelOverrides(preference), {
    model: 'gpt-5.6-sol',
    effort: 'high',
  });
});

test('rejects malformed model preferences at the privileged IPC boundary', () => {
  assert.throws(() => cleanCodexModelPreference(null), /session model preference/);
  assert.throws(() => cleanCodexModelPreference({ model: 'safe\nunsafe', effort: 'high' }), /model is invalid/i);
  assert.throws(() => cleanCodexModelPreference({ model: 'sol', effort: 'x'.repeat(41) }), /effort is invalid/i);
});
