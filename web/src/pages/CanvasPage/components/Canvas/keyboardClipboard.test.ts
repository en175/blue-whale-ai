// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  canvasClipboardKeyAction,
  copyableSelectedCanvasNodes,
  type CanvasClipboardKeyInput,
} from './keyboardClipboard';

/** 无修饰干扰的基线输入（每个用例按需覆盖字段） */
function baseInput(overrides: Partial<CanvasClipboardKeyInput> = {}): CanvasClipboardKeyInput {
  return {
    key: 'c',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    target: document.body,
    mentionMenuOpen: false,
    ...overrides,
  };
}

describe('canvasClipboardKeyAction', () => {
  it('responds to Cmd+C / Cmd+V on macOS (metaKey)', () => {
    expect(canvasClipboardKeyAction(baseInput({ key: 'c', metaKey: true }))).toBe('copy');
    expect(canvasClipboardKeyAction(baseInput({ key: 'v', metaKey: true }))).toBe('paste');
  });

  it('responds to Ctrl+C / Ctrl+V on Windows (ctrlKey)', () => {
    expect(canvasClipboardKeyAction(baseInput({ key: 'c', ctrlKey: true }))).toBe('copy');
    expect(canvasClipboardKeyAction(baseInput({ key: 'v', ctrlKey: true }))).toBe('paste');
  });

  it('matches key case-insensitively', () => {
    expect(canvasClipboardKeyAction(baseInput({ key: 'C', metaKey: true }))).toBe('copy');
    expect(canvasClipboardKeyAction(baseInput({ key: 'V', ctrlKey: true }))).toBe('paste');
  });

  it('ignores plain c / v without the clipboard modifier', () => {
    expect(canvasClipboardKeyAction(baseInput({ key: 'c' }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'v' }))).toBe('ignore');
  });

  it('ignores other modifier combos (keep browser/devtools semantics)', () => {
    expect(canvasClipboardKeyAction(baseInput({ key: 'c', metaKey: true, shiftKey: true }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'C', ctrlKey: true, shiftKey: true }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'v', metaKey: true, shiftKey: true }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'v', ctrlKey: true, shiftKey: true }))).toBe('ignore');
  });

  it('ignores other Cmd/Ctrl keys (D duplicate, A select-all, G group, Z undo keep their own handlers)', () => {
    expect(canvasClipboardKeyAction(baseInput({ key: 'd', metaKey: true }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'a', ctrlKey: true }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'g', metaKey: true }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'z', ctrlKey: true }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'x', metaKey: true }))).toBe('ignore');
  });

  it('yields to native behavior in INPUT / TEXTAREA / contentEditable', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editor = document.createElement('div');
    editor.contentEditable = 'true';

    for (const target of [input, textarea, editor]) {
      expect(canvasClipboardKeyAction(baseInput({ key: 'c', metaKey: true, target }))).toBe('ignore');
      expect(canvasClipboardKeyAction(baseInput({ key: 'v', ctrlKey: true, target }))).toBe('ignore');
    }
  });

  it('yields to native behavior for descendants of a contentEditable editor', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    const inner = document.createElement('span');
    editor.appendChild(inner);

    expect(canvasClipboardKeyAction(baseInput({ key: 'c', metaKey: true, target: inner }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'v', metaKey: true, target: inner }))).toBe('ignore');
  });

  it('yields while the @ mention menu is open (menu owns the keyboard)', () => {
    expect(canvasClipboardKeyAction(baseInput({ key: 'c', metaKey: true, mentionMenuOpen: true }))).toBe('ignore');
    expect(canvasClipboardKeyAction(baseInput({ key: 'v', ctrlKey: true, mentionMenuOpen: true }))).toBe('ignore');
  });
});

describe('copyableSelectedCanvasNodes', () => {
  it('collects selected text and media node ids only', () => {
    expect(
      copyableSelectedCanvasNodes([
        { id: 't1', type: 'textNode', selected: true },
        { id: 'm1', type: 'mediaNode', selected: true },
        { id: 't2', type: 'textNode', selected: false },
      ]),
    ).toEqual(['t1', 'm1']);
  });

  it('silently drops product and asset cards even when selected', () => {
    expect(
      copyableSelectedCanvasNodes([
        { id: 'p1', type: 'productNode', selected: true },
        { id: 'a1', type: 'assetNode', selected: true },
        { id: 't1', type: 'textNode', selected: true },
      ]),
    ).toEqual(['t1']);
  });

  it('returns empty for a product/asset-only selection', () => {
    expect(
      copyableSelectedCanvasNodes([
        { id: 'p1', type: 'productNode', selected: true },
        { id: 'a1', type: 'assetNode', selected: true },
      ]),
    ).toEqual([]);
  });

  it('returns empty when nothing is selected', () => {
    expect(
      copyableSelectedCanvasNodes([
        { id: 't1', type: 'textNode' },
        { id: 'm1', type: 'mediaNode', selected: false },
      ]),
    ).toEqual([]);
  });
});
