import type { CodexModelPreference } from '../shared/types';

interface CodexThreadStartModelOverrides {
  model?: string;
  config?: { model_reasoning_effort: string };
}

interface CodexThreadModelOverrides {
  model?: string;
  effort?: string;
}

function cleanOptionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Error(`${label} is invalid.`);
  }
  return text;
}

export function cleanCodexModelPreference(value: unknown): CodexModelPreference {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A Codex session model preference is required.');
  }
  const candidate = value as Partial<CodexModelPreference>;
  return {
    model: cleanOptionalText(candidate.model, 'Codex model', 160),
    effort: cleanOptionalText(candidate.effort, 'Codex reasoning effort', 40),
  };
}

export function codexThreadStartModelOverrides(value: unknown): CodexThreadStartModelOverrides {
  const preference = cleanCodexModelPreference(value);
  return {
    ...(preference.model ? { model: preference.model } : {}),
    ...(preference.effort
      ? { config: { model_reasoning_effort: preference.effort } }
      : {}),
  };
}

export function codexThreadModelOverrides(value: unknown): CodexThreadModelOverrides {
  const preference = cleanCodexModelPreference(value);
  return {
    ...(preference.model ? { model: preference.model } : {}),
    ...(preference.effort ? { effort: preference.effort } : {}),
  };
}
