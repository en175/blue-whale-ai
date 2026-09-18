// @vitest-environment jsdom
/* ImageQualityMenu「高清 ▾」下拉（IKGOT7/IKGZ5P）：数组驱动渲染、置灰守卫（title 悬停原因 + 点击不派发）、
   点外关闭（useDismissOnOutside）、Esc 关闭、触发钮最近工具语义（文案随全局记忆变化、点击直启并写记忆、
   所显示工具置灰时整钮置灰点击无效而 hover 仍可展开菜单改选）、hover 展开/移出延迟关闭（fake timers）。
   渲染模式沿用 useDismissOnOutside.test.tsx（createRoot + act）；React onMouseEnter/Leave
   经 mouseover/mouseout（relatedTarget 指向 wrap 外）合成触发。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Crop, Eraser, Expand, Maximize2, WandSparkles } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageQualityMenu, { type ImageQualityMenuItem } from './ImageQualityMenu';
import { RECENT_QUALITY_TOOL_STORAGE_KEY, persistRecentQualityTool } from '../../recentQualityTool';

let root: Root;
let mountNode: HTMLDivElement;

function items(overrides?: { eraseDisabledReason?: string | null }): ImageQualityMenuItem[] {
  return [
    {
      id: 'enhance',
      label: '高清',
      icon: Expand,
      hint: '在右侧新建高清放大草稿卡',
      disabledReason: null,
      onSelect: vi.fn(),
    },
    {
      id: 'erase',
      label: '擦除',
      icon: Eraser,
      hint: '涂抹或框选抹掉图中不要的内容',
      disabledReason: overrides?.eraseDisabledReason ?? null,
      onSelect: vi.fn(),
    },
  ];
}

/** 五项全量（顺序同 MediaNode qualityMenuItems：高清/扩图/裁切/擦除/抠图），最近工具语义测试用 */
function fullItems(overrides?: { cutoutDisabledReason?: string | null }): ImageQualityMenuItem[] {
  return [
    items()[0]!,
    {
      id: 'outpaint',
      label: '扩图',
      icon: Maximize2,
      hint: '进入扩图模式，拖动边框向外扩展画面',
      disabledReason: null,
      onSelect: vi.fn(),
    },
    {
      id: 'crop',
      label: '裁切',
      icon: Crop,
      hint: '拖动裁切框，裁掉边缘保留选定区域',
      disabledReason: null,
      onSelect: vi.fn(),
    },
    items({ eraseDisabledReason: null })[1]!,
    {
      id: 'cutout',
      label: '抠图',
      icon: WandSparkles,
      hint: '自动识别主体并移除背景',
      disabledReason: overrides?.cutoutDisabledReason ?? null,
      onSelect: vi.fn(),
    },
  ];
}

async function renderMenu(menuItems: ImageQualityMenuItem[]) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(ImageQualityMenu, { items: menuItems }));
  });
}

function trigger(): HTMLButtonElement {
  return mountNode.querySelector('[data-testid="image-quality-trigger"]')!;
}

/** hover 进入触发钮（mouseover，relatedTarget 在 wrap 外，React 合成 onMouseEnter） */
async function hoverIn() {
  await act(async () => {
    trigger().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
  });
}

/** hover 移出（mouseout → React 合成 onMouseLeave，走延迟关闭） */
async function hoverOut() {
  await act(async () => {
    trigger().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  });
}

async function openMenu() {
  await hoverIn();
}

/** 推进 hover 延迟关闭的等待时间 */
async function settleHoverClose() {
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.useRealTimers();
});

