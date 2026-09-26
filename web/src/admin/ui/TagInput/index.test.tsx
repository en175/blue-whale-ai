// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import TagInput from './index';

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

async function render(node: ReactElement): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

function input(): HTMLInputElement {
  return mountNode.querySelector('input') as HTMLInputElement;
}

function type(value: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('TagInput', () => {
  it('渲染已有的值', async () => {
    await render(
      createElement(TagInput, {
        values: ['seedance-*', '*'],
        ariaLabel: '模型范围',
        onChange: () => undefined,
      }),
    );

    expect(mountNode.textContent).toContain('seedance-*');
    expect(document.querySelectorAll('button[aria-label^="删除"]').length).toBe(2);
  });

  it('点添加把输入框里的值加进列表，并清空输入框', async () => {
    let current: string[] = [];
    await render(
      createElement(TagInput, {
        values: current,
        ariaLabel: '模型范围',
        onChange: (next: string[]) => {
          current = next;
        },
      }),
    );

    await act(async () => {
      type('seedance-*');
    });
    const addButton = [...mountNode.querySelectorAll('button')].find(
      (b) => b.textContent === '添加',
    ) as HTMLButtonElement;
    await act(async () => {
      addButton.click();
    });

    expect(current).toEqual(['seedance-*']);
    // 不清空的话，下一次点添加会把同一个值再加一遍（然后被去重掉，看起来像按钮坏了）
    expect(input().value).toBe('');
  });

  it('回车等于点添加', async () => {
    let current: string[] = [];
    await render(
      createElement(TagInput, {
        values: current,
        ariaLabel: '模型范围',
        onChange: (next: string[]) => {
          current = next;
        },
      }),
    );

    await act(async () => {
      type('*');
    });
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(current).toEqual(['*']);
  });

  it('重复值被忽略（运营重复添加时想要的是「它已经在里面了」）', async () => {
    let current: string[] = ['*'];
    await render(
      createElement(TagInput, {
        values: current,
        ariaLabel: '模型范围',
        onChange: (next: string[]) => {
          current = next;
        },
      }),
    );

    await act(async () => {
      type('*');
    });
    const addButton = [...mountNode.querySelectorAll('button')].find(
      (b) => b.textContent === '添加',
    ) as HTMLButtonElement;
    await act(async () => {
      addButton.click();
    });

    expect(current).toEqual(['*']);
  });

  it('空输入不进列表（点添加不该凭空多出一个空模式）', async () => {
    let current: string[] = [];
    await render(
      createElement(TagInput, {
        values: current,
        ariaLabel: '模型范围',
        onChange: (next: string[]) => {
          current = next;
        },
      }),
    );

    await act(async () => {
      type('   ');
    });
    const addButton = [...mountNode.querySelectorAll('button')].find(
      (b) => b.textContent === '添加',
    ) as HTMLButtonElement;
    await act(async () => {
      addButton.click();
    });

    expect(current).toEqual([]);
  });

  it('删除按钮带值本身的可访问名（一页上有多组时能分辨删的是哪一个）', async () => {
    await render(
      createElement(TagInput, {
        values: ['a', 'b'],
        ariaLabel: '模型范围',
        onChange: () => undefined,
      }),
    );

    expect(document.querySelector('button[aria-label="删除 a"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="删除 b"]')).not.toBeNull();
  });

  it('受控：值由外部给，删掉一个后回传剩下的', async () => {
    let current: string[] = ['a', 'b'];
    await render(
      createElement(TagInput, {
        values: current,
        ariaLabel: '模型范围',
        onChange: (next: string[]) => {
          current = next;
        },
      }),
    );

    const removeA = document.querySelector('button[aria-label="删除 a"]') as HTMLButtonElement;
    await act(async () => {
      removeA.click();
    });

    expect(current).toEqual(['b']);
  });
});
