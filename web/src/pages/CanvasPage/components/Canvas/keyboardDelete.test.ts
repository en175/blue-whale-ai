// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  canvasDeleteKeyAction,
  deleteSelectedCanvasNodes,
  isEditableKeyboardTarget,
  selectedNodeIds,
} from './keyboardDelete';

describe('isEditableKeyboardTarget', () => {
  it('treats INPUT, TEXTAREA and contentEditable as editable', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editor = document.createElement('div');
    editor.contentEditable = 'true';

    expect(isEditableKeyboardTarget(input)).toBe(true);
    expect(isEditableKeyboardTarget(textarea)).toBe(true);
    expect(isEditableKeyboardTarget(editor)).toBe(true);
  });

  it('treats descendants of contentEditable as editable', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    const inner = document.createElement('span');
    editor.appendChild(inner);

    expect(isEditableKeyboardTarget(inner)).toBe(true);
  });

  it('does not treat ordinary canvas elements as editable', () => {
    expect(isEditableKeyboardTarget(document.createElement('div'))).toBe(false);
    expect(isEditableKeyboardTarget(document.body)).toBe(false);
    expect(isEditableKeyboardTarget(null)).toBe(false);
  });
});

describe('canvasDeleteKeyAction', () => {
  it('deletes selected nodes on Delete or Backspace outside editors', () => {
    expect(canvasDeleteKeyAction('Delete', document.body)).toBe('delete-selected');
    expect(canvasDeleteKeyAction('Backspace', document.body)).toBe('delete-selected');
  });

  it('keeps Delete in INPUT / TEXTAREA / contentEditable', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editor = document.createElement('div');
    editor.contentEditable = 'true';

    expect(canvasDeleteKeyAction('Delete', input)).toBe('ignore');
    expect(canvasDeleteKeyAction('Delete', textarea)).toBe('ignore');
    expect(canvasDeleteKeyAction('Delete', editor)).toBe('ignore');
    expect(canvasDeleteKeyAction('Backspace', input)).toBe('ignore');
    expect(canvasDeleteKeyAction('Backspace', editor)).toBe('ignore');
  });

  it('blocks Enter outside editors, ignores it inside', () => {
    const input = document.createElement('input');
    expect(canvasDeleteKeyAction('Enter', document.body)).toBe('block');
    expect(canvasDeleteKeyAction('Enter', input)).toBe('ignore');
  });

  it('ignores unrelated keys', () => {
    expect(canvasDeleteKeyAction('Escape', document.body)).toBe('ignore');
    expect(canvasDeleteKeyAction('a', document.body)).toBe('ignore');
  });
});

describe('selectedNodeIds', () => {
  it('returns only selected node ids', () => {
    expect(
      selectedNodeIds([
        { id: 'a', selected: true },
        { id: 'b', selected: false },
        { id: 'c' },
        { id: 'd', selected: true },
      ]),
    ).toEqual(['a', 'd']);
  });

  it('returns empty when nothing is selected', () => {
    expect(selectedNodeIds([{ id: 'a' }, { id: 'b', selected: false }])).toEqual([]);
  });
});

describe('deleteSelectedCanvasNodes', () => {
  it('deletes every selected node and skips unselected ones', () => {
    const deleted: string[] = [];
    const ids = deleteSelectedCanvasNodes(
      [
        { id: 'a', selected: true },
        { id: 'b', selected: false },
        { id: 'c', selected: true },
      ],
      (id) => deleted.push(id),
    );
    expect(ids).toEqual(['a', 'c']);
    expect(deleted).toEqual(['a', 'c']);
  });

  it('does nothing when no node is selected', () => {
    const deleted: string[] = [];
    expect(deleteSelectedCanvasNodes([{ id: 'a' }], (id) => deleted.push(id))).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
