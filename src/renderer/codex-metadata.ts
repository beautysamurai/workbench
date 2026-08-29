import type {
  CodexModelInfo,
  CodexRateLimits,
  CodexRateLimitSnapshot,
  Workspace,
} from '../shared/types.js';

export interface CodexModelPreference {
  model: string | null;
  effort: string | null;
}

export function chooseCodexModelPreference(
  models: CodexModelInfo[],
  workspace: Pick<Workspace, 'codexModel' | 'codexEffort'>,
): CodexModelPreference {
  const visible = models.filter((model) => !model.hidden);
  const selected = visible.find((model) => model.model === workspace.codexModel)
    ?? visible.find((model) => model.isDefault)
    ?? visible[0];
  if (!selected) return { model: null, effort: null };
  const efforts = selected.supportedReasoningEfforts.map((option) => option.reasoningEffort);
  return {
    model: selected.model,
    effort: workspace.codexEffort && efforts.includes(workspace.codexEffort)
      ? workspace.codexEffort
      : selected.defaultReasoningEffort || efforts[0] || null,
  };
}

export function primaryRateLimit(limits: CodexRateLimits | null | undefined): CodexRateLimitSnapshot | null {
  if (!limits) return null;
  return limits.rateLimitsByLimitId?.codex ?? limits.rateLimits ?? null;
}

export function remainingUsagePercent(limits: CodexRateLimits | null | undefined): number | null {
  const used = primaryRateLimit(limits)?.primary?.usedPercent;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  return Math.max(0, Math.min(100, Math.round(100 - used)));
}

export function rateLimitsFromNotification(params: Record<string, unknown>): CodexRateLimits | null {
  const rateLimits = params.rateLimits;
  if (!rateLimits || typeof rateLimits !== 'object' || Array.isArray(rateLimits)) return null;
  return { rateLimits: rateLimits as CodexRateLimitSnapshot };
}
