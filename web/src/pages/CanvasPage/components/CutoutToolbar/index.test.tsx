// @vitest-environment jsdom
/* CutoutToolbar 抠图工具栏组件（IKGXMT）：横条结构（X/场景上拉/增强控件显隐/本期免费/
   发送钮——Dock 主发送钮同款图标钮，IKGZ5Q）、
   场景上拉开合与选择、描边上拉（启用开关+宽度滑杆实时生效+禁用态）、透明裁剪点亮开关、
   发送置灰与 title 原因、X 关闭。渲染模式 createRoot + act，
   只断言外部可见行为。 */
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

/** 受控重渲染：组件无内部参数态，父级 state 变化经 props 回流 */
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
    // 无标题字：横条文本只由控件文案构成
    expect(el('cutout-toolbar').textContent.startsWith('抠图')).toBe(false);
  });

  it('场景上拉：默认收起，点触发钮展开三项（通用/人像/商品），选择后触发钮跟随、菜单收起', async () => {
    await renderToolbar();
    expect(el('cutout-scene-menu')).toBeNull();
    await click('cutout-scene-trigger');
    // 只取菜单项（role=menuitem），排除触发钮与菜单容器自身
    const items = [...mountNode.querySelectorAll('[data-testid^="cutout-scene-"][role="menuitem"]')];
    expect(items.map((n) => n.textContent)).toEqual(['通用', '人像', '商品']);
    // 每项悬停说明（规格故事 7）
    expect(el('cutout-scene-human').getAttribute('title')).toContain('人物');
    await click('cutout-scene-human');
    expect(handlers.onSceneChange).toHaveBeenCalledWith('human');
    expect(el('cutout-scene-menu')).toBeNull();
    // 受控回流：父级切到人像后触发钮文案跟随
    await renderToolbar();
    expect(btn('cutout-scene-trigger').textContent).toContain('人像');
  });

  it('场景上拉：再点触发钮关闭；点外关闭（document pointerdown）', async () => {
    await renderToolbar();
    await click('cutout-scene-trigger');
    expect(el('cutout-scene-menu')).not.toBeNull();
    await click('cutout-scene-trigger'); // 再点关闭（规格故事 17）
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
    expect(range.disabled).toBe(true); // 描边未开启时宽度不可调
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
      // React valueTracker 守卫：清 tracker 后派发 input，onChange 才会触发
      const tracker = (range as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
      tracker?.setValue('');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(handlers.onContourSizeChange).toHaveBeenCalledWith(33);
    // 开关回调（组件不持参，父级受控）
    await click('cutout-contour-toggle');
    expect(handlers.onNeedContourChange).toHaveBeenCalledWith(false);
    // 透明裁剪点亮开关
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
    // Dock 同款形态：白 ↑ 图标（ArrowUp）；置灰态不带激活类（IKGZ5Q）
    expect(send.querySelector('svg.lucide-arrow-up')).toBeTruthy();
    expect(send.className).not.toMatch(/sendBtnActive/);
    await act(async () => {
      send.click();
    });
    expect(handlers.onSend).not.toHaveBeenCalled();
    // 可发（精校通过）：激活态带 sendBtnActive
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
