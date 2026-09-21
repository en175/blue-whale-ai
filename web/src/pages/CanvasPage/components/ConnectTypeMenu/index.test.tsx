// @vitest-environment jsdom
/* IKHHW8 连线类型菜单点外关闭回归锁：监听随挂载同步挂上且只挂一次，父级重渲染换 onClose
   引用不脱离；弹出当次交互（pointerup/click）不关闭；菜单容器内按下与禁用项不触发关闭。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectGenKind } from '../../connectAbility';
import ConnectTypeMenu from './index';
import styles from './index.module.css';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function menuEl(): HTMLElement | null {
  return document.body.querySelector(`.${styles.menu}`);
}

async function renderMenu(enabled: Set<ConnectGenKind> = new Set(['image', 'video', 'audio'])) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onClose = vi.fn();
  const onSelect = vi.fn();
  await act(async () => {
    root.render(createElement(ConnectTypeMenu, { x: 100, y: 100, enabled, onClose, onSelect }));
  });
  return { onClose, onSelect, enabled };
}

function rerenderMenu(onClose: () => void, enabled: Set<ConnectGenKind>) {
  act(() => {
    root.render(
      createElement(ConnectTypeMenu, { x: 100, y: 100, enabled, onClose, onSelect: vi.fn() }),
    );
  });
}

/** flush 挂载 effect。注意：jsdom 下异步 act 收尾会顺带执行宏任务（setTimeout(0) 也会被跑掉），
 *  故「监听同步挂载、无 setTimeout 空窗」由下面 rerender 用例的同步 act 锁定，本函数单独锁不住。 */
async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function pointerDownOutside() {
  act(() => {
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('ConnectTypeMenu 点外关闭监听生命周期（IKHHW8）', () => {
  it('监听挂载后，菜单外 pointerdown 触发 onClose', async () => {
    const { onClose } = await renderMenu();
    expect(menuEl()).toBeTruthy();
    await flushEffects();
    pointerDownOutside();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('父级重渲染换 onClose 引用，已挂载的监听不脱离', async () => {
    const { enabled } = await renderMenu();
    await flushEffects();
    const nextOnClose = vi.fn();
    // 修复前：引用一变立即摘监听、setTimeout(0) 后才重挂，此刻同步按下落进脱离窗口
    rerenderMenu(nextOnClose, enabled);
    pointerDownOutside();
    expect(nextOnClose, '重渲染后的同步 pointerdown 仍应触发关闭（新 onClose）').toHaveBeenCalledTimes(1);
  });

  it('弹出当次交互的 pointerup 与 click 不触发关闭，只监听后续按下', async () => {
    const { onClose } = await renderMenu();
    await flushEffects();
    act(() => {
      document.body.dispatchEvent(new Event('pointerup', { bubbles: true }));
      document.body.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    pointerDownOutside();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('菜单容器内按下不触发点外关闭', async () => {
    const { onClose } = await renderMenu();
    await flushEffects();
    act(() => {
      menuEl()!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('菜单外 contextmenu 触发 onClose', async () => {
    const { onClose } = await renderMenu();
    await flushEffects();
    act(() => {
      document.body.dispatchEvent(new Event('contextmenu', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击启用项触发 onSelect；禁用项不选中也不关闭', async () => {
    const { onClose, onSelect } = await renderMenu(new Set(['image']));
    const buttons = [...menuEl()!.querySelectorAll<HTMLButtonElement>('button')];
    act(() => {
      buttons.find((b) => b.textContent === '视频生成')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      buttons.find((b) => b.textContent === '图片生成')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onSelect).toHaveBeenCalledWith('image');
  });
});