describe('触发钮最近工具语义（IKGZ5P）', () => {
  it('默认（无记忆）触发钮显示「高清」', async () => {
    await renderMenu(fullItems());
    expect(trigger().textContent).toContain('高清');
  });

  it('记忆变化触发钮文案与图标同步刷新（不重挂载，全局订阅）', async () => {
    await renderMenu(fullItems());
    expect(trigger().textContent).toContain('高清');
    await act(async () => {
      persistRecentQualityTool('cutout');
    });
    expect(trigger().textContent).toContain('抠图');
    await act(async () => {
      persistRecentQualityTool('erase');
    });
    expect(trigger().textContent).toContain('擦除');
  });

  it('全局单值跨卡共享：实例 A 选择「抠图」后实例 B 触发钮同步显示「抠图」', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    const menuA = fullItems();
    const menuB = fullItems();
    await act(async () => {
      root.render(createElement('div', null,
        createElement(ImageQualityMenu, { key: 'a', items: menuA }),
        createElement(ImageQualityMenu, { key: 'b', items: menuB })));
    });
    const triggers = mountNode.querySelectorAll('[data-testid="image-quality-trigger"]');
    expect(triggers).toHaveLength(2);
    // 实例 A：hover 展开后选「抠图」
    await act(async () => {
      triggers[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-cutout"]')!.click();
    });
    expect(menuA[4]!.onSelect).toHaveBeenCalledTimes(1);
    // 实例 B：触发钮文案同步为「抠图」
    expect(triggers[1]!.textContent).toContain('抠图');
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('cutout');
  });

  it('点击触发钮直启所显示工具：派发该项 onSelect 并写入记忆（非一键直发，会话内发送由宿主负责）', async () => {
    await act(async () => {
      persistRecentQualityTool('cutout');
    });
    const menuItems = fullItems();
    await renderMenu(menuItems);
    await act(async () => {
      trigger().click();
    });
    expect(menuItems[4]!.onSelect).toHaveBeenCalledTimes(1);
    expect(menuItems[0]!.onSelect).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('cutout');
  });

  it('默认「高清」时点击触发钮直启高清', async () => {
    const menuItems = fullItems();
    await renderMenu(menuItems);
    await act(async () => {
      trigger().click();
    });
    expect(menuItems[0]!.onSelect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('enhance');
  });

  it('菜单选择同样写入记忆并更新触发钮文案（与直启同一写入点）', async () => {
    const menuItems = fullItems();
    await renderMenu(menuItems);
    await openMenu();
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!.click();
    });
    expect(menuItems[3]!.onSelect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('erase');
    expect(trigger().textContent).toContain('擦除');
  });

  it('所显示工具置灰：整钮 aria-disabled + title 原因，点击不派发不写记忆', async () => {
    const reason = 'webp 格式不支持抠图（支持 PNG / JPG / JPEG / HEIC）';
    await act(async () => {
      persistRecentQualityTool('cutout');
    });
    const menuItems = fullItems({ cutoutDisabledReason: reason });
    await renderMenu(menuItems);
    const btn = trigger();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('title')).toBe(reason);
    await act(async () => {
      btn.click();
    });
    expect(menuItems[4]!.onSelect).not.toHaveBeenCalled();
    // 已有记忆不被破坏（置灰点击无效）
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('cutout');
  });

  it('置灰时 hover 仍可展开菜单：可见各项置灰原因并改选可用工具', async () => {
    const reason = 'webp 格式不支持抠图（支持 PNG / JPG / JPEG / HEIC）';
    await act(async () => {
      persistRecentQualityTool('cutout');
    });
    const menuItems = fullItems({ cutoutDisabledReason: reason });
    await renderMenu(menuItems);
    await openMenu();
    const menu = mountNode.querySelector('[data-testid="image-quality-menu"]');
    expect(menu).not.toBeNull();
    const cutout = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-cutout"]')!;
    expect(cutout.getAttribute('aria-disabled')).toBe('true');
    expect(cutout.getAttribute('title')).toBe(reason);
    // 改选「裁切」：派发并改写记忆
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-crop"]')!.click();
    });
    expect(menuItems[2]!.onSelect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY)).toBe('crop');
    expect(trigger().textContent).toContain('裁切');
  });

  it('直启后菜单收起', async () => {
    const menuItems = fullItems();
    await renderMenu(menuItems);
    await openMenu();
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).not.toBeNull();
    await act(async () => {
      trigger().click();
    });
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).toBeNull();
  });
});

describe('hover 展开 / 移出关闭（IKGZ5P）', () => {
  it('默认收起；hover 触发钮自动展开菜单', async () => {
    await renderMenu(items());
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).toBeNull();
    await hoverIn();
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).not.toBeNull();
  });

  it('移出触发钮延迟后关闭菜单（延迟容忍向菜单项移动的间隙）', async () => {
    await renderMenu(items());
    await hoverIn();
    await hoverOut();
    // 延迟窗口内菜单保持（鼠标可从触发钮滑向菜单）
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).not.toBeNull();
    await settleHoverClose();
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).toBeNull();
  });

  it('延迟窗口内重新进入不关闭', async () => {
    await renderMenu(items());
    await hoverIn();
    await hoverOut();
    await hoverIn();
    await settleHoverClose();
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).not.toBeNull();
  });
});

