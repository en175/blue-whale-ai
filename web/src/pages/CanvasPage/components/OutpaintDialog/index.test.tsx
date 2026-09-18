// @vitest-environment jsdom
/* 扩图工具栏组件测试（验收拍板改版横条：比例预设收进上拉菜单）：
   工具栏控件清单与默认命中、菜单开合（触发按钮 toggle / 选完即关 / 点外关闭）、
   预设点选回调、不可达置灰与悬停原因、自定义被动状态（菜单顶部 + 触发按钮文案跟随）、
   关闭 X；字段矩阵（张数禁用展示、本期免费文案、零扩展发送置灰、拖出扩展后发送可点）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OutpaintDialog from './index';
import type { ExpandSides } from '../../imageOutpaint';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let presetMock: ReturnType<typeof vi.fn>;
let closeMock: ReturnType<typeof vi.fn>;
let sendMock: ReturnType<typeof vi.fn>;

/** 400×300 源图：短边 300、单方向上限 120。16:9 需左右各扩 66.67 可达。 */
const SOURCE = { width: 400, height: 300 };

function renderPanel(props: Partial<Parameters<typeof OutpaintDialog>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(OutpaintDialog, {
        onClose: closeMock,
        sourceSize: SOURCE,
        expands: { top: 0, right: 0, bottom: 0, left: 0 },
        onPresetSelect: presetMock,
        onSend: sendMock,
        ...props,
      } as Parameters<typeof OutpaintDialog>[0]),
    );
  });
}

const btn = (testId: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 打开比例上拉菜单（预设项均在菜单内渲染） */
async function openMenu() {
  await click(btn('outpaint-ratio-trigger'));
}

const ZERO: ExpandSides = { top: 0, right: 0, bottom: 0, left: 0 };

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  presetMock = vi.fn();
  closeMock = vi.fn();
  sendMock = vi.fn(() => true);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.clearAllMocks();
});

