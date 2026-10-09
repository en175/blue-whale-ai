// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { $getSelection, $isRangeSelection } from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromptRefEditor, { type PromptRefEditorHandle } from './index';
import { promptRefCaretOffset, promptRefEditorInstance, readPromptRefText, typePromptRefRaw } from '../../testing/promptRefEditor';

let root: Root;
let container: HTMLDivElement;
let handle: PromptRefEditorHandle | null;
let onMentionChange: ReturnType<typeof vi.fn>;

async function renderEditor() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onMentionChange = vi.fn();
  handle = null;
  await act(async () => root.render(createElement(PromptRefEditor, {
    ref: (h: PromptRefEditorHandle | null) => { handle = h; },
    labelOf: () => '图片1',
    reconcileKey: 'k',
    labels: new Map([['a1', '图片1']]),
    refsMeta: new Map(),
    onChange: vi.fn(),
    onMentionChange,
  })));
}

async function openMentionQuery() {
  await typePromptRefRaw(container, '看@猫');
  await vi.waitFor(() => expect(onMentionChange).toHaveBeenCalledWith({ open: true, query: '猫' }));
}

function stealFocus(): HTMLInputElement {
  const thief = document.createElement('input');
  document.body.append(thief);
  thief.focus();
  return thief;
}

async function typeAtCaret(text: string) {
  const editor = promptRefEditorInstance(container);
  await act(async () => {
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) sel.insertRawText(text);
    });
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('IKFXOR @ 菜单关闭后的焦点与光标', () => {
  it('Esc 取消：光标落回 @ 之后、编辑器重新聚焦，可继续直接打字', async () => {
    await renderEditor();
    await openMentionQuery();
    const thief = stealFocus();
    const editor = promptRefEditorInstance(container);
    const focusSpy = vi.spyOn(editor, 'focus');
    await act(async () => { handle!.dismissMention(true); });
    expect(focusSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(promptRefCaretOffset(container)).toBe(3));
    expect(onMentionChange).toHaveBeenLastCalledWith({ open: false, query: '' });
    await typeAtCaret('好');
    expect(readPromptRefText(container)).toBe('看@猫好');
    thief.remove();
  });

  it('选中素材：标签原位替换、光标落标签后、编辑器保持聚焦', async () => {
    await renderEditor();
    await openMentionQuery();
    const thief = stealFocus();
    const editor = promptRefEditorInstance(container);
    const focusSpy = vi.spyOn(editor, 'focus');
    await act(async () => { handle!.insertRefAtMention({ kind: 'asset_ref', id: 'a1' }); });
    await vi.waitFor(() => expect(focusSpy).toHaveBeenCalledTimes(1));
    expect(readPromptRefText(container)).toBe('看图片1');
    await typeAtCaret('!');
    expect(readPromptRefText(container)).toBe('看图片1!');
    thief.remove();
  });

  it('点外关闭：维持现状不抢焦点、光标保持原位', async () => {
    await renderEditor();
    await openMentionQuery();
    const thief = stealFocus();
    const editor = promptRefEditorInstance(container);
    const focusSpy = vi.spyOn(editor, 'focus');
    await act(async () => { handle!.dismissMention(); });
    await act(async () => { await Promise.resolve(); });
    expect(focusSpy).not.toHaveBeenCalled();
    expect(promptRefCaretOffset(container)).toBe(3);
    expect(readPromptRefText(container)).toBe('看@猫');
    thief.remove();
  });
});
