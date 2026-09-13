// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import AtMentionMenu from './index';

let root: Root;
let host: HTMLDivElement;
const image = { id: 'node-1', assetId: '101', kind: 'image' as const, name: '图片节点 1' };
async function render() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onSelect = vi.fn();
  const onSelectReferenced = vi.fn();
  await act(async () => root.render(createElement(AtMentionMenu, {
    anchorRef: { current: host }, editorQuery: '', onClose: vi.fn(), onSelect,
    items: [image, { id: 'v1', kind: 'video', name: '视频节点 1' }, { id: 't1', kind: 'text', name: '文本节点 1' }],
    referencedItems: [{ ...image, badge: '图片1' }], onSelectReferenced,
    disabledKinds: ['video'],
  })));
  return { onSelect, onSelectReferenced };
}
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });

it('同一菜单直接呈现已引用和原有四种素材分类', async () => {
  await render();
  const menu = document.querySelector('input[placeholder="搜索"]')!.parentElement!.parentElement!;
  expect(menu.textContent).toContain('已引用');
  expect(menu.textContent).toContain('素材引用');
  for (const label of ['图片', '视频', '音频', '文本']) {
    expect([...menu.querySelectorAll('button')].some(b => b.textContent === label)).toBe(true);
  }
  expect(menu.querySelector('input[placeholder="搜索"]')).toBeTruthy();
});

it('统一搜索保留跨分区重复项、类型分组及禁用状态，点击分派到各自引用动作', async () => {
  const { onSelect, onSelectReferenced } = await render();
  const input = document.querySelector('input[placeholder="搜索"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const menu = document.querySelector('input[placeholder="搜索"]')!.parentElement!.parentElement!;
  const matches = [...menu.querySelectorAll('button')].filter(b => b.textContent?.includes('图片节点 1'));
  expect(matches).toHaveLength(2);
  expect(menu.textContent).toContain('文本节点 1');
  const video = [...menu.querySelectorAll('button')].find(b => b.textContent === '视频节点 1')!;
  expect(video.disabled).toBe(true);
  await act(async () => matches[0].click());
  expect(onSelectReferenced).toHaveBeenCalledWith(expect.objectContaining({ assetId: '101' }));
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => matches[1].click());
  expect(onSelect).toHaveBeenCalledWith(image);
});


it('搜索框向上导航从最后一个可选项开始，跳过禁用分类', async () => {
  await render();
  const input = document.querySelector('input[placeholder="搜索"]') as HTMLInputElement;
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
  expect(document.activeElement?.textContent).toBe('文本');
});