describe('工具栏骨架渲染', () => {
  it('横条清单：关闭 X / 比例触发钮 / 1张 / 本期免费 / 发送钮；默认（零扩展）触发钮文案为原图比例', () => {
    renderPanel({ expands: ZERO });
    expect(btn('outpaint-close')).toBeTruthy();
    expect(btn('outpaint-ratio-trigger').textContent).toBe('原图比例');
    expect(btn('outpaint-count').textContent).toBe('1张');
    expect(container!.textContent).toContain('本期免费');
    expect(btn('outpaint-send-btn')).toBeTruthy();
    // 菜单默认收起，预设项不渲染
    expect(container!.querySelector('[data-testid="outpaint-ratio-menu"]')).toBeNull();
  });

  it('关闭 X 触发 onClose', async () => {
    renderPanel();
    await click(btn('outpaint-close'));
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});

describe('比例上拉菜单', () => {
  it('触发按钮开合菜单：六预设 + 自定义被动项；零扩展默认命中原图比例', async () => {
    renderPanel({ expands: ZERO });
    await openMenu();
    const menu = container!.querySelector('[data-testid="outpaint-ratio-menu"]')!;
    expect(menu).toBeTruthy();
    for (const key of ['original', '1-1', '4-3', '3-4', '16-9', '9-16']) {
      expect(btn(`outpaint-preset-${key}`), key).toBeTruthy();
    }
    expect(btn('outpaint-preset-original').className).toMatch(/menuItemActive/);
    expect(btn('outpaint-preset-1-1').className).not.toMatch(/menuItemActive/);
    const custom = container!.querySelector('[data-testid="outpaint-preset-custom"]')!;
    expect(custom.className).not.toMatch(/menuChipActive/);
    // 再点触发按钮收起
    await openMenu();
    expect(container!.querySelector('[data-testid="outpaint-ratio-menu"]')).toBeNull();
  });

  it('点预设：上抛 preset key 且菜单即收起', async () => {
    renderPanel();
    await openMenu();
    await click(btn('outpaint-preset-16-9'));
    expect(presetMock).toHaveBeenCalledWith('16:9');
    expect(container!.querySelector('[data-testid="outpaint-ratio-menu"]')).toBeNull();
    await openMenu();
    await click(btn('outpaint-preset-original'));
    expect(presetMock).toHaveBeenCalledWith('original');
  });

  it('菜单打开时点击外部（document pointerdown）关闭菜单', async () => {
    renderPanel();
    await openMenu();
    expect(container!.querySelector('[data-testid="outpaint-ratio-menu"]')).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(container!.querySelector('[data-testid="outpaint-ratio-menu"]')).toBeNull();
  });
});

describe('字段矩阵（张数 / 免费文案 / 发送钮）', () => {
  it('张数控件固定「1张」禁用展示，悬停说明多张未开放', () => {
    renderPanel();
    const count = btn('outpaint-count');
    expect(count.textContent).toBe('1张');
    expect(count.disabled).toBe(true);
    expect(count.getAttribute('title')).toContain('多张');
    // 无多张选项：张数控件只有这一个按钮
    expect(container!.textContent).not.toContain('2张');
    expect(container!.textContent).not.toContain('4张');
  });

  it('「本期免费」文案在工具栏；不渲染积分预估 / 分辨率 / 画质档位 / 提示词 / 参考栏', () => {
    renderPanel();
    expect(container!.textContent).toContain('本期免费');
    expect(container!.textContent).not.toContain('积分');
    expect(container!.textContent).not.toContain('分辨率');
    expect(container!.textContent).not.toContain('画质');
    expect(container!.querySelector('textarea')).toBeNull();
  });

  it('零扩展（框与原图重合）发送钮置灰并悬停原因，点击不触发 onSend', async () => {
    renderPanel({ expands: ZERO });
    const send = btn('outpaint-send-btn');
    expect(send.disabled).toBe(true);
    expect(send.title).toContain('拖动扩展框');
    await click(send);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('拖出扩展后发送钮可点：触发 onSend（工具栏关闭与退出模式由父级承接）', async () => {
    renderPanel({ expands: { top: 30, right: 60, bottom: 0, left: 0 } });
    const send = btn('outpaint-send-btn');
    expect(send.disabled).toBe(false);
    expect(send.title).toBe('发送');
    await click(send);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe('预设联动与命中显示', () => {
  it('手动拖拽后的非标准比例：自定义被动项高亮（非按钮不可点选），触发钮文案切「自定义」', async () => {
    // 框 460×300 ≈ 1.533 非标准比例
    renderPanel({ expands: { top: 0, right: 60, bottom: 0, left: 0 } });
    expect(btn('outpaint-ratio-trigger').textContent).toBe('自定义');
    await openMenu();
    const custom = container!.querySelector('[data-testid="outpaint-preset-custom"]')!;
    expect(custom.className).toMatch(/menuChipActive/);
    expect(custom.tagName).toBe('SPAN');
    // 无预设高亮
    for (const key of ['original', '1-1', '4-3', '3-4', '16-9', '9-16']) {
      expect(btn(`outpaint-preset-${key}`).className).not.toMatch(/menuItemActive/);
    }
  });

  it('拖到恰好 16:9 的框：触发钮文案与 16:9 菜单项高亮同步', async () => {
    const half = (300 * (16 / 9) - 400) / 2;
    renderPanel({ expands: { top: 0, right: half, bottom: 0, left: half } });
    expect(btn('outpaint-ratio-trigger').textContent).toBe('16:9');
    await openMenu();
    expect(btn('outpaint-preset-16-9').className).toMatch(/menuItemActive/);
  });
});

describe('不可达预设置灰', () => {
  it('极端窄长图（800×100）：非原图比例预设置灰并悬停原因，点击不触发', async () => {
    // 短边 100、上限 40：1:1 需上下各扩 350 不可达；原图比例恒可达
    renderPanel({ sourceSize: { width: 800, height: 100 } });
    await openMenu();
    const r11 = btn('outpaint-preset-1-1');
    expect(r11.getAttribute('aria-disabled')).toBe('true');
    expect(r11.getAttribute('title')).toContain('40%');
    expect(r11.getAttribute('title')).toContain('1:1');
    await click(r11);
    expect(presetMock).not.toHaveBeenCalled();
    // 原图比例恒可达且命中（零扩展）
    const original = btn('outpaint-preset-original');
    expect(original.getAttribute('aria-disabled')).toBeNull();
    expect(original.className).toMatch(/menuItemActive/);
    await click(original);
    expect(presetMock).toHaveBeenCalledWith('original');
    expect(container!.querySelector('[data-testid="outpaint-ratio-menu"]')).toBeNull();
  });
});
