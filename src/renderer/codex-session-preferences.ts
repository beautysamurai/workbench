import type { CodexModelPreference } from '../shared/types.js';

function copyPreference(preference: CodexModelPreference): CodexModelPreference {
  return { model: preference.model, effort: preference.effort };
}

export class CodexSessionPreferences {
  private readonly draftsByWorkspace = new Map<string, CodexModelPreference>();
  private readonly preferencesByThread = new Map<string, CodexModelPreference>();
  private readonly workspacesByThread = new Map<string, string>();

  get(workspaceId: string, threadId: string | null): CodexModelPreference | null {
    const preference = threadId
      ? this.preferencesByThread.get(threadId)
      : this.draftsByWorkspace.get(workspaceId);
    return preference ? copyPreference(preference) : null;
  }

  set(workspaceId: string, threadId: string | null, preference: CodexModelPreference): void {
    const target = threadId ? this.preferencesByThread : this.draftsByWorkspace;
    target.set(threadId ?? workspaceId, copyPreference(preference));
    if (threadId) this.workspacesByThread.set(threadId, workspaceId);
  }

  workspaceIdForThread(threadId: string): string | null {
    return this.workspacesByThread.get(threadId) ?? null;
  }

  deleteThread(threadId: string): void {
    this.preferencesByThread.delete(threadId);
    this.workspacesByThread.delete(threadId);
  }

  deleteWorkspace(workspaceId: string): void {
    this.draftsByWorkspace.delete(workspaceId);
    for (const [threadId, ownerWorkspaceId] of this.workspacesByThread) {
      if (ownerWorkspaceId === workspaceId) this.deleteThread(threadId);
    }
  }
}
