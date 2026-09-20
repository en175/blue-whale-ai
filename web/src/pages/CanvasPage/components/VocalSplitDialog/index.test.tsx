// @vitest-environment jsdom
/* IKHA2W 人声背景分离编辑态工具条与发送条组件测试。上条仅 X 退出（无框选/开关/撤销
   重做——本工具无画布操作）；下条要素 = 场景下拉（触发钮显当前场景中文、展开四选一、
   当前项高亮、菜单项 title 携带产出轨数说明）+ 格式下拉（五选一，契约五值）+
   「本期免费」标注 + 发送钮（submitting 置灰与回调透传）；两下拉点击展开/向上弹/
   点外与选择即收起/互斥展开；两条 territory 标记、锚样式透传。渲染模式沿用
   VideoAudioSplitDialog 测试（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VocalSplitDialog from './index';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const closeMock = vi.fn();
const sceneChangeMock = vi.fn();
const formatChangeMock = vi.fn();
const sendMock = vi.fn();

function renderDialog(props: Partial<Parameters<typeof VocalSplitDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(VocalSplitDialog, {
        onClose: closeMock,
        scene: 'audio',
        onSceneChange: sceneChangeMock,
        format: 'aac',
        onFormatChange: formatChangeMock,
        onSend: sendMock,
        toolbarAnchor: null,
        sendBarAnchor: null,
        ...props,
      } as Parameters<typeof VocalSplitDialog>[0]),
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

describe('工具条呈现', () => {
  it('上条仅含 X 退出（无框选/开关/撤销重做）', () => {
    renderDialog();
    expect(btn('vocal-split-close')).toBeTruthy();
    const toolbar = container!.querySelector('[data-testid="vocal-split-toolbar"]')!;
    expect(toolbar.querySelectorAll('button').length).toBe(1);
  });

  it('两条浮条均标记 data-gen-panel-territory（豁免点外关闭误杀）', () => {
    renderDialog();
    expect(container!.querySelector('[data-testid="vocal-split-toolbar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
    expect(container!.querySelector('[data-testid="vocal-split-send-bar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
  });

  it('X 悬停说明退出语义（未发送不建任务不建卡）', () => {
    renderDialog();
    expect(btn('vocal-split-close').getAttribute('title')).toContain('未发送不建任务不建卡');
  });

  it('X 点击透传 onClose', async () => {
    renderDialog();
    await click('vocal-split-close');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});

describe('发送条要素：场景下拉 + 格式下拉 + 本期免费 + 发送钮', () => {
  it('默认态：场景触发钮显「通用」、格式触发钮显 AAC、本期免费标注齐备', () => {
    renderDialog();
    const sendBar = container!.querySelector('[data-testid="vocal-split-send-bar"]')!;
    expect(btn('vocal-split-scene-trigger').textContent).toBe('通用');
    expect(btn('vocal-split-format-trigger').textContent).toBe('AAC');
    expect(sendBar.textContent).toContain('本期免费');
    expect(sendBar.textContent).not.toContain('输出最高');
    expect(btn('vocal-split-send-btn')).toBeTruthy();
  });

  it('场景下拉点击展开四选一、当前项高亮；菜单项 title 携带产出轨数说明', async () => {
    renderDialog({ scene: 'drama' });
    expect(container!.querySelector('[data-testid="vocal-split-scene-menu"]')).toBeNull();
    await click('vocal-split-scene-trigger');
    const menu = container!.querySelector('[data-testid="vocal-split-scene-menu"]')!;
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    expect(Array.from(items).map((el) => el.textContent)).toEqual(['通用', '音乐', '短剧', '口播']);
    expect(btn('vocal-split-scene-item-drama').getAttribute('aria-checked')).toBe('true');
    expect(btn('vocal-split-scene-item-audio').getAttribute('aria-checked')).toBe('false');
    // 产出轨数 hint（title）：两轨/三轨按场景分叉
    expect(btn('vocal-split-scene-item-audio').getAttribute('title')).toBe('人声+背景音两轨');
    expect(btn('vocal-split-scene-item-music').getAttribute('title')).toBe('人声+背景音两轨');
    expect(btn('vocal-split-scene-item-drama').getAttribute('title')).toBe('人声/音乐/音效三轨');
    expect(btn('vocal-split-scene-item-narrate').getAttribute('title')).toBe('人声/音乐/音效三轨');
    await click('vocal-split-scene-item-music');
    expect(sceneChangeMock).toHaveBeenCalledWith('music');
    expect(container!.querySelector('[data-testid="vocal-split-scene-menu"]')).toBeNull();
  });

  it('格式下拉点击展开五选一（契约五值）、当前项高亮；选择派发 onFormatChange 并收起', async () => {
    renderDialog({ format: 'mp3' });
    await click('vocal-split-format-trigger');
    const menu = container!.querySelector('[data-testid="vocal-split-format-menu"]')!;
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    expect(Array.from(items).map((el) => el.textContent)).toEqual(['AAC', 'MP3', 'WAV', 'M4A', 'FLAC']);
    expect(btn('vocal-split-format-item-mp3').getAttribute('aria-checked')).toBe('true');
    await click('vocal-split-format-item-flac');
    expect(formatChangeMock).toHaveBeenCalledWith('flac');
    expect(container!.querySelector('[data-testid="vocal-split-format-menu"]')).toBeNull();
  });

  it('两下拉互斥展开：展开场景再点格式，场景菜单收起', async () => {
    renderDialog();
    await click('vocal-split-scene-trigger');
    expect(container!.querySelector('[data-testid="vocal-split-scene-menu"]')).toBeTruthy();
    await click('vocal-split-format-trigger');
    expect(container!.querySelector('[data-testid="vocal-split-scene-menu"]')).toBeNull();
    expect(container!.querySelector('[data-testid="vocal-split-format-menu"]')).toBeTruthy();
  });

  it('点外关闭已展开的下拉', async () => {
    renderDialog();
    await click('vocal-split-format-trigger');
    expect(container!.querySelector('[data-testid="vocal-split-format-menu"]')).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container!.querySelector('[data-testid="vocal-split-format-menu"]')).toBeNull();
  });

  it('发送钮激活态点击透传 onSend', async () => {
    renderDialog();
    await click('vocal-split-send-btn');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('submitting 只读：双下拉与发送置灰不可点', async () => {
    renderDialog({ submitting: true });
    expect(btn('vocal-split-scene-trigger').disabled).toBe(true);
    expect(btn('vocal-split-format-trigger').disabled).toBe(true);
    const sendBtn = btn('vocal-split-send-btn');
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.className).not.toContain('sendBtnActive');
    await click('vocal-split-send-btn');
    expect(sendMock).not.toHaveBeenCalled();
    await click('vocal-split-scene-trigger');
    expect(container!.querySelector('[data-testid="vocal-split-scene-menu"]')).toBeNull();
    await click('vocal-split-format-trigger');
    expect(container!.querySelector('[data-testid="vocal-split-format-menu"]')).toBeNull();
  });
});

describe('锚样式透传', () => {
  it('锚锚定时 inline left/top 生效（无锚不注入 style 定位）', () => {
    renderDialog({ toolbarAnchor: { left: 120, top: 40 }, sendBarAnchor: { left: 100, top: 300 } });
    const toolbar = container!.querySelector('[data-testid="vocal-split-toolbar"]') as HTMLElement;
    expect(toolbar.style.left).toBe('120px');
    expect(toolbar.style.top).toBe('40px');
    const sendBar = container!.querySelector('[data-testid="vocal-split-send-bar"]') as HTMLElement;
    expect(sendBar.style.left).toBe('100px');
    expect(sendBar.style.top).toBe('300px');
    expect(sendBar.className).toContain('sendBarFollow');
    renderDialog({ toolbarAnchor: null, sendBarAnchor: null });
    const unanchoredBar = container!.querySelector('[data-testid="vocal-split-send-bar"]') as HTMLElement;
    expect(unanchoredBar.className).not.toContain('sendBarFollow');
  });
});
