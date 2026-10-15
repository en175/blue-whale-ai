// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DropdownMenu, { type DropdownMenuItem } from './index';
import styles from './index.module.css';

let root: Root;
let mountNode: HTMLDivElement;

function patchPointerCapture() {
  if (!('PointerEvent' in globalThis)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    (globalThis as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent =
      PointerEventPolyfill as unknown as typeof PointerEvent;
  }
  const proto = HTMLElement.prototype as HTMLElement & {
    hasPointerCapture?: (id: number) => boolean;
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
  };
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
}

function pointerClick(target: EventTarget) {
  const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' };
  target.dispatchEvent(new PointerEvent('pointerdown', init));
  target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new PointerEvent('pointerup', init));
  target.dispatchEvent(new MouseEvent('mouseup', init));
  target.dispatchEvent(new MouseEvent('click', init));
}

function Harness({
  items,
  canvasSafe,
  openOnHover,
}: {
  items: DropdownMenuItem[];
  canvasSafe?: boolean;
  openOnHover?: boolean;
}) {
  const [last, setLast] = useState('');
  return createElement(
    'div',
    null,
    createElement(DropdownMenu, {
      canvasSafe,
      openOnHover,
      contentTestId: 'dropdown-menu',
      trigger: createElement('button', { type: 'button', title: '打开菜单' }, '打开'),
      items: items.map((item) => ({
        ...item,
        onSelect: () => {
          item.onSelect?.();
          setLast(item.key);
        },
      })),
    }),
    createElement('div', { 'data-testid': 'outside' }, '外面'),
    last ? createElement('div', { 'data-testid': 'picked' }, last) : null,
  );
}

async function render(
  items: DropdownMenuItem[],
  options?: { canvasSafe?: boolean; openOnHover?: boolean },
) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(Harness, {
        items,
        canvasSafe: options?.canvasSafe,
        openOnHover: options?.openOnHover,
      }),
    );
  });
}

function trigger(): HTMLButtonElement {
  return document.body.querySelector('button[title="打开菜单"]') as HTMLButtonElement;
}

function menuItems(): HTMLElement[] {
  return [...document.body.querySelectorAll('[role="menuitem"]')] as HTMLElement[];
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  patchPointerCapture();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('DropdownMenu', () => {
  it('点击触发器打开菜单', async () => {
    await render([{ key: 'view', label: '查看' }]);
    expect(menuItems()).toHaveLength(0);
    await act(async () => {
      pointerClick(trigger());
    });
    expect(menuItems().map((item) => item.textContent)).toEqual(['查看']);
  });

  it('点选项执行并关闭', async () => {
    const onSelect = vi.fn();
    await render([{ key: 'view', label: '查看', onSelect }]);
    await act(async () => {
      pointerClick(trigger());
    });
    await act(async () => {
      pointerClick(menuItems()[0]);
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[data-testid="picked"]')?.textContent).toBe('view');
    expect(menuItems()).toHaveLength(0);
  });

  it('点外面关闭', async () => {
    await render([{ key: 'view', label: '查看' }]);
    await act(async () => {
      pointerClick(trigger());
    });
    expect(menuItems()).toHaveLength(1);
    await act(async () => {
      document.body.querySelector('[data-testid="outside"]')?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
    });
    expect(menuItems()).toHaveLength(0);
  });

  it('Esc 关闭', async () => {
    await render([{ key: 'view', label: '查看' }]);
    await act(async () => {
      pointerClick(trigger());
    });
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(menuItems()).toHaveLength(0);
  });

  it('危险项带危险色，禁用项不执行', async () => {
    const onSelect = vi.fn();
    await render([
      { key: 'delete', label: '删除', danger: true },
      { key: 'off', label: '禁用', disabled: true, onSelect },
    ]);
    await act(async () => {
      pointerClick(trigger());
    });
    expect(menuItems()[0].className).toContain(styles.danger);
    await act(async () => {
      pointerClick(menuItems()[1]);
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(menuItems()).toHaveLength(2);
  });

  it('画布触发器带 nodrag nopan', async () => {
    await render([{ key: 'view', label: '查看' }], { canvasSafe: true });
    expect(trigger().className).toContain('nodrag');
    expect(trigger().className).toContain('nopan');
  });

  it('悬停打开，移出延迟关闭，重新进入取消关闭', async () => {
    vi.useFakeTimers();
    await render([{ key: 'view', label: '查看' }], { openOnHover: true });
    await act(async () => {
      trigger().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    expect(menuItems().map((item) => item.textContent)).toEqual(['查看']);

    await act(async () => {
      trigger().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(menuItems()).toHaveLength(1);
    await act(async () => {
      trigger().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(menuItems()).toHaveLength(1);

    await act(async () => {
      trigger().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(menuItems()).toHaveLength(0);
    vi.useRealTimers();
  });

  it('画布内容带 nodrag nopan', async () => {
    await render([{ key: 'view', label: '查看' }], { canvasSafe: true, openOnHover: true });
    await act(async () => {
      trigger().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    const content = document.body.querySelector('[data-testid="dropdown-menu"]');
    expect(content?.className).toContain('nodrag');
    expect(content?.className).toContain('nopan');
  });
});
