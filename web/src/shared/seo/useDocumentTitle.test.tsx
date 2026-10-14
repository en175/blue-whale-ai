// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { SITE_NAME, SITE_TITLE } from './site';
import { useDocumentTitle } from './useDocumentTitle';

function TitleHost() {
  useDocumentTitle();
  const navigate = useNavigate();
  return createElement(
    'button',
    { type: 'button', onClick: () => navigate('/canvas') },
    'go-canvas',
  );
}

let root: Root;
let mountNode: HTMLDivElement;

async function renderAt(path: string) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(TitleHost)),
    );
  });
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  mountNode.remove();
});

describe('useDocumentTitle', () => {
  it('进入首页时写入站点标题', async () => {
    await renderAt('/');
    expect(document.title).toBe(SITE_TITLE);
  });

  it('切换到画布后更新浏览器标题', async () => {
    await renderAt('/');
    const button = mountNode.querySelector('button');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    expect(document.title).toBe(`画布 | ${SITE_NAME}`);
  });
});
