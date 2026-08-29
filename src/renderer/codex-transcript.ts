export function shouldShowCodexItemInTranscript(item: Record<string, unknown>): boolean {
  return item.type !== 'reasoning';
}

export function shouldShowCodexNotificationInTranscript(method: string): boolean {
  return !method.startsWith('item/reasoning/');
}