describe('数组驱动渲染与置灰守卫（IKGOT7 既有口径）', () => {
  it('hover 展开菜单并按数组顺序渲染全部菜单项', async () => {
    const menuItems = items();
    await renderMenu(menuItems);
    await openMenu();
    const rendered = [...mountNode.querySelectorAll('[data-testid^="image-quality-item-"]')];
    expect(rendered.map((b) => b.textContent)).toEqual(['高清', '擦除']);
  });

  it('数组中间插入第三项（扩图 IKGOQ0 插入位）照常渲染，顺序由数组决定', async () => {
    const menuItems = items();
    menuItems.splice(1, 0, {
      id: 'outpaint',
      label: '扩图',
      icon: Expand,
      disabledReason: null,
      onSelect: vi.fn(),
    });
    await renderMenu(menuItems);
    await openMenu();
    const rendered = [...mountNode.querySelectorAll('[data-testid^="image-quality-item-"]')];
    expect(rendered.map((b) => b.textContent)).toEqual(['高清', '扩图', '擦除']);
  });

  it('数组尾部追加第三项（抠图 IKGXLT 插入位）照常渲染，顺序由数组决定', async () => {
    const menuItems = items();
    menuItems.push({
      id: 'cutout',
      label: '抠图',
      icon: WandSparkles,
      hint: '自动识别主体并移除背景',
      disabledReason: null,
      onSelect: vi.fn(),
    });
    await renderMenu(menuItems);
    await openMenu();
    const rendered = [...mountNode.querySelectorAll('[data-testid^="image-quality-item-"]')];
    expect(rendered.map((b) => b.textContent)).toEqual(['高清', '擦除', '抠图']);
    const cutout = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-cutout"]')!;
    expect(cutout.getAttribute('title')).toBe('自动识别主体并移除背景');
  });

  it('追加的抠图项置灰：aria-disabled + title 悬停原因，点击不派发不收起', async () => {
    const reason = 'webp 格式不支持抠图（支持 PNG / JPG / JPEG / HEIC）';
    const menuItems = items();
    menuItems.push({
      id: 'cutout',
      label: '抠图',
      icon: WandSparkles,
      disabledReason: reason,
      onSelect: vi.fn(),
    });
    await renderMenu(menuItems);
    await openMenu();
    const cutout = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-cutout"]')!;
    expect(cutout.getAttribute('aria-disabled')).toBe('true');
    expect(cutout.getAttribute('title')).toBe(reason);
    await act(async () => {
      cutout.click();
    });
    expect(menuItems[2].onSelect).not.toHaveBeenCalled();
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).not.toBeNull();
  });

  it('点可用菜单项：派发 onSelect 并收起菜单', async () => {
    const menuItems = items();
    await renderMenu(menuItems);
    await openMenu();
    await act(async () => {
      mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-enhance"]')!.click();
    });
    expect(menuItems[0].onSelect).toHaveBeenCalledTimes(1);
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).toBeNull();
  });

  it('置灰项：aria-disabled + title 悬停原因，点击不派发不收起', async () => {
    const reason = '图片长边超过 2560 或短边超过 1440，无法擦除';
    const menuItems = items({ eraseDisabledReason: reason });
    await renderMenu(menuItems);
    await openMenu();
    const erase = mountNode.querySelector<HTMLButtonElement>('[data-testid="image-quality-item-erase"]')!;
    expect(erase.getAttribute('aria-disabled')).toBe('true');
    expect(erase.getAttribute('title')).toBe(reason);
    await act(async () => {
      erase.click();
    });
    expect(menuItems[1].onSelect).not.toHaveBeenCalled();
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).not.toBeNull();
  });

  it('可用项 title 展示 hint 悬停说明', async () => {
    const menuItems = items();
    await renderMenu(menuItems);
    await openMenu();
    expect(
      mountNode.querySelector('[data-testid="image-quality-item-enhance"]')!.getAttribute('title'),
    ).toBe('在右侧新建高清放大草稿卡');
  });

  it('菜单外 mousedown 关闭，菜单内 mousedown 不关闭（useDismissOnOutside）', async () => {
    const menuItems = items();
    await renderMenu(menuItems);
    await openMenu();
    const menu = mountNode.querySelector('[data-testid="image-quality-menu"]')!;
    await act(async () => {
      menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).toBeNull();
  });

  it('Esc 关闭菜单', async () => {
    const menuItems = items();
    await renderMenu(menuItems);
    await openMenu();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).toBeNull();
  });
});
