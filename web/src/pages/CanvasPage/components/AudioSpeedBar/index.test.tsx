// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speedToPos } from '@lib/contracts/audio-speed';
import AudioSpeedBar from './index';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const closeMock = vi.fn();
const speedChangeMock = vi.fn();
const sendMock = vi.fn();

function renderBar(props: Partial<Parameters<typeof AudioSpeedBar>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(AudioSpeedBar, {
        onClose: closeMock,
        speed: 1,
        onSpeedChange: speedChangeMock,
        onSend: sendMock,
        anchor: null,
        ...props,
      } as Parameters<typeof AudioSpeedBar>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function click(testId: string) {
  await act(async () => {
    btn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function dragSliderTo(pos: number) {
  const slider = container!.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(slider, String(pos));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pressKeyOnSlider(key: string) {
  const slider = container!.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => {
    slider.dispatchEvent(event);
  });
  return event;
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

describe('六要素呈现（无格式下拉）', () => {
  it('X、标题「调速」、滑杆、当前值、⚡0 徽标、发送钮齐备；滑杆域 0~1000', () => {
    renderBar();
    expect(btn('audio-speed-close')).toBeTruthy();
    const sendBar = container!.querySelector('[data-testid="audio-speed-send-bar"]')!;
    expect(sendBar.textContent).toContain('调速');
    const slider = container!.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('1000');
    expect(slider.step).toBe('1');
    expect(container!.querySelector('[data-testid="audio-speed-value"]')!.textContent).toBe('1.00x');
    expect(container!.querySelector('[data-testid="audio-speed-free"]')!.getAttribute('title')).toBe('本期免费');
    expect(btn('audio-speed-send-btn')).toBeTruthy();
    expect(sendBar.textContent).not.toContain('格式');
    expect(container!.querySelector('[data-testid^="audio-speed-format"]')).toBeNull();
  });

  it('刻度五行 0.1x/0.5x/1.0x 原速/2.0x/4.0x，原速凹槽存在；位置随受控倍速刷新（契约 speedToPos）', () => {
    renderBar();
    const tickText = (key: string) =>
      container!.querySelector<HTMLElement>(`[data-testid="audio-speed-tick-${key}"]`)!.textContent;
    expect(tickText('first')).toBe('0.1x');
    expect(tickText('0.5')).toBe('0.5x');
    expect(tickText('origin')).toBe('1.0x 原速');
    expect(tickText('2')).toBe('2.0x');
    expect(tickText('last')).toBe('4.0x');
    expect(container!.querySelector('[class*="notch"]')).toBeTruthy();
    const slider = () => container!.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!;
    expect(slider().value).toBe('500');
    renderBar({ speed: 1.35 });
    expect(slider().value).toBe('558');
    expect(container!.querySelector('[data-testid="audio-speed-value"]')!.textContent).toBe('1.35x');
  });

  it('X 悬停说明退出语义（未发送不建任务不建卡）；点击透传 onClose', async () => {
    renderBar();
    expect(btn('audio-speed-close').getAttribute('title')).toContain('未发送不建任务不建卡');
    await click('audio-speed-close');
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('发送条标记 data-gen-panel-territory（豁免点外关闭误杀）', () => {
    renderBar();
    expect(container!.querySelector('[data-testid="audio-speed-send-bar"]')!.hasAttribute('data-gen-panel-territory')).toBe(true);
  });
});

describe('发送守卫（1.00x 置灰、滑离点亮、滑回置灰）', () => {
  it('默认 1.00x 置灰：无激活类、点击不派发、title 悬停守卫原因', async () => {
    renderBar({ speed: 1 });
    const sendBtn = btn('audio-speed-send-btn');
    expect(sendBtn.className).not.toContain('sendBtnActive');
    expect(sendBtn.getAttribute('title')).toBe('滑离原速位后可发送');
    await click('audio-speed-send-btn');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('滑离 1.00x 点亮：激活类 + 点击派发 onSend、title 带所选倍速', async () => {
    renderBar({ speed: 1.5 });
    const sendBtn = btn('audio-speed-send-btn');
    expect(sendBtn.className).toContain('sendBtnActive');
    expect(sendBtn.getAttribute('title')).toBe('生成 1.50x 调速音频');
    await click('audio-speed-send-btn');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('滑回 1.00x 重新置灰（受控回传后同口径收敛）', async () => {
    renderBar({ speed: 1.5 });
    expect(btn('audio-speed-send-btn').className).toContain('sendBtnActive');
    renderBar({ speed: 1 });
    const sendBtn = btn('audio-speed-send-btn');
    expect(sendBtn.className).not.toContain('sendBtnActive');
    await click('audio-speed-send-btn');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('滑杆派发（位置↔倍速走契约映射）', () => {
  it('滑到右端 1000 派发 4.00x；拖回中点 500 派发 1.00x；左端 0 派发 0.10x', async () => {
    renderBar();
    await dragSliderTo(1000);
    expect(speedChangeMock).toHaveBeenLastCalledWith(4);

    renderBar({ speed: 4 });
    await dragSliderTo(500);
    expect(speedChangeMock).toHaveBeenLastCalledWith(1);

    renderBar({ speed: 4 });
    await dragSliderTo(0);
    expect(speedChangeMock).toHaveBeenLastCalledWith(0.1);
  });

  it('非网格位置按契约量化（0.05 步进）：位置 123 派发 0.30x', async () => {
    renderBar();
    await dragSliderTo(123);
    expect(speedChangeMock).toHaveBeenLastCalledWith(0.3);
  });
});

describe('submitting 只读态', () => {
  it('submitting：滑杆与发送置灰（disabled），发送点击不派发', async () => {
    renderBar({ speed: 1.5, submitting: true });
    expect(container!.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!.disabled).toBe(true);
    const sendBtn = btn('audio-speed-send-btn');
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.className).not.toContain('sendBtnActive');
    await click('audio-speed-send-btn');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('滑杆键盘操作（IKI4M6：方向键 0.05 步进 + Esc 退出）', () => {
  it('ArrowRight/ArrowUp 按 0.05 步进加速：1.00x→1.05x，并阻止原生 step=1 行为', async () => {
    renderBar({ speed: 1 });
    const e1 = await pressKeyOnSlider('ArrowRight');
    expect(speedChangeMock).toHaveBeenLastCalledWith(1.05);
    expect(e1.defaultPrevented).toBe(true);
    await pressKeyOnSlider('ArrowUp');
    expect(speedChangeMock).toHaveBeenLastCalledWith(1.05);
    expect(speedChangeMock).toHaveBeenCalledTimes(2);
  });

  it('ArrowLeft/ArrowDown 按 0.05 步进减速：1.00x→0.95x', async () => {
    renderBar({ speed: 1 });
    await pressKeyOnSlider('ArrowLeft');
    expect(speedChangeMock).toHaveBeenLastCalledWith(0.95);
    await pressKeyOnSlider('ArrowDown');
    expect(speedChangeMock).toHaveBeenLastCalledWith(0.95);
    expect(speedChangeMock).toHaveBeenCalledTimes(2);
  });

  it('非网格中间值按键同样按 0.05 步进：1.35x→1.40x / 1.30x（往返回中点 1.0x 一致）', async () => {
    renderBar({ speed: 1.35 });
    await pressKeyOnSlider('ArrowRight');
    expect(speedChangeMock).toHaveBeenLastCalledWith(1.4);
    renderBar({ speed: 1.35 });
    await pressKeyOnSlider('ArrowLeft');
    expect(speedChangeMock).toHaveBeenLastCalledWith(1.3);
    renderBar({ speed: 1.05 });
    await pressKeyOnSlider('ArrowLeft');
    expect(speedChangeMock).toHaveBeenLastCalledWith(1);
  });

  it('两端钳制：0.10x 再按左不派发、4.00x 再按右不派发', async () => {
    renderBar({ speed: 0.1 });
    await pressKeyOnSlider('ArrowLeft');
    await pressKeyOnSlider('ArrowDown');
    expect(speedChangeMock).not.toHaveBeenCalled();

    renderBar({ speed: 4 });
    await pressKeyOnSlider('ArrowRight');
    await pressKeyOnSlider('ArrowUp');
    expect(speedChangeMock).not.toHaveBeenCalled();
  });

  it('近端钳制：0.15x 按左到 0.10x 为止、3.95x 按右到 4.00x 为止', async () => {
    renderBar({ speed: 0.15 });
    await pressKeyOnSlider('ArrowLeft');
    expect(speedChangeMock).toHaveBeenLastCalledWith(0.1);
    renderBar({ speed: 3.95 });
    await pressKeyOnSlider('ArrowRight');
    expect(speedChangeMock).toHaveBeenLastCalledWith(4);
  });

  it('Esc 调 onClose 退出编辑态，并阻断冒泡（公共 Esc 链不二次处理）', async () => {
    renderBar({ speed: 1.5 });
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    const e = await pressKeyOnSlider('Escape');
    window.removeEventListener('keydown', windowSpy);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(windowSpy).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('submitting 时键盘操作无效：方向键不派发、Esc 不退出', async () => {
    renderBar({ speed: 1.5, submitting: true });
    await pressKeyOnSlider('ArrowRight');
    await pressKeyOnSlider('ArrowLeft');
    await pressKeyOnSlider('Escape');
    expect(speedChangeMock).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('键盘步进后受控回传：位置与显示值刷新（1.00x→1.05x 位置 508），拖动 onChange 路径不变', async () => {
    renderBar({ speed: 1 });
    await pressKeyOnSlider('ArrowRight');
    expect(speedChangeMock).toHaveBeenLastCalledWith(1.05);
    renderBar({ speed: 1.05 });
    const slider = container!.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!;
    expect(slider.value).toBe(String(speedToPos(1.05)));
    expect(container!.querySelector('[data-testid="audio-speed-value"]')!.textContent).toBe('1.05x');
    await dragSliderTo(123);
    expect(speedChangeMock).toHaveBeenLastCalledWith(0.3);
  });
});

describe('锚样式透传', () => {
  it('锚锚定时 inline left/top 生效并解除默认 bottom；无锚不注入定位', () => {
    renderBar({ anchor: { left: 100, top: 300 } });
    const bar = container!.querySelector('[data-testid="audio-speed-send-bar"]') as HTMLElement;
    expect(bar.style.left).toBe('100px');
    expect(bar.style.top).toBe('300px');
    expect(bar.className).toContain('sendBarFollow');
    renderBar({ anchor: null });
    const unanchored = container!.querySelector('[data-testid="audio-speed-send-bar"]') as HTMLElement;
    expect(unanchored.style.left).toBe('');
    expect(unanchored.className).not.toContain('sendBarFollow');
  });
});
