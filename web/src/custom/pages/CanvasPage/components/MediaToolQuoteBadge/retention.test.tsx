// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaToolQuoteBadge from './index';

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/shared/api/http', () => ({ apiRequest: http.apiRequest }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let mountNode: HTMLDivElement;
let client: QueryClient;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function element(duration: number) {
  return createElement(MediaToolQuoteBadge, {
    toolType: 'audio_trim',
    params: { source_asset_id: String(duration) },
    testId: 'quote',
  });
}

async function render(duration: number) {
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client }, element(duration)),
    );
  });
}

async function waitFor(predicate: () => boolean, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function text() {
  return document.body.querySelector('[data-testid="quote"]')?.textContent ?? '';
}

beforeEach(() => {
  http.apiRequest.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
  client.clear();
});

describe('MediaToolQuoteBadge 参数变化', () => {
  it('新参数取价期间保留上一次报价，完成后更新', async () => {
    const first = deferred<{ credits: number; quote_revision: null }>();
    http.apiRequest.mockReturnValueOnce(first.promise);
    await render(1);
    first.resolve({ credits: 2, quote_revision: null });
    await waitFor(() => text().includes('2 积分'));

    const second = deferred<{ credits: number; quote_revision: null }>();
    http.apiRequest.mockReturnValueOnce(second.promise);
    await render(5);
    expect(text()).toContain('2 积分');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(text()).toContain('2 积分');
    expect(document.body.querySelector('[data-testid="quote"]')!.className).toContain('loading');

    second.resolve({ credits: 3, quote_revision: null });
    await waitFor(() => text().includes('3 积分'));
  });
});
