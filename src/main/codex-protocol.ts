import type { ApprovalPolicy } from '../shared/types';

export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export const CODEX_THREAD_SANDBOX_MODE: CodexSandboxMode = 'workspace-write';

const CODEX_APPROVAL_POLICIES: Record<ApprovalPolicy, CodexApprovalPolicy> = {
  onRequest: 'on-request',
  unlessTrusted: 'untrusted',
  never: 'never',
};

export function toCodexApprovalPolicy(policy: ApprovalPolicy): CodexApprovalPolicy {
  return CODEX_APPROVAL_POLICIES[policy];
}
