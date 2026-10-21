// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioSpeedBar from './index';

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/shared/api/http', () => ({ apiRequest: http.apiRequest }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let mountNode: HTMLDivElement;
let client: QueryClient;

function element(duration: number) {
  return createElement(AudioSpeedBar, {
    onClose: vi.fn(),
    speed: 2,
    onSpeedChange: vi.fn(),
    onSend: vi.fn(),
    anchor: null,
    quoteInput: { duration },
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

beforeEach(() => {
  http.apiRequest.mockReset();
  http.apiRequest.mockResolvedValue({ credits: 3, quote_revision: 'rev' });
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

describe('AudioSpeedBar 报价接线', () => {
  it('按冻结时长请求报价并展示徽标', async () => {
    await render(31);
    await waitFor(() => document.body.textContent?.includes('本次预计消耗 3 积分') === true);

    expect(http.apiRequest).toHaveBeenCalledWith(
      '/api/media-tools/audio_speed/quote',
      {
        method: 'POST',
        body: JSON.stringify({ input: { duration: 31 } }),
        silent: true,
      },
    );
  });

  it('时长变化后按新参数重新取价', async () => {
    await render(31);
    await waitFor(() => http.apiRequest.mock.calls.length === 1);

    await render(60);
    await waitFor(() => http.apiRequest.mock.calls.length === 2);
    expect(http.apiRequest.mock.calls[1]![1]).toMatchObject({
      body: JSON.stringify({ input: { duration: 60 } }),
    });
  });
});
