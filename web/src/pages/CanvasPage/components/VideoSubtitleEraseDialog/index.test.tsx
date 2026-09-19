// @vitest-environment jsdom
/* IKGZ83 去字幕编辑态工具条/发送条组件测试：控件齐全（框选/全画面文字开关/撤销/重做/X、
   本期免费+输出最高 1080P+发送）、开关两态受控、撤销重做与发送中置灰透传、
   框满置灰、发送钮始终可发（无框=智能模式，语义统一）。渲染模式沿用
   ImageEraseDialog 测试（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoSubtitleEraseDialog from './index';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const sendMock = vi.fn();
const fullTextChangeMock = vi.fn();
const undoMock = vi.fn();
const redoMock = vi.fn();
const closeMock = vi.fn();

function renderDialog(props: Partial<Parameters<typeof VideoSubtitleEraseDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(VideoSubtitleEraseDialog, {
        onClose: closeMock,
        onSend: sendMock,
        canUndo: false,
        canRedo: false,
        onUndo: undoMock,
        onRedo: redoMock,
        fullText: false,
        onFullTextChange: fullTextChangeMock,
        boxLimitReached: false,
        toolbarAnchor: null,
        sendBarAnchor: null,
        ...props,
      } as Parameters<typeof VideoSubtitleEraseDialog>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKGZ83 工具条与发送条呈现', () => {
  it('两条齐全：工具条框选/全画面文字开关/撤销/重做/X；发送条本期免费+输出最高 1080P+发送', () => {
    renderDialog();
    for (const id of ['subtitle-erase-tool-box', 'subtitle-erase-full-text-toggle', 'subtitle-erase-undo', 'subtitle-erase-redo', 'subtitle-erase-close']) {
      expect(btn(id), id).toBeTruthy();
    }
    expect(container!.querySelector('[data-testid="subtitle-erase-toolbar"]')!.textContent).toContain('全画面文字');
    const sendBar = container!.querySelector('[data-testid="subtitle-erase-send-bar"]')!;
    expect(sendBar.textContent).toContain('本期免费');
    expect(sendBar.textContent).toContain('输出最高 1080P');
    expect(btn('subtitle-erase-send-btn')).toBeTruthy();
  });

  it('两条浮条均标记 data-gen-panel-territory（豁免点外关闭误杀）', () => {
    renderDialog();
    expect(container!.querySelector('[data-testid="subtitle-erase-toolbar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
    expect(container!.querySelector('[data-testid="subtitle-erase-send-bar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
  });

  it('框选是唯一工具恒激活（aria-pressed=true）；框满时置灰并提示上限', () => {
    renderDialog();
    expect(btn('subtitle-erase-tool-box').getAttribute('aria-pressed')).toBe('true');
    renderDialog({ boxLimitReached: true });
    expect(btn('subtitle-erase-tool-box').disabled).toBe(true);
    expect(btn('subtitle-erase-tool-box').getAttribute('title')).toContain('20 个上限');
  });

  it('「全画面文字」开关悬停说明含顶部字幕指引（title 通道）', () => {
    renderDialog();
    expect(btn('subtitle-erase-full-text-toggle').getAttribute('title')).toContain('顶部字幕需开此开关');
  });
});

describe('IKGZ83 开关与回调透传', () => {
  it('开关两态受控：aria-checked 跟随 props，点击上抛取反', async () => {
    renderDialog();
    const toggle = btn('subtitle-erase-full-text-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await click(toggle);
    expect(fullTextChangeMock).toHaveBeenCalledWith(true);
    renderDialog({ fullText: true });
    expect(btn('subtitle-erase-full-text-toggle').getAttribute('aria-checked')).toBe('true');
    await click(btn('subtitle-erase-full-text-toggle'));
    expect(fullTextChangeMock).toHaveBeenCalledWith(false);
  });

  it('撤销/重做置灰透传：无操作禁用，可用时点击回调', async () => {
    renderDialog();
    expect(btn('subtitle-erase-undo').disabled).toBe(true);
    expect(btn('subtitle-erase-redo').disabled).toBe(true);
    renderDialog({ canUndo: true, canRedo: true });
    expect(btn('subtitle-erase-undo').disabled).toBe(false);
    expect(btn('subtitle-erase-redo').disabled).toBe(false);
    await click(btn('subtitle-erase-undo'));
    expect(undoMock).toHaveBeenCalledTimes(1);
    await click(btn('subtitle-erase-redo'));
    expect(redoMock).toHaveBeenCalledTimes(1);
  });

  it('X 关闭与发送回调透传；发送钮默认可发（无框=智能模式）', async () => {
    renderDialog();
    expect(btn('subtitle-erase-send-btn').disabled).toBe(false);
    await click(btn('subtitle-erase-send-btn'));
    expect(sendMock).toHaveBeenCalledTimes(1);
    await click(btn('subtitle-erase-close'));
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('发送中（submitting）：全部控件只读防重复提交', async () => {
    renderDialog({ submitting: true, canUndo: true, fullText: false });
    expect(btn('subtitle-erase-send-btn').disabled).toBe(true);
    expect(btn('subtitle-erase-undo').disabled).toBe(true);
    expect(btn('subtitle-erase-full-text-toggle').disabled).toBe(true);
    await click(btn('subtitle-erase-send-btn'));
    await click(btn('subtitle-erase-full-text-toggle'));
    expect(sendMock).not.toHaveBeenCalled();
    expect(fullTextChangeMock).not.toHaveBeenCalled();
  });
});
