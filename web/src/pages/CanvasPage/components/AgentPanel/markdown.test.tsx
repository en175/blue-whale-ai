// @vitest-environment jsdom
/**
 * IKA2VC-4。原来的 Markdown 是手写的逐行解析器，只认标题、无序列表和引用：
 * 模型输出的表格原样显示成一堆竖线，有序列表退化成普通段落，围栏代码块的
 * ``` 直接印在正文里。这几条锁住换成 react-markdown + GFM 之后的结果。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Markdown } from './index';

let root: Root;
let container: HTMLDivElement;

async function render(text: string) {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Markdown, { text }));
  });
  return container;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('Agent 回复的 Markdown 渲染', () => {
  it('把表格渲染成表格，而不是一行行竖线', async () => {
    const el = await render(['| 镜号 | 画面 |', '| --- | --- |', '| 1 | 全景 |'].join('\n'));

    expect(el.querySelectorAll('table')).toHaveLength(1);
    expect([...el.querySelectorAll('th')].map((n) => n.textContent)).toEqual(['镜号', '画面']);
    expect([...el.querySelectorAll('td')].map((n) => n.textContent)).toEqual(['1', '全景']);
    expect(el.textContent).not.toContain('|');
  });

  it('渲染有序列表', async () => {
    const el = await render('1. 先定构图\n2. 再定光线');

    expect(el.querySelectorAll('ol')).toHaveLength(1);
    expect(el.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('渲染围栏代码块，不把 ``` 印进正文', async () => {
    const el = await render('```json\n{"shot_no": 1}\n```');

    expect(el.querySelectorAll('pre code')).toHaveLength(1);
    expect(el.querySelector('pre')?.textContent).toContain('"shot_no"');
    expect(el.textContent).not.toContain('```');
  });

  it('仍然支持原来就有的标题、无序列表、引用与行内标记', async () => {
    const el = await render('## 总览\n- 第一条\n> 注意\n**粗体**与 `code`');

    expect(el.querySelector('h2')?.textContent).toBe('总览');
    expect(el.querySelectorAll('ul > li')).toHaveLength(1);
    expect(el.querySelector('blockquote')?.textContent).toContain('注意');
    expect(el.querySelector('strong')?.textContent).toBe('粗体');
    expect(el.querySelector('code')?.textContent).toBe('code');
  });

  it('嵌套列表不再被拍平成同级', async () => {
    const el = await render('- 外层\n  - 内层');

    expect(el.querySelectorAll('ul li ul li')).toHaveLength(1);
  });
});
