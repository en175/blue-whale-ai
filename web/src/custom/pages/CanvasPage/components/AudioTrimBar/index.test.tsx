// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioTrimBar from './index';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const closeMock = vi.fn();
const formatChangeMock = vi.fn();
const sendMock = vi.fn();

function renderBar(props: Partial<Parameters<typeof AudioTrimBar>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(AudioTrimBar, {
        onClose: closeMock,
        start: 0,
        end: 15,
        format: 'mp3',
        onFormatChange: formatChangeMock,
        onSend: sendMock,
        anchor: null,
        ...props,
      } as Parameters<typeof AudioTrimBar>[0]),
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

describe('五要素呈现', () => {
  it('X、标题「截取」、时间范围、⚡0 徽标、发送钮齐备；无格式说明文字', () => {
    renderBar();
    expect(btn('audio-trim-close')).toBeTruthy();
    const sendBar = container!.querySelector('[data-testid="audio-trim-send-bar"]')!;
    expect(sendBar.textContent).toContain('截取');
    expect(container!.querySelector('[data-testid="audio-trim-range"]')!.textContent).toBe('00:00 - 00:15');
    expect(btn('audio-trim-send-btn')).toBeTruthy();
    expect(sendBar.textContent).not.toContain('输出');
    expect(sendBar.textContent).not.toContain('格式说明');
  });

  it('时间范围只读实时刷新（抓手拖拽联动选区后父级回传新值）', () => {
    renderBar({ start: 2.4, end: 13 });
    expect(container!.querySelector('[data-testid="audio-trim-range"]')!.textContent).toBe('00:02 - 00:13');
    renderBar({ start: 62, end: 125 });
    expect(container!.querySelector('[data-testid="audio-trim-range"]')!.textContent).toBe('01:02 - 02:05');
  });

  it('X 悬停说明退出语义（未发送不建任务不建卡）；点击透传 onClose', async () => {
    renderBar();
    expect(btn('audio-trim-close').getAttribute('title')).toContain('未发送不建任务不建卡');
    await click('audio-trim-close');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('发送条标记 data-gen-panel-territory（豁免点外关闭误杀）', () => {
    renderBar();
    expect(container!.querySelector('[data-testid="audio-trim-send-bar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
  });
});

describe('格式下拉（默认跟随源格式、五档、向上弹）', () => {
  it('触发钮显当前格式（小写对齐原型）；未展开时无菜单', () => {
    renderBar({ format: 'mp3' });
    expect(btn('audio-trim-format-trigger').textContent).toBe('mp3');
    expect(container!.querySelector('[data-testid="audio-trim-format-menu"]')).toBeNull();
  });

  it('展开五档（mp3/m4a/ogg/flac/wav）、当前项高亮；选择派发 onFormatChange 并收起', async () => {
    renderBar({ format: 'mp3' });
    await click('audio-trim-format-trigger');
    const menu = container!.querySelector('[data-testid="audio-trim-format-menu"]')!;
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    expect(Array.from(items).map((el) => el.textContent)).toEqual(['mp3', 'm4a', 'ogg', 'flac', 'wav']);
    expect(btn('audio-trim-format-item-mp3').getAttribute('aria-checked')).toBe('true');
    expect(btn('audio-trim-format-item-wav').getAttribute('aria-checked')).toBe('false');
    await click('audio-trim-format-item-wav');
    expect(formatChangeMock).toHaveBeenCalledWith('wav');
    expect(container!.querySelector('[data-testid="audio-trim-format-menu"]')).toBeNull();
  });

  it('菜单向上弹：menu 定位在触发钮上方（bottom 定位样式）', async () => {
    renderBar();
    await click('audio-trim-format-trigger');
    const menu = container!.querySelector('[data-testid="audio-trim-format-menu"]') as HTMLElement;
    expect(menu.className).toContain('formatMenu');
    expect(menu.className).not.toContain('undefined');
  });

  it('点外关闭格式菜单', async () => {
    renderBar();
    await click('audio-trim-format-trigger');
    expect(container!.querySelector('[data-testid="audio-trim-format-menu"]')).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container!.querySelector('[data-testid="audio-trim-format-menu"]')).toBeNull();
  });
});

describe('发送与只读态', () => {
  it('激活态点击透传 onSend', async () => {
    renderBar();
    await click('audio-trim-send-btn');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('submitting 只读：下拉与发送置灰不可点', async () => {
    renderBar({ submitting: true });
    expect(btn('audio-trim-format-trigger').disabled).toBe(true);
    const sendBtn = btn('audio-trim-send-btn');
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.className).not.toContain('sendBtnActive');
    await click('audio-trim-send-btn');
    expect(sendMock).not.toHaveBeenCalled();
    await click('audio-trim-format-trigger');
    expect(container!.querySelector('[data-testid="audio-trim-format-menu"]')).toBeNull();
  });
});

describe('锚样式透传', () => {
  it('锚锚定时 inline left/top 生效并解除默认 bottom；无锚不注入定位', () => {
    renderBar({ anchor: { left: 100, top: 300 } });
    const bar = container!.querySelector('[data-testid="audio-trim-send-bar"]') as HTMLElement;
    expect(bar.style.left).toBe('100px');
    expect(bar.style.top).toBe('300px');
    expect(bar.className).toContain('sendBarFollow');
    renderBar({ anchor: null });
    const unanchored = container!.querySelector('[data-testid="audio-trim-send-bar"]') as HTMLElement;
    expect(unanchored.style.left).toBe('');
    expect(unanchored.className).not.toContain('sendBarFollow');
  });
});
