// @vitest-environment jsdom
/* IKHW5S AudioSpeedBar 调速发送条组件测试（对齐 AudioTrimBar 测试接缝）：六要素
   （X/标题/倍速滑杆/当前值/⚡0 徽标 + 发送钮，无格式下拉）、发送守卫（1.00x 置灰、
   滑离点亮、滑回置灰）、滑杆位置↔倍速派发走契约映射、submitting 只读、锚样式透传。
   渲染模式沿用 AudioTrimBar 测试（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** 滑杆拖到指定位置（0~1000 整数）：经原生 value setter 绕过 React 受控 tracker 后
 *  派发 input 事件（React onChange 通道；直接赋值 DOM 会被 tracker 判定值未变而吞掉） */
async function dragSliderTo(pos: number) {
  const slider = container!.querySelector<HTMLInputElement>('[data-testid="audio-speed-slider"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(slider, String(pos));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
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
    // 调速 API 无格式参数（父单决策）：发送条无任何格式控件与格式文案
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
    // 受控滑杆位置 = 契约 speedToPos：1.0 → 500（中点）、1.35 → 558
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
    // 各位置独立渲染断言（受控组件值未变化不触发 onChange——位置 500 须自其他初速拖回）
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
    // posToSpeed(123)：raw = 0.1 + (123/500)*0.9 ≈ 0.3214 → 量化 0.05 网格 → 0.30
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
