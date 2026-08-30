import type {
  CodexModelInfo,
  CodexModelPreference,
  CodexRateLimits,
  CodexRateLimitSnapshot,
} from '../shared/types.js';

export function chooseCodexModelPreference(
  models: CodexModelInfo[],
  preference: CodexModelPreference | null,
  preserveUnavailable = false,
): CodexModelPreference {
  const visible = models.filter((model) => !model.hidden);
  const preferred = visible.find((model) => model.model === preference?.model);
  if (!preferred && preserveUnavailable && preference?.model) {
    return { model: preference.model, effort: preference.effort };
  }
  const selected = preferred
    ?? visible.find((model) => model.isDefault)
    ?? visible[0];
  if (!selected) return {
    model: preference?.model ?? null,
    effort: preference?.effort ?? null,
  };
  const efforts = selected.supportedReasoningEfforts.map((option) => option.reasoningEffort);
  return {
    model: selected.model,
    effort: preference?.effort && efforts.includes(preference.effort)
      ? preference.effort
      : selected.defaultReasoningEffort || efforts[0] || null,
  };
}

export function changeCodexModelPreference(
  models: CodexModelInfo[],
  current: CodexModelPreference,
  setting: 'model' | 'effort',
  value: string,
): CodexModelPreference {
  if (setting === 'model') {
    return chooseCodexModelPreference(models, { model: value, effort: null });
  }
  return chooseCodexModelPreference(models, { model: current.model, effort: value });
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
