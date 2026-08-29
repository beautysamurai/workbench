import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_THREAD_SANDBOX_MODE,
  toCodexApprovalPolicy,
} from '../src/main/codex-protocol';

test('serializes every Workbench approval policy for the Codex app-server protocol', () => {
  assert.equal(toCodexApprovalPolicy('onRequest'), 'on-request');
  assert.equal(toCodexApprovalPolicy('unlessTrusted'), 'untrusted');
  assert.equal(toCodexApprovalPolicy('never'), 'never');
});

test('uses the Codex thread sandbox wire value', () => {
  assert.equal(CODEX_THREAD_SANDBOX_MODE, 'workspace-write');
});
