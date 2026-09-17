// @vitest-environment jsdom
/* ImageQualityMenu「高清 ▾」下拉（IKGOT7）：数组驱动渲染、置灰守卫（title 悬停原因 + 点击不派发）、
   点外关闭（useDismissOnOutside）、Esc 关闭。渲染模式沿用 useDismissOnOutside.test.tsx（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Eraser, Expand } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageQualityMenu, { type ImageQualityMenuItem } from './ImageQualityMenu';

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

async function openMenu() {
  await act(async () => {
    trigger().click();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('ImageQualityMenu（高清 ▾ 下拉）', () => {
  it('默认收起；点触发按钮展开菜单并按数组顺序渲染全部菜单项', async () => {
    const menuItems = items();
    await renderMenu(menuItems);
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).toBeNull();
    expect(trigger().textContent).toContain('高清');

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
    const reason = '图片尺寸超过 2560×1440，无法擦除';
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

  it('再次点触发按钮切换收起', async () => {
    const menuItems = items();
    await renderMenu(menuItems);
    await openMenu();
    await act(async () => {
      trigger().click();
    });
    expect(mountNode.querySelector('[data-testid="image-quality-menu"]')).toBeNull();
  });
});
