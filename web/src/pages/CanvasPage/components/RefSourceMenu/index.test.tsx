// @vitest-environment jsdom
/* IKFE8T 统一附件来源入口组件：单「+」展开「从资产中选择 / 从节点添加素材」两项菜单，
   回调触发后菜单关闭；外点（遮罩）关闭；pickMode 进行中「+」高亮。 */
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RefSourceMenu from './index';
import styles from './index.module.css';

let root: Root;
let container: HTMLDivElement;

async function renderMenu(props: Partial<Parameters<typeof RefSourceMenu>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onPickFromAssets = vi.fn();
  const onPickFromCanvas = vi.fn();
  await act(async () => {
    root.render(createElement(RefSourceMenu, {
      onPickFromAssets,
      onPickFromCanvas,
      ...props,
    }));
  });
  return { onPickFromAssets, onPickFromCanvas };
}

function clickButton(match: (b: HTMLButtonElement) => boolean) {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(match)!;
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function menuItemLabels(): string[] {
  return [...container.querySelectorAll('button')]
    .filter((b) => b.textContent === '从资产中选择' || b.textContent === '从节点添加素材')
    .map((b) => b.textContent!);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

describe('RefSourceMenu 统一附件来源入口', () => {
  it('单「+」按钮，展开菜单仅含两项统一来源', async () => {
    await renderMenu();
    const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === '从资产中选择 / 从节点添加素材',
    );
    expect(entry).toBeTruthy();
    expect(menuItemLabels()).toEqual([]);

    clickButton((b) => b.getAttribute('title') === '从资产中选择 / 从节点添加素材');
    expect(menuItemLabels().sort()).toEqual(['从节点添加素材', '从资产中选择']);
  });

  it('点击「从资产中选择」触发回调并关闭菜单', async () => {
    const { onPickFromAssets } = await renderMenu();
    clickButton((b) => b.getAttribute('title') === '从资产中选择 / 从节点添加素材');
    clickButton((b) => b.textContent === '从资产中选择');
    expect(onPickFromAssets).toHaveBeenCalledTimes(1);
    expect(menuItemLabels()).toEqual([]);
  });

  it('点击「从节点添加素材」触发回调并关闭菜单', async () => {
    const { onPickFromCanvas } = await renderMenu();
    clickButton((b) => b.getAttribute('title') === '从资产中选择 / 从节点添加素材');
    clickButton((b) => b.textContent === '从节点添加素材');
    expect(onPickFromCanvas).toHaveBeenCalledTimes(1);
    expect(menuItemLabels()).toEqual([]);
  });

  it('点击菜单外遮罩关闭菜单，不触发来源回调', async () => {
    const { onPickFromAssets, onPickFromCanvas } = await renderMenu();
    clickButton((b) => b.getAttribute('title') === '从资产中选择 / 从节点添加素材');
    const overlay = container.querySelector(`.${styles.menuOverlay}`) as HTMLElement;
    expect(overlay).toBeTruthy();
    act(() => {
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(menuItemLabels()).toEqual([]);
    expect(onPickFromAssets).not.toHaveBeenCalled();
    expect(onPickFromCanvas).not.toHaveBeenCalled();
  });
});
