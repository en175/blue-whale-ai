
export interface CanvasKeyboardInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
  mentionMenuOpen: boolean;
}

export function isMentionMenuOpen(): boolean {
  return document.querySelector('[data-canvas-keyboard-scope="mention"]') !== null;
}
