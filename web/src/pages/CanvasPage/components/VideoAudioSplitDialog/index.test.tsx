// @vitest-environment jsdom
/* IKH28U 音视频分离编辑态工具条/占位发送条组件测试：上条仅 X 退出（无框选/开关/
   撤销重做——本工具无画布操作）、下条为占位发送条（三要素与发送闭环归 IKH28X）、
   两条 territory 标记、锚样式透传与 X 回调透传。渲染模式沿用 VideoSubtitleEraseDialog
   测试（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoAudioSplitDialog from './index';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const closeMock = vi.fn();

function renderDialog(props: Partial<Parameters<typeof VideoAudioSplitDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(VideoAudioSplitDialog, {
        onClose: closeMock,
        toolbarAnchor: null,
        sendBarAnchor: null,
        ...props,
      } as Parameters<typeof VideoAudioSplitDialog>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

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

describe('IKH28U 工具条与占位发送条呈现', () => {
  it('上条仅含 X 退出（无框选/开关/撤销重做）；下条占位发送条无三要素（归 IKH28X）', () => {
    renderDialog();
    expect(btn('audio-video-split-close')).toBeTruthy();
    const toolbar = container!.querySelector('[data-testid="audio-video-split-toolbar"]')!;
    expect(toolbar.querySelectorAll('button').length).toBe(1);
    expect(toolbar.textContent).not.toContain('全画面文字');
    const sendBar = container!.querySelector('[data-testid="audio-video-split-send-bar"]')!;
    expect(sendBar.textContent).toContain('发送功能即将可用');
    // 三要素（格式下拉/本期免费/发送钮）本票不实现，占位条无任何按钮
    expect(sendBar.querySelectorAll('button').length).toBe(0);
    expect(sendBar.textContent).not.toContain('本期免费');
  });

  it('两条浮条均标记 data-gen-panel-territory（豁免点外关闭误杀）', () => {
    renderDialog();
    expect(container!.querySelector('[data-testid="audio-video-split-toolbar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
    expect(container!.querySelector('[data-testid="audio-video-split-send-bar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
  });

  it('X 悬停说明退出语义（未发送不建任务不建卡）', () => {
    renderDialog();
    expect(btn('audio-video-split-close').getAttribute('title')).toContain('未发送不建任务不建卡');
  });
});

describe('IKH28U 锚样式与回调透传', () => {
  it('X 点击透传 onClose', async () => {
    renderDialog();
    await act(async () => {
      btn('audio-video-split-close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('锚锚定时 inline left/top 生效（无锚不注入 style 定位）', () => {
    renderDialog({ toolbarAnchor: { left: 120, top: 40 }, sendBarAnchor: { left: 100, top: 300 } });
    const toolbar = container!.querySelector('[data-testid="audio-video-split-toolbar"]') as HTMLElement;
    expect(toolbar.style.left).toBe('120px');
    expect(toolbar.style.top).toBe('40px');
    const sendBar = container!.querySelector('[data-testid="audio-video-split-send-bar"]') as HTMLElement;
    expect(sendBar.style.left).toBe('100px');
    expect(sendBar.style.top).toBe('300px');
    expect(sendBar.className).toContain('sendBarFollow'); // 跟随锚解除默认 bottom 定位
    renderDialog({ toolbarAnchor: null, sendBarAnchor: null });
    const unanchoredBar = container!.querySelector('[data-testid="audio-video-split-send-bar"]') as HTMLElement;
    expect(unanchoredBar.className).not.toContain('sendBarFollow');
    const unanchored = container!.querySelector('[data-testid="audio-video-split-toolbar"]') as HTMLElement;
    expect(unanchored.style.left).toBe('');
  });
});
