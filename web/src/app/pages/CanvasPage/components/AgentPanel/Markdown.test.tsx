// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api/assets', () => ({ fetchAssetDetail: vi.fn(async () => { throw new Error('asset not found'); }) }));

const { Markdown } = await import('./index');
const { rememberAssetUrl } = await import('./assetUrlCache');
type KnownAsset = import('./assetMentions').KnownAsset;

let root: Root;
let mountNode: HTMLDivElement;

async function render(element: ReturnType<typeof createElement>) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(element);
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  mountNode?.remove();
});

const smoke: KnownAsset = { assetId: '1001', label: '_smoke.jpg', mediaType: 'image' };

describe('Markdown 里的素材胶囊', () => {
  it('已知素材名换成带缩略图的胶囊，前后文字保留', async () => {
    rememberAssetUrl('1001', 'https://cdn.test/smoke.jpg');
    await render(createElement(Markdown, { text: '你上传的 _smoke.jpg 是纯色底，我照它的色调来。', assets: [smoke] }));
    const img = mountNode.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.test/smoke.jpg');
    expect(mountNode.textContent).toBe('你上传的 _smoke.jpg 是纯色底，我照它的色调来。');
    const p = mountNode.querySelector('p')!;
    const bareText = Array.from(p.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join('|');
    expect(bareText).toBe('你上传的 | 是纯色底，我照它的色调来。');
  });

  it('URL 还没反查回来时先画一颗只有名字的占位胶囊，不闪成纯文本', async () => {
    await render(createElement(Markdown, { text: '照 other.png 来', assets: [{ assetId: '2002', label: 'other.png', mediaType: 'image' }] }));
    expect(mountNode.querySelector('img')).toBeNull();
    expect(mountNode.querySelector('span[title="other.png"]')?.textContent).toBe('other.png');
  });

  it('没有已知素材、或名字不匹配：普通 Markdown 原样', async () => {
    await render(createElement(Markdown, { text: '参考 **another.png** 的色调', assets: [smoke] }));
    expect(mountNode.querySelector('img')).toBeNull();
    expect(mountNode.querySelector('strong')?.textContent).toBe('another.png');
  });

  it('流式半截名字还是字；打全了才变胶囊', async () => {
    rememberAssetUrl('1001', 'https://cdn.test/smoke.jpg');
    await render(createElement(Markdown, { text: '你上传的 _smoke.j', assets: [smoke] }));
    expect(mountNode.querySelector('img')).toBeNull();
    await act(async () => {
      root.render(createElement(Markdown, { text: '你上传的 _smoke.jpg', assets: [smoke] }));
    });
    expect(mountNode.querySelector('img')).not.toBeNull();
  });

  it('围栏代码块里的名字不动；反引号里单独一个文件名换成胶囊', async () => {
    rememberAssetUrl('1001', 'https://cdn.test/smoke.jpg');
    await render(createElement(Markdown, { text: '```\nload _smoke.jpg\n```\n\n用 `_smoke.jpg` 做底。', assets: [smoke] }));
    expect(mountNode.querySelector('pre')?.textContent).toContain('_smoke.jpg');
    expect(mountNode.querySelector('pre img')).toBeNull();
    expect(mountNode.querySelectorAll('img')).toHaveLength(1);
    expect(mountNode.querySelector('p code')).toBeNull();
  });
});
