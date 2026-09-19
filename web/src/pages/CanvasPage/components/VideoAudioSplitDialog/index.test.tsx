// @vitest-environment jsdom
/* IKH28U 骨架 / IKH28X 三要素：音视频分离编辑态工具条与发送条组件测试。上条仅 X 退出
   （无框选/开关/撤销重做——本工具无画布操作）；下条三要素 = 分离格式下拉（触发钮显当前
   格式、展开五选一、当前项高亮）+「本期免费」标注（无「输出最高」后缀）+ 发送钮
   （submitting 置灰与回调透传）；两条 territory 标记、锚样式透传。渲染模式沿用
   VideoSubtitleEraseDialog 测试（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoAudioSplitDialog from './index';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const closeMock = vi.fn();
const formatChangeMock = vi.fn();
const sendMock = vi.fn();

function renderDialog(props: Partial<Parameters<typeof VideoAudioSplitDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(VideoAudioSplitDialog, {
        onClose: closeMock,
        format: 'm4a',
        onFormatChange: formatChangeMock,
        onSend: sendMock,
        toolbarAnchor: null,
        sendBarAnchor: null,
        ...props,
      } as Parameters<typeof VideoAudioSplitDialog>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function click(testId: string) {
  await act(async () => {
    btn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

describe('IKH28U 工具条呈现', () => {
  it('上条仅含 X 退出（无框选/开关/撤销重做）', () => {
    renderDialog();
    expect(btn('audio-video-split-close')).toBeTruthy();
    const toolbar = container!.querySelector('[data-testid="audio-video-split-toolbar"]')!;
    expect(toolbar.querySelectorAll('button').length).toBe(1);
    expect(toolbar.textContent).not.toContain('全画面文字');
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

  it('X 点击透传 onClose', async () => {
    renderDialog();
    await click('audio-video-split-close');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});

describe('IKH28X 发送条三要素', () => {
  it('三要素齐备：格式触发钮显当前格式（默认 M4A）、「本期免费」标注、发送钮', () => {
    renderDialog();
    const sendBar = container!.querySelector('[data-testid="audio-video-split-send-bar"]')!;
    expect(btn('audio-video-split-format-trigger').textContent).toBe('M4A');
    expect(sendBar.textContent).toContain('本期免费');
    // 音频无分辨率降级概念：不带去字幕的「输出最高」后缀
    expect(sendBar.textContent).not.toContain('输出最高');
    expect(btn('audio-video-split-send-btn')).toBeTruthy();
    // 占位文案已随三要素移除
    expect(sendBar.textContent).not.toContain('发送功能即将可用');
  });

  it('触发钮显示切换后的所选格式（受控值回填）', () => {
    renderDialog({ format: 'wav' });
    expect(btn('audio-video-split-format-trigger').textContent).toBe('WAV');
  });

  it('下拉展开五选一、当前项高亮；选择派发 onFormatChange 并收起菜单', async () => {
    renderDialog({ format: 'mp3' });
    expect(container!.querySelector('[data-testid="audio-video-split-format-menu"]')).toBeNull();
    await click('audio-video-split-format-trigger');
    const menu = container!.querySelector('[data-testid="audio-video-split-format-menu"]')!;
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    expect(Array.from(items).map((el) => el.textContent)).toEqual(['M4A', 'MP3', 'OGG', 'FLAC', 'WAV']);
    // 当前项 mp3 高亮（aria-checked + 激活样式）
    expect(btn('audio-video-split-format-item-mp3').getAttribute('aria-checked')).toBe('true');
    expect(btn('audio-video-split-format-item-m4a').getAttribute('aria-checked')).toBe('false');
    await click('audio-video-split-format-item-wav');
    expect(formatChangeMock).toHaveBeenCalledWith('wav');
    // 选择后菜单收起
    expect(container!.querySelector('[data-testid="audio-video-split-format-menu"]')).toBeNull();
  });

  it('发送钮激活态点击透传 onSend', async () => {
    renderDialog();
    await click('audio-video-split-send-btn');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('submitting 只读：下拉与发送置灰不可点', async () => {
    renderDialog({ submitting: true });
    expect(btn('audio-video-split-format-trigger').disabled).toBe(true);
    const sendBtn = btn('audio-video-split-send-btn');
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.className).not.toContain('sendBtnActive');
    await click('audio-video-split-send-btn');
    expect(sendMock).not.toHaveBeenCalled();
    await click('audio-video-split-format-trigger');
    expect(container!.querySelector('[data-testid="audio-video-split-format-menu"]')).toBeNull();
  });

  it('点外关闭格式菜单', async () => {
    renderDialog();
    await click('audio-video-split-format-trigger');
    expect(container!.querySelector('[data-testid="audio-video-split-format-menu"]')).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container!.querySelector('[data-testid="audio-video-split-format-menu"]')).toBeNull();
  });
});

describe('锚样式透传', () => {
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
