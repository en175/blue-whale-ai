// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Tooltip from './index';

/** React 的 `onMouseEnter/Leave` 是**用 mouseover/mouseout 模拟**的（带 relatedTarget 判定），
 *  直接 dispatch `mouseenter` 不会被 React 收到。测试里因此走 `mouseover` / `mouseout`。 */
function hover(el: Element, type: 'over' | 'out') {
  el.dispatchEvent(
    new MouseEvent(type === 'over' ? 'mouseover' : 'mouseout', {
      bubbles: true,
      relatedTarget: type === 'over' ? null : document.body,
    }),
  );
}

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

const TEXT = '这段说明默认不该出现在页面上';

async function render(content = TEXT) {
  await act(async () => {
    root.render(createElement(Tooltip, { content, label: '说明' }));
  });
  const trigger = mountNode.querySelector<HTMLButtonElement>('button');
  expect(trigger, '应渲染一个「?」图标按钮').not.toBeNull();
  return trigger!;
}

const panel = () => document.querySelector('[role="tooltip"]');

describe('Tooltip：说明默认不占版面，悬停 / 聚焦才出现', () => {
  it('★ 初始不渲染说明内容（这正是它取代蓝色 Alert 的理由：解释不再占版面）', async () => {
    await render();
    expect(panel()).toBeNull();
    expect(document.body.textContent ?? '').not.toContain(TEXT);
  });

  it('★ 悬停 → 面板出现，内容在**门户**里（不是按钮内部，否则会被滚动容器裁掉）', async () => {
    const trigger = await render();
    await act(async () => {
      hover(trigger, 'over');
    });
    expect(panel()).not.toBeNull();
    expect(panel()!.textContent).toContain(TEXT);
    expect(mountNode.contains(panel())).toBe(false);
    expect(document.body.contains(panel())).toBe(true);
  });

  it('★ 移开 → 面板关掉（延迟一点，好让鼠标能移到面板上去读完长说明）', async () => {
    const trigger = await render();
    await act(async () => {
      hover(trigger, 'over');
    });
    expect(panel()).not.toBeNull();
    await act(async () => {
      hover(trigger, 'out');
      // 关闭是延迟的：立刻检查还在
      expect(panel()).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(panel()).toBeNull();
  });

  it('★ 键盘可达：聚焦也能看到说明（纯 hover 会把读屏与键盘用户挡在外面）', async () => {
    const trigger = await render();
    await act(async () => {
      trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(panel()).not.toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBe(panel()!.id);
  });

  it('★ 点击也开合（触屏没有 hover），且不冒泡出去', async () => {
    const trigger = await render();
    let bubbled = false;
    document.body.addEventListener('click', () => {
      bubbled = true;
    });
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(panel()).not.toBeNull();
    // 「高级 JSON」那处图标落在 <summary> 里：不吞事件就会顺带展开/收起 details
    expect(bubbled).toBe(false);
  });
});
