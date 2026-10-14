// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CutoutToolbar from './index';
import type { ImageCutoutScene } from '../../imageCutout';

type ToolbarProps = ComponentProps<typeof CutoutToolbar>;

type ToolbarState = {
  scene: ImageCutoutScene;
  needContour: boolean;
  contourSize: number;
  needCropBackground: boolean;
};

let root: Root;
let mountNode: HTMLDivElement;
let state: ToolbarState;
const handlers = {
  onClose: vi.fn(),
  onSceneChange: vi.fn((scene: ImageCutoutScene) => {
    state.scene = scene;
  }),
  onNeedContourChange: vi.fn((enabled: boolean) => {
    state.needContour = enabled;
  }),
  onContourSizeChange: vi.fn((size: number) => {
    state.contourSize = size;
  }),
  onNeedCropBackgroundChange: vi.fn((enabled: boolean) => {
    state.needCropBackground = enabled;
  }),
  onSend: vi.fn(() => true),
};

async function renderToolbar(props: Partial<ToolbarProps> = {}) {
  await act(async () => {
    root.render(
      createElement(CutoutToolbar, {
        ...handlers,
        scene: state.scene,
        needContour: state.needContour,
        contourSize: state.contourSize,
        needCropBackground: state.needCropBackground,
        sendDisabledReason: null,
        submitting: false,
        ...props,
      }),
    );
  });
}

function btn(testId: string): HTMLButtonElement {
  return mountNode.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

function el(testId: string): HTMLElement {
  return mountNode.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    btn(testId).click();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state = { scene: 'general', needContour: false, contourSize: 10, needCropBackground: false };
  vi.clearAllMocks();
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('CutoutToolbar（抠图横条工具栏）', () => {
  it('横条完整呈现：X、场景触发钮（显示当前场景）、本期免费、发送钮；无标题字', async () => {
    await renderToolbar();
    expect(btn('cutout-close')).toBeTruthy();
    expect(btn('cutout-scene-trigger').textContent).toContain('通用');
    expect(el('cutout-toolbar').textContent).toContain('本期免费');
    expect(btn('cutout-send-btn')).toBeTruthy();
    expect(el('cutout-toolbar').textContent.startsWith('抠图')).toBe(false);
  });

  it('场景上拉：默认收起，点触发钮展开三项（通用/人像/商品），选择后触发钮跟随、菜单收起', async () => {
    await renderToolbar();
    expect(el('cutout-scene-menu')).toBeNull();
    await click('cutout-scene-trigger');
    const items = [...mountNode.querySelectorAll('[data-testid^="cutout-scene-"][role="menuitem"]')];
    expect(items.map((n) => n.textContent)).toEqual(['通用', '人像', '商品']);
    expect(el('cutout-scene-human').getAttribute('title')).toContain('人物');
    await click('cutout-scene-human');
    expect(handlers.onSceneChange).toHaveBeenCalledWith('human');
    expect(el('cutout-scene-menu')).toBeNull();
    await renderToolbar();
    expect(btn('cutout-scene-trigger').textContent).toContain('人像');
  });

  it('场景上拉：再点触发钮关闭；点外关闭（document pointerdown）', async () => {
    await renderToolbar();
    await click('cutout-scene-trigger');
    expect(el('cutout-scene-menu')).not.toBeNull();
    await click('cutout-scene-trigger');
    expect(el('cutout-scene-menu')).toBeNull();
    await click('cutout-scene-trigger');
    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(el('cutout-scene-menu')).toBeNull();
  });

  it('通用场景：描边与透明裁剪两组增强控件不渲染（隐藏而非置灰，规格故事 9）', async () => {
    await renderToolbar();
    expect(mountNode.querySelector('[data-testid="cutout-contour-trigger"]')).toBeNull();
    expect(mountNode.querySelector('[data-testid="cutout-crop-toggle"]')).toBeNull();
  });

  it('人像/商品场景：描边上拉与透明裁剪出现；描边面板含启用开关与 1~50 滑杆', async () => {
    state.scene = 'human';
    await renderToolbar();
    expect(btn('cutout-contour-trigger')).toBeTruthy();
    expect(btn('cutout-crop-toggle')).toBeTruthy();
    await click('cutout-contour-trigger');
    expect(el('cutout-contour-menu')).not.toBeNull();
    const range = mountNode.querySelector<HTMLInputElement>('[data-testid="cutout-contour-size"]')!;
    expect(range.min).toBe('1');
    expect(range.max).toBe('50');
    expect(range.disabled).toBe(true);
    expect(btn('cutout-contour-toggle').getAttribute('aria-checked')).toBe('false');
  });

  it('描边开关点亮后滑杆实时生效（onChange 直传父级）；透明裁剪点亮开关切换', async () => {
    state.scene = 'product';
    state.needContour = true;
    state.contourSize = 10;
    await renderToolbar();
    await click('cutout-contour-trigger');
    const range = mountNode.querySelector<HTMLInputElement>('[data-testid="cutout-contour-size"]')!;
    expect(range.disabled).toBe(false);
    await act(async () => {
      range.value = '33';
      const tracker = (range as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
      tracker?.setValue('');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(handlers.onContourSizeChange).toHaveBeenCalledWith(33);
    await click('cutout-contour-toggle');
    expect(handlers.onNeedContourChange).toHaveBeenCalledWith(false);
    expect(btn('cutout-crop-toggle').getAttribute('aria-checked')).toBe('false');
    await click('cutout-crop-toggle');
    expect(handlers.onNeedCropBackgroundChange).toHaveBeenCalledWith(true);
  });

  it('发送钮：Dock 主发送钮同款图标钮（白 ↑ 图标）+ 置灰/激活两态；场景档超限置灰并 title 原因；可发时点击派发 onSend', async () => {
    state.scene = 'human';
    await renderToolbar({ sendDisabledReason: '图片长边超过 7680 或短边超过 4320，无法以当前场景抠图' });
    const send = btn('cutout-send-btn');
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('title')).toContain('7680');
    expect(send.querySelector('svg.lucide-arrow-up')).toBeTruthy();
    expect(send.className).not.toMatch(/sendBtnActive/);
    await act(async () => {
      send.click();
    });
    expect(handlers.onSend).not.toHaveBeenCalled();
    await renderToolbar({ sendDisabledReason: null });
    expect(btn('cutout-send-btn').disabled).toBe(false);
    expect(btn('cutout-send-btn').className).toMatch(/sendBtnActive/);
    await click('cutout-send-btn');
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
  });

  it('X 关闭派发 onClose', async () => {
    await renderToolbar();
    await click('cutout-close');
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('IKI61N 描边宽度滑杆键盘操作（Esc 退出会话，组件内自闭环）', () => {
  async function openContourSlider() {
    state.scene = 'human';
    state.needContour = true;
    await renderToolbar();
    await click('cutout-contour-trigger');
    const range = mountNode.querySelector<HTMLInputElement>('[data-testid="cutout-contour-size"]')!;
    expect(range.disabled).toBe(false);
    return range;
  }

  it('滑杆聚焦按 Esc：派发 onClose 退出会话并阻断冒泡（专属/公共 Esc 链不二次处理）', async () => {
    const range = await openContourSlider();
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => {
      range.dispatchEvent(event);
    });
    window.removeEventListener('keydown', windowSpy);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(windowSpy).not.toHaveBeenCalled();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it('滑杆原生属性保持 step=1 / 1~50（方向键步进语义由原生承担，组件不拦截）', async () => {
    const range = await openContourSlider();
    expect(range.step).toBe('1');
    expect(range.min).toBe('1');
    expect(range.max).toBe('50');
  });
});
