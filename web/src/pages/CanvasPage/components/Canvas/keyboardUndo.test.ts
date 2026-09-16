// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { canvasUndoKeyAction, isMentionMenuOpen, type CanvasUndoKeyInput } from './keyboardUndo';

function press(overrides: Partial<CanvasUndoKeyInput> = {}): CanvasUndoKeyInput {
  return {
    key: 'z',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    target: document.body,
    mentionMenuOpen: false,
    ...overrides,
  };
}

describe('canvasUndoKeyAction', () => {
  it('treats Cmd+Z (macOS) and Ctrl+Z (Windows) as undo', () => {
    expect(canvasUndoKeyAction(press({ metaKey: true }))).toBe('undo');
    expect(canvasUndoKeyAction(press({ ctrlKey: true }))).toBe('undo');
  });

  it('treats Cmd/Ctrl+Shift+Z as redo, not undo', () => {
    expect(canvasUndoKeyAction(press({ metaKey: true, shiftKey: true }))).toBe('redo');
    expect(canvasUndoKeyAction(press({ ctrlKey: true, shiftKey: true }))).toBe('redo');
    // Shift 按下时浏览器派发的 key 为大写 Z，同样归一为重做
    expect(canvasUndoKeyAction(press({ metaKey: true, shiftKey: true, key: 'Z' }))).toBe('redo');
  });

  it('treats Ctrl/Cmd+Y as redo', () => {
    expect(canvasUndoKeyAction(press({ key: 'y', ctrlKey: true }))).toBe('redo');
    expect(canvasUndoKeyAction(press({ key: 'y', metaKey: true }))).toBe('redo');
    expect(canvasUndoKeyAction(press({ key: 'y', metaKey: true, shiftKey: true }))).toBe('redo');
  });

  it('ignores plain Z without modifier and unrelated keys', () => {
    expect(canvasUndoKeyAction(press())).toBe('ignore');
    expect(canvasUndoKeyAction(press({ shiftKey: true }))).toBe('ignore');
    expect(canvasUndoKeyAction(press({ metaKey: true, key: 'b' }))).toBe('ignore');
    expect(canvasUndoKeyAction(press({ ctrlKey: true, key: 'Delete' }))).toBe('ignore');
  });

  it('lets INPUT / TEXTAREA / contentEditable keep native undo', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editor = document.createElement('div');
    editor.contentEditable = 'true';

    expect(canvasUndoKeyAction(press({ metaKey: true, target: input }))).toBe('ignore');
    expect(canvasUndoKeyAction(press({ metaKey: true, target: textarea }))).toBe('ignore');
    expect(canvasUndoKeyAction(press({ metaKey: true, target: editor }))).toBe('ignore');
    expect(canvasUndoKeyAction(press({ ctrlKey: true, key: 'y', target: input }))).toBe('ignore');
  });

  it('ignores Z / Y while the @ mention menu is open (keyboard belongs to the menu)', () => {
    expect(canvasUndoKeyAction(press({ metaKey: true, mentionMenuOpen: true }))).toBe('ignore');
    expect(canvasUndoKeyAction(press({ ctrlKey: true, shiftKey: true, mentionMenuOpen: true }))).toBe('ignore');
    expect(canvasUndoKeyAction(press({ ctrlKey: true, key: 'y', mentionMenuOpen: true }))).toBe('ignore');
  });
});

describe('isMentionMenuOpen', () => {
  afterEach(() => {
    document.querySelectorAll('[data-canvas-keyboard-scope="mention"]').forEach((el) => el.remove());
  });

  it('reflects whether the mention menu is mounted in the DOM', () => {
    expect(isMentionMenuOpen()).toBe(false);
    const menu = document.createElement('div');
    menu.setAttribute('data-canvas-keyboard-scope', 'mention');
    document.body.appendChild(menu);
    expect(isMentionMenuOpen()).toBe(true);
    menu.remove();
    expect(isMentionMenuOpen()).toBe(false);
  });
});
