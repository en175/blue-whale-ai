// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRecord } from '@/api/assets';
import type { JobSourceTarget } from '@/components/JobSourceModal';
import AssetDetailModal from './components/AssetDetailModal';
import { AssetCard } from './components/AssetMasonry';


let root: Root;
let mountNode: HTMLDivElement;
let queryClient: QueryClient;

const baseVideoAsset: AssetRecord = {
  id: '77',
  type: 'video',
  url: 'https://tos.test/77.mp4',
  width: 864,
  height: 480,
  duration: 5,
  size: 4096,
  source: 'generated',
  model: 'Seedance 2.5',
  created_at: '2026-09-29T07:00:00.000Z',
};

async function renderDetail(asset: AssetRecord | null, onOpenSource?: (t: JobSourceTarget) => void) {
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(AssetDetailModal, {
        asset,
        onClose: () => {},
        onOpenSource,
      })),
    );
  });
}

async function renderCard(asset: AssetRecord) {
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(AssetCard, {
        asset,
        libraryMode: true,
        selected: false,
      })),
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('资产库两阶段标注（IKIZQI）', () => {
  it('详情弹窗：样片资产显示「样片 480P」徽标与「查看成片任务」来源按钮', async () => {
    const onOpenSource = vi.fn();
    await renderDetail(
      { ...baseVideoAsset, video_stage: 'sample', final_job_id: '305', source_sample_job_id: null },
      onOpenSource,
    );

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('样片 480P');

    const sourceButton = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('查看成片任务'),
    );
    expect(sourceButton).toBeDefined();
    await act(async () => {
      sourceButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenSource).toHaveBeenCalledWith({ jobId: '305', title: '成片任务' });
  });

  it('详情弹窗：成片资产显示「成片 1080P」徽标与「查看来源样片」按钮（反向链路）', async () => {
    const onOpenSource = vi.fn();
    await renderDetail(
      {
        ...baseVideoAsset,
        id: '88',
        width: 1920,
        height: 1080,
        video_stage: 'final',
        source_sample_job_id: '302',
        final_job_id: null,
      },
      onOpenSource,
    );

    expect(document.body.textContent ?? '').toContain('成片 1080P');

    const sourceButton = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('查看来源样片'),
    );
    expect(sourceButton).toBeDefined();
    await act(async () => {
      sourceButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenSource).toHaveBeenCalledWith({ jobId: '302', title: '来源样片任务' });
  });

  it('详情弹窗：旧普通视频（缺阶段字段）不渲染阶段徽标与来源行', async () => {
    await renderDetail({ ...baseVideoAsset }, undefined);

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toContain('样片 480P');
    expect(bodyText).not.toContain('成片 1080P');
    expect(bodyText).not.toContain('视频阶段');
  });

  it('卡片：样片/成片视频显示阶段徽标，旧普通视频与图片不显示', async () => {
    await renderCard({ ...baseVideoAsset, video_stage: 'sample' });
    expect(document.body.textContent ?? '').toContain('样片 480P');

    await renderCard({ ...baseVideoAsset, id: '88', video_stage: 'final' });
    expect(document.body.textContent ?? '').toContain('成片 1080P');

    await renderCard({ ...baseVideoAsset });
    expect(document.body.textContent ?? '').not.toContain('样片 480P');
    expect(document.body.textContent ?? '').not.toContain('成片 1080P');

    await renderCard({ ...baseVideoAsset, type: 'image', video_stage: 'sample' });
    expect(document.body.textContent ?? '').not.toContain('样片 480P');
  });
});
