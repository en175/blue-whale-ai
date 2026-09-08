// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminModel } from '@/api/admin';
import ModelList from './index';

const api = vi.hoisted(() => ({
  fetchAdminModels: vi.fn(),
  createAdminModel: vi.fn(),
  updateAdminModel: vi.fn(),
  toggleAdminModel: vi.fn(),
  deleteAdminModel: vi.fn(),
}));

vi.mock('@/api/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/admin')>();
  return {
    ...actual,
    fetchAdminModels: api.fetchAdminModels,
    createAdminModel: api.createAdminModel,
    updateAdminModel: api.updateAdminModel,
    toggleAdminModel: api.toggleAdminModel,
    deleteAdminModel: api.deleteAdminModel,
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const audio: AdminModel = {
  id: '1',
  provider_id: 'new-api',
  model_id: 'seed-audio-1.0',
  capability_type: 'audio',
  model_label: '豆包 Seed Audio 1.0',
  icon: null,
  supported_sizes: [],
  supported_aspect_ratios: [],
  supported_durations: [1, 120],
  supported_formats: ['mp3'],
  default_size: null,
  default_format: 'mp3',
  default_aspect_ratio: null,
  default_duration: 8,
  features: {},
  enabled: true,
  sort_order: 30,
  is_default: false,
  created_at: '2026-09-04T00:00:00.000Z',
  updated_at: '2026-09-04T00:00:00.000Z',
};

let root: Root;
let mountNode: HTMLDivElement;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('ModelList 按类型分表单', () => {
  afterEach(() => {
    act(() => root.unmount());
    mountNode.remove();
    vi.clearAllMocks();
  });

  it('展示音频 tab，并能看到 seed-audio-1.0', async () => {
    api.fetchAdminModels.mockResolvedValue([audio]);
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(ModelList));
    });
    await settle();
    const audioTab = [...mountNode.querySelectorAll('button')].find((btn) => btn.textContent === '音频');
    expect(audioTab).toBeTruthy();
    await act(async () => {
      audioTab?.click();
    });
    await settle();
    expect(mountNode.textContent).toContain('seed-audio-1.0');
  });

  it('图片选 gpt 出现交叉格，选 banana 出现一维映射', async () => {
    api.fetchAdminModels.mockResolvedValue([]);
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(ModelList));
    });
    await settle();
    const createBtn = [...mountNode.querySelectorAll('button')].find((btn) => btn.textContent?.includes('新建模型'));
    await act(async () => {
      createBtn?.click();
    });
    await settle();
    const parserSelect = [...document.body.querySelectorAll('select')].find((el) =>
      [...el.options].some((opt) => opt.value === 'gpt'),
    );
    expect(parserSelect).toBeTruthy();
    await act(async () => {
      if (!parserSelect) return;
      parserSelect.value = 'gpt';
      parserSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(document.body.textContent).toContain('格子填官方 size');
    await act(async () => {
      if (!parserSelect) return;
      parserSelect.value = 'banana';
      parserSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(document.body.textContent).toContain('尺寸选项 → quality');
    expect(document.body.textContent).not.toContain('格子填官方 size');
  });

  it('新建文本模型没有供应商、尺寸、比例、时长区块', async () => {
    api.fetchAdminModels.mockResolvedValue([]);
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(ModelList));
    });
    await settle();
    const createBtn = [...mountNode.querySelectorAll('button')].find((btn) => btn.textContent?.includes('新建模型'));
    await act(async () => {
      createBtn?.click();
    });
    await settle();
    const typeSelect = [...document.body.querySelectorAll('select')].find((el) =>
      [...el.options].some((opt) => opt.value === 'text'),
    );
    expect(typeSelect).toBeTruthy();
    await act(async () => {
      if (!typeSelect) return;
      typeSelect.value = 'text';
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(document.body.textContent).not.toContain('供应商 provider_id');
    expect(document.body.textContent).not.toContain('尺寸选项');
    expect(document.body.textContent).not.toContain('比例选项');
    expect(document.body.textContent).not.toContain('时长范围');
    expect(document.body.textContent).not.toContain('高级 JSON');
  });
});
