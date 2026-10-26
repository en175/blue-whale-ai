// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Textarea from './index';

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

async function render(props: Parameters<typeof Textarea>[0]): Promise<HTMLTextAreaElement> {
  await act(async () => {
    root.render(createElement(Textarea, props));
  });
  return mountNode.firstElementChild as HTMLTextAreaElement;
}

describe('Textarea', () => {
  it('渲染为 textarea', async () => {
    const el = await render({ defaultValue: '{"a":1}' });
    expect(el.tagName).toBe('TEXTAREA');
  });

  it('★ 默认 6 行而不是原生的 2 行', async () => {
    const el = await render({});
    expect(el.rows).toBe(6);
  });

  it('显式 rows 覆盖默认值', async () => {
    const el = await render({ rows: 12 });
    expect(el.rows).toBe(12);
  });

  it('透传原生属性（disabled / placeholder / value）', async () => {
    const el = await render({ placeholder: '在此粘贴 JSON', disabled: true, value: 'x', readOnly: true });
    expect(el.placeholder).toBe('在此粘贴 JSON');
    expect(el.disabled).toBe(true);
    expect(el.value).toBe('x');
  });

  it('onChange 能拿到输入', async () => {
    let seen = '';
    const el = await render({
      onChange: (e) => {
        seen = e.target.value;
      },
    });
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setValue.call(el, 'hello');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(seen).toBe('hello');
  });
});
