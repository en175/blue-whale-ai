// @vitest-environment jsdom
/* 裁切面板组件测试（IKGW1N）：六选项（自由 + 五预设）按 CROP_PRESET_ORDER 渲染、
   比例项视觉复用共享 RatioIcon；点击预设派发 onPresetChange、当前项高亮；
   确认派发 onConfirm、取消派发 onClose；确认钮为 Dock 主发送钮同款图标钮
   （IKGZ5Q：白 ↑ 图标，title 保留「确认」文案）；根元素带 data-gen-panel-territory
   领土豁免标记；跟随锚定 inline left/top 生效。选项数据源自 imageCrop.ts 单源，不另造。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CropDialog from './index';
import { CROP_PRESET_ORDER, type CropPresetKey } from '../../imageCrop';

let root: Root;
let mountNode: HTMLDivElement;
let onPresetChange: ReturnType<typeof vi.fn>;
let onConfirm: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

async function renderDialog(preset: CropPresetKey = 'free', withAnchor = false) {
  await act(async () => {
    root.render(
      createElement(CropDialog, {
        preset,
        onPresetChange: (key: CropPresetKey) => onPresetChange(key),
        onConfirm: () => onConfirm(),
        onClose: () => onClose(),
        followAnchor: withAnchor ? { left: 123, top: 456 } : null,
      }),
    );
  });
}

const presetBtn = (key: CropPresetKey) =>
  mountNode.querySelector(`[data-testid="crop-preset-${key.replace(':', '-')}"]`) as HTMLElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  onPresetChange = vi.fn();
  onConfirm = vi.fn();
  onClose = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

describe('IKGW1N 裁切面板渲染', () => {
  it('六选项按预设顺序渲染：自由 + 五个比例，比例项复用共享 RatioIcon', async () => {
    await renderDialog();
    for (const key of CROP_PRESET_ORDER) {
      expect(presetBtn(key), `preset ${key}`).toBeTruthy();
    }
    // 五个比例项各渲染一个 RatioIcon span；16:9 图标按真实比例 16×9
    const icons = mountNode.querySelectorAll('.ratioIcon, span[style*="width"]');
    expect(icons.length).toBeGreaterThan(0);
    const wide = presetBtn('16:9').querySelector('span') as HTMLElement;
    expect(wide.style.width).toBe('16px');
    expect(wide.style.height).toBe('9px');
    const tall = presetBtn('9:16').querySelector('span') as HTMLElement;
    expect(tall.style.width).toBe('9px');
    expect(tall.style.height).toBe('16px');
  });

  it('当前预设高亮（aria-pressed），其余项不高亮', async () => {
    await renderDialog('4:3');
    expect(presetBtn('4:3').getAttribute('aria-pressed')).toBe('true');
    expect(presetBtn('free').getAttribute('aria-pressed')).toBe('false');
    expect(presetBtn('1:1').getAttribute('aria-pressed')).toBe('false');
  });

  it('根元素带 data-gen-panel-territory 领土豁免标记（点外关闭误杀防护）', async () => {
    await renderDialog();
    const panel = mountNode.querySelector('[data-testid="crop-dialog"]') as HTMLElement;
    expect(panel.hasAttribute('data-gen-panel-territory')).toBe(true);
  });

  it('跟随锚定时 inline left/top 生效（源图卡下方浮出）', async () => {
    await renderDialog('free', true);
    const panel = mountNode.querySelector('[data-testid="crop-dialog"]') as HTMLElement;
    expect(panel.style.left).toBe('123px');
    expect(panel.style.top).toBe('456px');
  });
});

describe('IKGW1N 裁切面板交互', () => {
  it('点预设派发 onPresetChange（框同步最大内接居中由 CanvasPage 消费该回调实现）', async () => {
    await renderDialog();
    await act(async () => { presetBtn('4:3').click(); });
    expect(onPresetChange).toHaveBeenLastCalledWith('4:3');
    await act(async () => { presetBtn('free').click(); });
    expect(onPresetChange).toHaveBeenLastCalledWith('free');
  });

  it('点确认派发 onConfirm', async () => {
    await renderDialog();
    await act(async () => {
      (mountNode.querySelector('[data-testid="crop-confirm"]') as HTMLElement).click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onPresetChange).not.toHaveBeenCalled();
  });

  it('确认钮为 Dock 主发送钮同款图标钮：白 ↑ 图标（ArrowUp），title 保留「确认」文案，不再渲染文字（IKGZ5Q）', async () => {
    await renderDialog();
    const confirm = mountNode.querySelector('[data-testid="crop-confirm"]') as HTMLButtonElement;
    expect(confirm.querySelector('svg.lucide-arrow-up')).toBeTruthy();
    expect(confirm.getAttribute('title')).toBe('确认');
    expect(confirm.textContent).not.toContain('确认');
  });

  it('点取消派发 onClose（CanvasPage 绑 exitCropMode）', async () => {
    await renderDialog();
    await act(async () => {
      (mountNode.querySelector('[data-testid="crop-cancel"]') as HTMLElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/* ===== IKH1WI 跟随态 CSS 中心点锚（CSS 源断言，先例 mediaChipVisualSource.test.ts）：
   跟随锚 left 是源卡中心 x，真居中由基础 .panel 的 translateX(-50%) 完成；
   .panelFollow 对齐 CutoutToolbar .dialogWrapFollow 先例（left:0 兜底 inline 缺失，
   transform 不覆盖 → 继承基础态完成真居中，不再对中心点锚二次左移）。 ===== */
describe('IKH1WI 跟随态 CSS 中心点锚', () => {
  const css = readFileSync(resolve('src/pages/CanvasPage/components/CropDialog/index.module.css'), 'utf-8');
  const block = (selector: string) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('基础 .panel 保留 translateX(-50%)：中心点锚的真居中由自身 transform 完成', () => {
    expect(block('\\.panel')).toContain('translateX(-50%)');
  });

  it('.panelFollow 对齐先例：left: 0 + bottom: auto，不覆盖 transform（继承真居中）', () => {
    const follow = block('\\.panelFollow');
    expect(follow).toContain('bottom: auto');
    expect(follow).toContain('left: 0');
    expect(follow).not.toContain('transform');
  });
});
