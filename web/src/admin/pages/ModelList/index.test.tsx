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

/** IKHBDO：gpt 图片行——两个尺寸档 + 两格已填的交叉矩阵。 */
const gptImage: AdminModel = {
  ...audio,
  id: '2',
  model_id: 'gpt-image-2',
  capability_type: 'image',
  model_label: 'GPT Image 2',
  supported_sizes: [
    { id: '1K', label: '1K' },
    { id: '2K', label: '2K' },
  ],
  supported_aspect_ratios: ['1:1'],
  supported_durations: null,
  supported_formats: [],
  default_size: '1K',
  default_format: null,
  default_aspect_ratio: '1:1',
  default_duration: null,
  features: { tools: true },
  channel_parser: 'gpt',
  request_mapping: { matrix: { '1K': { '1:1': '1024x1024' }, '2K': { '1:1': '2048x2048' } } },
  sort_order: 10,
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

  it('新建视频模型：时长范围与 task_types 结构化编辑都在', async () => {
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
      [...el.options].some((opt) => opt.value === 'video'),
    );
    await act(async () => {
      if (!typeSelect) return;
      typeSelect.value = 'video';
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(document.body.textContent).toContain('时长范围');
    expect(document.body.textContent).toContain('默认时长（秒）');
    // IKHBDO：task_types 此前只能在整个 features 的 JSON 里手写
    expect(document.body.textContent).toContain('任务类型比例约束 task_types');
    expect(document.body.textContent).toContain('first_last_frame');
    expect(document.body.textContent).toContain('prolong');
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

  it('新建文本模型没有供应商输入、尺寸、比例、时长区块，但有 features 出口', async () => {
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
    // IKHBDO：文本行此前既没有结构化 features 块（被类型过滤挡住），也没有高级 JSON
    // （兜底只对 image / video 渲染）——两种条件互相抵消，features 完全不可配。
    expect(document.body.textContent).toContain('特性 features（结构化）');
    expect(document.body.textContent).toContain('高级 JSON');
  });

  it('编辑音频行：默认时长可配、features 出口可达，身份字段只读展示', async () => {
    api.fetchAdminModels.mockResolvedValue([audio]);
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(ModelList));
    });
    await settle();
    const audioTab = [...mountNode.querySelectorAll('button')].find((btn) => btn.textContent === '音频');
    await act(async () => {
      audioTab?.click();
    });
    await settle();
    const editBtn = [...mountNode.querySelectorAll('button')].find((btn) => btn.title === '编辑');
    await act(async () => {
      editBtn?.click();
    });
    await settle();
    // IKHBDO：音频行的 default_duration 原先被锁在 video 专属块里——列表页却把它当「默认参数」展示
    expect(document.body.textContent).toContain('默认时长（秒）');
    const durationInputs = [...document.body.querySelectorAll('input')].filter(
      (el) => el.value === '8',
    );
    expect(durationInputs.length).toBeGreaterThan(0);
    // 音频不可配时长范围（IKG4UR 不变式），也不该出现尺寸/比例块
    expect(document.body.textContent).not.toContain('时长范围');
    expect(document.body.textContent).not.toContain('尺寸选项');
    // D：音频行此前没有任何 features 入口
    expect(document.body.textContent).toContain('特性 features（结构化）');
    expect(document.body.textContent).toContain('高级 JSON');
    // A：编辑态只读展示身份字段（类型 + 供应商）
    expect(document.body.textContent).toContain('供应商 provider_id（不可改）');
    expect(document.body.textContent).toContain('new-api');
  });

  it('编辑 seedream 图片行：出现矩阵编辑器', async () => {
    api.fetchAdminModels.mockResolvedValue([
      { ...gptImage, id: '3', channel_parser: 'seedream', request_mapping: { matrix: { '1K': { '1:1': '1024x1024' } } } },
    ]);
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(ModelList));
    });
    await settle();
    const editBtn = [...mountNode.querySelectorAll('button')].find((btn) => btn.title === '编辑');
    await act(async () => {
      editBtn?.click();
    });
    await settle();
    // A：seedream 行的尺寸换算矩阵此前只有一行提示文案，没有任何编辑入口
    expect(document.body.textContent).toContain('出站像素尺寸');
    expect(document.body.textContent).not.toContain('本期不提供映射编辑');
    const cellInputs = [...document.body.querySelectorAll('input')].filter((el) => el.value === '1024x1024');
    expect(cellInputs.length).toBe(1);
  });

  it('gpt 行删掉一个尺寸行后，其它交叉格的值仍在', async () => {
    api.fetchAdminModels.mockResolvedValue([gptImage]);
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(ModelList));
    });
    await settle();
    const editBtn = [...mountNode.querySelectorAll('button')].find((btn) => btn.title === '编辑');
    await act(async () => {
      editBtn?.click();
    });
    await settle();
    // IKHU8P：矩阵转置成「行=比例、列=尺寸」——表头首列是「比例」，后面依次是各尺寸档。
    // 这条钉住方向：行列若再被换回去（正是 IKHU8P 要修的那个缺陷），下面按 select 取值的断言全都不受影响。
    // 页面里不止这一张 table（模型列表本身也是），按首列表头文本定位到矩阵那张。
    const matrixTable = [...document.body.querySelectorAll('table')].find(
      (table) => table.querySelector('thead th')?.textContent === '比例',
    );
    expect([...(matrixTable?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent)).toEqual([
      '比例',
      '1K',
      '2K',
    ]);
    const before = [...document.body.querySelectorAll('select')].map((el) => el.value);
    expect(before).toContain('1024x1024');
    expect(before).toContain('2048x2048');
    const removeButtons = [...document.body.querySelectorAll('button')].filter(
      (btn) => btn.title === '删除尺寸行',
    );
    expect(removeButtons.length).toBe(2);
    await act(async () => {
      removeButtons[1]?.click();
    });
    await settle();
    // IKHBDO：删行 / 删比例 chip 原先按空矩阵重建，整张交叉格被清零（其余格的映射全丢）
    const after = [...document.body.querySelectorAll('select')].map((el) => el.value);
    expect(after).toContain('1024x1024');
    expect(after).not.toContain('2048x2048');
  });

  it('排序号相同的两行：上下移不再假装成功，而是说清楚并留着可改的排序输入框', async () => {
    const sameA = { ...gptImage, id: '4', model_id: 'm-a', model_label: 'A', sort_order: 5 };
    const sameB = { ...gptImage, id: '5', model_id: 'm-b', model_label: 'B', sort_order: 5 };
    api.fetchAdminModels.mockResolvedValue([sameA, sameB]);
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(ModelList));
    });
    await settle();
    // 排序号可直接编辑（原先只有一个只读单元格，重复时无处可改）
    const sortInputs = [...mountNode.querySelectorAll('input[type="number"]')];
    expect(sortInputs.length).toBe(2);
    const downBtn = [...mountNode.querySelectorAll('button')].find((btn) => btn.title === '下移');
    await act(async () => {
      downBtn?.click();
    });
    await settle();
    expect(mountNode.textContent).toContain('排序号相同');
    expect(api.updateAdminModel).not.toHaveBeenCalled();
  });
});
