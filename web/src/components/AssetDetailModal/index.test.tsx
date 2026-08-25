// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AssetDetailModal from './index';
import type { AssetRecord } from '@/api/assets';

let root: Root;
let container: HTMLDivElement;

function makeAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: 1,
    type: 'image',
    url: 'https://tos.test/a.png',
    width: 1024,
    height: 768,
    duration: null,
    source: 'uploaded',
    created_at: '2026-08-01T00:00:00.000Z',
    size: 1048576,
    generation_job_id: null,
    project_id: null,
    mime: 'image/png',
    model: null,
    ...overrides,
  };
}

async function render(asset: AssetRecord | null, onClose = () => {}) {
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(AssetDetailModal, { asset, onClose }));
  });
  return container;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('AssetDetailModal', () => {
  it('asset 为 null 时不渲染', async () => {
    const el = await render(null);
    expect(el.childElementCount).toBe(0);
  });

  it('展示可读字段，不出现原始 JSON 键名', async () => {
    const el = await render(makeAsset());
    expect(el.textContent).toContain('资产详情');
    expect(el.textContent).toContain('用户上传');
    expect(el.textContent).toContain('1024 × 768 px');
    expect(el.textContent).toContain('1.0 MB');
    expect(el.textContent).not.toContain('"source"');
    expect(el.textContent).not.toContain('"created_at"');
  });

  it('generated 来源显示「AI 生成」，生成模型展示展示名', async () => {
    const el = await render(
      makeAsset({ source: 'generated', model: 'Seedance 2.0 标准版' }),
    );
    expect(el.textContent).toContain('AI 生成');
    expect(el.textContent).toContain('Seedance 2.0 标准版');
  });

  it('上传资产（无生成任务）生成模型显示「—」', async () => {
    const el = await render(makeAsset());
    // 上传资产 model 为 null → 生成模型行显示 —
    expect(el.textContent).toContain('生成模型');
    expect(el.textContent).toContain('—');
  });

  it('点击遮罩触发 onClose', async () => {
    const onClose = vi.fn();
    const el = await render(makeAsset(), onClose);
    const overlay = el.querySelector('[class*="overlay"]');
    expect(overlay).not.toBeNull();
    await act(async () => {
      overlay!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击弹窗内部不触发 onClose', async () => {
    const onClose = vi.fn();
    const el = await render(makeAsset(), onClose);
    const dialog = el.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    await act(async () => {
      dialog!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
