// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountCredits from './index';
import { formatSpecs } from './format';

let root: Root;
let mountNode: HTMLDivElement;

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/account/credits'] }, createElement(AccountCredits)));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function clickByText(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((node) => node.textContent === text);
  button?.click();
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('AccountCredits', () => {
  it('展示三张汇总卡与积分明细占位表', async () => {
    await renderPage();
    expect(document.body.textContent).toContain('账户积分与订单');
    expect(document.body.textContent).toContain('12,345');
    expect(document.body.textContent).toContain('24 个月');
    expect(document.body.textContent).toContain('剩余 1,200 积分');
    expect(document.body.textContent).toContain('已获取');
    expect(document.body.textContent).toContain('充值到账');
    expect(document.body.textContent).not.toContain('支付成功待到账');
  });

  it('切换订单记录可复制订单号，已退回为空态', async () => {
    await renderPage();
    await act(async () => {
      clickByText('订单记录');
    });
    expect(document.body.textContent).toContain('复制订单号');
    expect(document.body.textContent).toContain('待支付');
    expect(document.body.textContent).not.toContain('支付成功待到账');

    await act(async () => {
      clickByText('复制订单号');
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('BW20260929143200801');

    await act(async () => {
      clickByText('积分明细');
    });
    await act(async () => {
      clickByText('已退回');
    });
    expect(document.body.textContent).toContain('暂无记录');
  });
});

describe('formatSpecs 任务规格拼串', () => {
  it('按白名单顺序取键，duration 补 s', () => {
    expect(formatSpecs({ resolution: '1080p', duration: '5' })).toBe('1080p · 5s');
    expect(formatSpecs({ size: '1024x1024' })).toBe('1024x1024');
  });

  it('duration 非正数整项不显示（edit 冻结 -1）', () => {
    expect(formatSpecs({ resolution: '1080p', duration: '-1' })).toBe('1080p');
  });

  it('忽略计费派生键，全空回退 —', () => {
    expect(formatSpecs({ reference_count: '0', video: '0' })).toBe('—');
    expect(formatSpecs({})).toBe('—');
    expect(formatSpecs(null)).toBe('—');
  });
});
