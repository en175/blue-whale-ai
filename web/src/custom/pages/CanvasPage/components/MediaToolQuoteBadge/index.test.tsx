// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaToolQuoteBadge from './index';

const state = vi.hoisted(() => ({
  credits: 42 as number | null,
  hasData: true,
  isFetching: false,
  isError: false,
  balance: 100 as number | null,
}));

vi.mock('@/custom/api/mediaToolQuote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/custom/api/mediaToolQuote')>();
  return {
    ...actual,
    useMediaToolQuote: () => ({
      credits: state.credits,
      hasData: state.hasData,
      isFetching: state.isFetching,
      isError: state.isError,
    }),
  };
});

vi.mock('@/shared/stores/auth', () => ({
  useAuthStore: (selector: (store: { credits: number | null }) => unknown) =>
    selector({ credits: state.balance }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let mountNode: HTMLDivElement;

function withQuery(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, node);
}

async function renderBadge(input: Record<string, unknown> | null = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      withQuery(createElement(MediaToolQuoteBadge, {
        toolType: 'audio_trim',
        input,
        testId: 'quote',
      })),
    );
  });
}

function badge(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[data-testid="quote"]');
}

beforeEach(() => {
  state.credits = 42;
  state.hasData = true;
  state.isFetching = false;
  state.isError = false;
  state.balance = 100;
});

afterEach(async () => {
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('MediaToolQuoteBadge', () => {
  it('展示本次预计消耗', async () => {
    await renderBadge();
    expect(badge()!.textContent).toContain('本次预计消耗 42 积分');
  });

  it('不计费时提示当前不计费', async () => {
    state.credits = 0;
    await renderBadge();
    expect(badge()!.textContent).toContain('本工具当前不计费');
  });

  it('无计价或加载中不渲染', async () => {
    state.credits = null;
    state.hasData = false;
    await renderBadge();
    expect(badge()).toBeNull();
  });

  it('报价失败时提示暂无法报价', async () => {
    state.credits = null;
    state.isError = true;
    await renderBadge();
    expect(badge()!.textContent).toContain('暂无法报价');
  });

  it('余额低于报价时标红并带出余额', async () => {
    state.credits = 150;
    await renderBadge();
    expect(badge()!.textContent).toContain('余额 100');
  });

  it('输入为空时不渲染', async () => {
    await renderBadge(null);
    expect(badge()).toBeNull();
  });

  it('刷新中保留上次数字并降低透明度', async () => {
    state.isFetching = true;
    await renderBadge();
    expect(badge()!.textContent).toContain('本次预计消耗 42 积分');
    expect(badge()!.className).toContain('loading');
  });
});
