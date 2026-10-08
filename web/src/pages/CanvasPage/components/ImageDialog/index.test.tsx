// @vitest-environment jsdom
/* IKJIVN：图片面板报价请求不携带 target_node_id——草稿目标合并是视频端契约
 * （IKJGE6），图片端不进入该逻辑，报价行为同旧（面板不传目标，Badge 不带键）。
 * 本文件只挂报价 payload 这一条最小渲染面，面板交互由后续工单按需补。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageDialog from './index';

const fetchGenerationModels = vi.hoisted(() =>
  vi.fn(async () => [
    {
      model_id: 'm-image',
      provider_id: 'prov',
      model_label: '测试图片模型',
      icon: null,
      supported_sizes: [{ id: '2k', label: '2K', api_value: '2k', width: null, height: null }],
      supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
      supported_formats: ['png'],
      supported_durations: null,
      default_size: '2k',
      default_format: 'png',
      default_aspect_ratio: '1:1',
      default_duration: null,
      features: { reference_image: true, image_reference_max: 4 },
      is_default: false,
      version: 1,
      digest: '',
    },
  ]),
);

vi.mock('@/api/generation', () => ({ fetchGenerationModels }));

let root: Root;
let container: HTMLDivElement;

async function renderDialog() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(ImageDialog, {
          onClose: () => {},
          onSend: () => {},
          projectId: 'p1',
        }),
      ),
    );
  });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe('IKJIVN 图片面板报价不带 target_node_id', () => {
  it('报价请求体为图片定价维度，且无 target_node_id 键', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 200, msg: null, data: { credits: 5 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await renderDialog();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.type).toBe('image');
    expect(body.parameters.model_id).toBe('m-image');
    expect(body).not.toHaveProperty('target_node_id');
  });
});
