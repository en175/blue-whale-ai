
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export interface CancelShortcutEvent {
  key: string;
  defaultPrevented: boolean;
  targetTagName?: string | undefined;
  isEditable?: boolean | undefined;
  inOverlay?: boolean | undefined;
  isMainComposer?: boolean | undefined;
}

export function shouldCancelOnKey(event: CancelShortcutEvent): boolean {
  if (event.key !== 'Escape') return false;
  if (event.defaultPrevented) return false;
  if (event.inOverlay) return false;
  if (event.isMainComposer) return true;
  if (event.isEditable) return false;
  const tagName = event.targetTagName;
  if (tagName === undefined) return false;
  return !TEXT_ENTRY_TAGS.has(tagName);
}
