// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Select, { type SelectOption } from './index';

const OPTIONS: SelectOption[] = [
  { value: '', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频', disabled: true },
  { value: 'audio', label: '音频' },
];

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.setPointerCapture = () => {};
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

async function render(props: Partial<Parameters<typeof Select>[0]> = {}): Promise<void> {
  await act(async () => {
    root.render(
      createElement(Select, { options: OPTIONS, value: '', onChange: () => {}, ...props }),
    );
  });
}

function trigger(): HTMLElement {
  return mountNode.querySelector('[role="combobox"]') as HTMLElement;
}

async function open(): Promise<void> {
  const element = trigger();
  await act(async () => {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    element.dispatchEvent(event);
  });
}

function option(label: string): HTMLElement {
  const found = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (element) => element.textContent === label,
  );
  if (!found) throw new Error(`找不到选项：${label}`);
  return found;
}

describe('Select', () => {
  it('触发器显示选中项标签，role=combobox', async () => {
    await render({ value: 'image' });
    expect(trigger().textContent).toContain('图片');
  });

  it('★ 值为空串时仍显示对应标签，而不是 placeholder', async () => {
    await render({ value: '', placeholder: '请选择' });
    expect(trigger().textContent).toContain('全部');
    expect(trigger().textContent).not.toContain('请选择');
  });

  it('值不在选项里时显示 placeholder', async () => {
    await render({ value: 'missing', placeholder: '请选择' });
    expect(trigger().textContent).toContain('请选择');
  });

  it('★ 菜单传送到 body，不被表格滚动容器或 Modal 裁切', async () => {
    await render();
    await open();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(mountNode.querySelector('[role="option"]')).toBeNull();
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('★ 选择空串选项时 onChange 拿回空串，而不是内部占位值', async () => {
    const onChange = vi.fn();
    await render({ value: 'image', onChange });
    await open();
    await act(async () => option('全部').click());
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('选择普通选项时 onChange 传真实值', async () => {
    const onChange = vi.fn();
    await render({ value: '', onChange });
    await open();
    await act(async () => option('音频').click());
    expect(onChange).toHaveBeenCalledWith('audio');
  });

  it('disabled 选项不可选', async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await open();
    await act(async () => option('视频').click());
    expect(onChange).not.toHaveBeenCalled();
  });
});
