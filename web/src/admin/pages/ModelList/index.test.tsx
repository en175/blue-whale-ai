// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminModel } from '@/api/adminModels';
import ModelList from './index';

const api = vi.hoisted(() => ({
  fetchAdminModels: vi.fn(),
  createAdminModel: vi.fn(),
  updateAdminModel: vi.fn(),
  toggleAdminModel: vi.fn(),
  deleteAdminModel: vi.fn(),
  fetchBillingCatalog: vi.fn(),
}));



vi.mock('@/api/adminModels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminModels')>();
  return {
    ...actual,
    fetchAdminModels: api.fetchAdminModels,
    createAdminModel: api.createAdminModel,
    updateAdminModel: api.updateAdminModel,
    toggleAdminModel: api.toggleAdminModel,
    deleteAdminModel: api.deleteAdminModel,
    adminModelsOptions: () => ({
      queryKey: actual.adminModelKeys.list(),
      queryFn: () => api.fetchAdminModels(),
    }),
  };
});


vi.mock('@/api/adminBillingCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminBillingCatalog')>();
  return {
    ...actual,
    billingCatalogOptions: () => ({
      queryKey: actual.billingCatalogKeys.active(),
      queryFn: api.fetchBillingCatalog,
    }),
  };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


const CATALOG = {
  catalogVersion: 3,
  documentHash: 'abcdef0123456789',
  creditsPerYuan: 15,
  document: JSON.stringify({
    schemaVersion: 1,
    currency: 'CNY',
    creditsPerYuan: 15,
    discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
  }),
};

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
  supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
  supported_durations: null,
  supported_formats: [],
  default_size: '1K',
  default_format: null,
  default_aspect_ratio: '1:1',
  default_duration: null,
  features: { tools: true },
  channel: 'gpt-image',
  request_mapping: { matrix: { '1K': { '1:1': '1024x1024' }, '2K': { '1:1': '2048x2048' } } },
  sort_order: 10,
};




const gptInline: AdminModel = {
  ...gptImage,
  id: '7',
  model_id: 'gpt-image-2-light',
  model_label: 'GPT Image 2 Light',
};

const gptOfficial: AdminModel = {
  ...gptImage,
  id: '8',
  model_label: 'GPT Image 2',
  channel: 'gpt-image-openai',
};


const banana: AdminModel = {
  ...gptImage,
  id: '9',
  model_id: 'nano-banana-2-t2i',
  model_label: 'Nano Banana 2',
  channel: 'banana-image',
  request_mapping: { quality: { '1K': '1k' }, size: { '1:1': '1x1' } },
};


const seedreamImage: AdminModel = {
  ...gptImage,
  id: '10',
  model_id: 'seedream-4-0',
  model_label: 'Seedream 4.0',
  channel: 'seedream-image',
  features: {},
  request_mapping: { matrix: { '1K': { '1:1': '2048x2048' }, '2K': { '1:1': '2048x2048' } } },
};





const videoPriced: AdminModel = {
  ...audio,
  id: '6',
  model_id: 'doubao-seedance-2-5-260628',
  capability_type: 'video',
  model_label: 'Seedance 2.5',
  supported_sizes: [
    { id: '480p', label: '480P' },
    { id: '720p', label: '720P' },
  ],
  supported_aspect_ratios: [{ id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }],
  supported_durations: [4, 30],
  supported_formats: ['mp4'],
  default_size: '720p',
  default_format: 'mp4',
  default_aspect_ratio: '16:9',
  default_duration: 5,
  features: {},
  pricing: {
    baseUnit: 'usage.seconds',
    basePrice: { kind: 'const', value: 20000 },
    unitDenominator: 1,
    minCredits: 1,
    maxCredits: null,
    rounding: 'halfUp',
  },
  sort_order: 1,
};






const imageDimPriced: AdminModel = {
  ...audio,
  id: '11',
  model_id: 'doubao-seedream-5-0-pro-260628',
  capability_type: 'image',
  model_label: 'Seedream 5.0 Pro',
  supported_sizes: [
    { id: '1k', label: '1K' },
    { id: '2k', label: '2K' },
  ],
  supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
  supported_durations: null,
  default_size: '1k',
  default_format: null,
  default_aspect_ratio: '16:9',
  default_duration: null,
  features: {},
  sort_order: 2,
  pricing: {
    baseUnit: 'usage.succeededSlots',
    basePrice: { kind: 'table', by: ['size'], table: { 'size=1k': 4500, 'size=2k': 9000 } },
    dimPrices: { 'usage.referenceCount': { unitMc: 300, firstFree: true } },
    unitDenominator: 1,
    minCredits: 1,
    maxCredits: null,
    rounding: 'halfUp',
  },
};

let root: Root | null = null;
let mountNode: HTMLDivElement | null = null;
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function withQuery(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, node);
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root?.render(withQuery(createElement(ModelList)));
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const target = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!target) throw new Error(`没有找到按钮：${label}`);
  return target;
}

async function click(el: HTMLElement | undefined | null) {
  if (!el) throw new Error('要点的元素不存在');
  await act(async () => el.click());
  await settle();
}


async function openTab(label: string) {
  const tab = [...document.body.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!tab) throw new Error(`没有找到页签：${label}`);
  await click(tab);
}

async function openCreateModal() {
  await click(
    [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('新建模型'),
    ),
  );
}

async function openEditModal() {
  await click([...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.title === '编辑'));
}


async function openEditModalAt(index: number) {
  const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.title === '编辑',
  );
  await click(buttons[index]);
}


function channelLabel(): string {
  const trigger = document.body.querySelector<HTMLButtonElement>('button[aria-label="渠道"]');
  if (!trigger) throw new Error('没有找到渠道下拉');
  return trigger.textContent?.trim() ?? '';
}


async function channelOnBasics(): Promise<string> {
  await openTab('基础');
  return channelLabel();
}


async function pickChannel(label: string) {
  await openTab('基础');
  await pickFromSelect('渠道', label);
}









function shownMatrix(): 'gpt' | 'banana' | 'seedream' | null {
  if ((document.body.textContent ?? '').includes('尺寸 → quality')) return 'banana';
  if (document.body.querySelector('input[aria-label*=" 行 "][aria-label$=" 列"]')) return 'seedream';
  if ((document.body.textContent ?? '').includes('留空')) return 'gpt';
  return null;
}


async function openRowEdit(typeLabel: string) {
  await click(adminTab(typeLabel));
  await openEditModal();
}

function inputByLabel(label: string): HTMLInputElement {
  const found = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`没有找到输入框：${label}`);
  return found;
}

async function type(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}






async function pickFromSelect(ariaLabel: string, optionLabel: string) {
  const trigger = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
  expect(trigger).not.toBeNull();
  if (!trigger) throw new Error(`没有找到下拉框：${ariaLabel}`);
  await click(trigger);
  const option = [...document.body.querySelectorAll<HTMLLIElement>('li[role="option"]')].find(
    (li) => li.textContent === optionLabel,
  );
  expect(option).toBeTruthy();
  if (!option) throw new Error(`没有找到选项：${optionLabel}`);
  await click(option);
}


function matrixTable(): HTMLTableElement | undefined {

  return [...document.body.querySelectorAll('table')].find(
    (table) => table.querySelector('thead th')?.textContent?.trim() === '比例',
  );
}

function matrixCells(): (string | undefined)[] {
  return [...(matrixTable()?.querySelectorAll('tbody td') ?? [])].map((td) => td.textContent?.trim());
}

const adminTab = (label: string) =>
  [...mountNode!.querySelectorAll('button')].find((btn) => btn.textContent === label);

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchBillingCatalog.mockResolvedValue(CATALOG);
});

afterEach(() => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  if (root) act(() => root?.unmount());
  mountNode?.remove();
  root = null;
  mountNode = null;
  vi.clearAllMocks();
});

describe('ModelList 按类型分表单', () => {
  it('展示音频 tab，并能看到 seed-audio-1.0', async () => {
    api.fetchAdminModels.mockResolvedValue([audio]);
    await renderPage();
    await click(adminTab('音频'));
    expect(mountNode?.textContent).toContain('seed-audio-1.0');
  });

  it('新建视频模型：时长范围与 task_types 结构化编辑都在「尺寸与素材」', async () => {
    api.fetchAdminModels.mockResolvedValue([]);
    await renderPage();
    await openCreateModal();
    await pickFromSelect('类型', '视频');
    await openTab('尺寸与素材');
    expect(document.body.textContent).toContain('时长范围');
    expect(document.body.textContent).toContain('默认时长（秒）');

    expect(document.body.textContent).toContain('视频模式 task_types');
    expect(document.body.textContent).toContain('first_last_frame');
    expect(document.body.textContent).toContain('extend');
  });

  it('★ 切换渠道 → 下面换表（三种解析器各一次，都在「尺寸与素材」的「出站尺寸映射」）', async () => {
    api.fetchAdminModels.mockResolvedValue([]);
    await renderPage();
    await openCreateModal();
    await pickFromSelect('类型', '图片');


    await pickChannel('GPT 图片（内联）');
    await openTab('尺寸与素材');

    expect(document.body.textContent).toContain('出站尺寸映射（图片 · 执行期查表）');
    expect(shownMatrix()).toBe('gpt');
    await pickChannel('Banana 图片（内联）');
    await openTab('尺寸与素材');
    expect(shownMatrix()).toBe('banana');
    await pickChannel('Seedream 图片（内联）');
    await openTab('尺寸与素材');
    expect(shownMatrix()).toBe('seedream');
  });

  it('新建文本模型：基础无供应商输入、尺寸与素材无尺寸/比例/时长，但 features 与高级 JSON 仍有出口', async () => {
    api.fetchAdminModels.mockResolvedValue([]);
    await renderPage();
    await openCreateModal();
    await pickFromSelect('类型', '文生文');

    expect(document.body.textContent).not.toContain('供应商 provider_id');
    await openTab('尺寸与素材');
    expect(document.body.textContent).not.toContain('尺寸选项');
    expect(document.body.textContent).not.toContain('比例选项');
    expect(document.body.textContent).not.toContain('时长范围');


    expect(document.body.textContent).toContain('特性 features（结构化）');
    await openTab('高级');
    expect(document.body.textContent).toContain('高级 JSON');
  });

  it('编辑音频行：身份字段在「基础」，默认时长/features 在「尺寸与素材」，高级 JSON 在「高级」', async () => {
    api.fetchAdminModels.mockResolvedValue([audio]);
    await renderPage();
    await openRowEdit('音频');

    expect(document.body.textContent).toContain('供应商（不可改）');
    expect(document.body.textContent).toContain('new-api');
    expect(document.body.textContent).toContain('new-api');
    await openTab('尺寸与素材');

    expect(document.body.textContent).toContain('默认时长（秒）');
    const durationInputs = [...document.body.querySelectorAll('input')].filter((el) => el.value === '8');
    expect(durationInputs.length).toBeGreaterThan(0);

    expect(document.body.textContent).not.toContain('时长范围');
    expect(document.body.textContent).not.toContain('尺寸选项');

    expect(document.body.textContent).toContain('特性 features（结构化）');
    await openTab('高级');
    expect(document.body.textContent).toContain('高级 JSON');
  });

  it('编辑 seedream 图片行：出现矩阵编辑器（在「尺寸与素材」）', async () => {
    api.fetchAdminModels.mockResolvedValue([
      { ...gptImage, id: '3', channel: 'seedream-image', request_mapping: { matrix: { '1K': { '1:1': '1024x1024' } } } },
    ]);
    await renderPage();
    await openEditModal();
    await openTab('尺寸与素材');

    expect(shownMatrix()).toBe('seedream');
    const cellInputs = [...document.body.querySelectorAll('input')].filter((el) => el.value === '1024x1024');
    expect(cellInputs.length).toBe(1);
  });

  it('「高级」tab 只剩 JSON 兜底：渠道控件与三张映射表都不在了', async () => {
    api.fetchAdminModels.mockResolvedValue([gptImage]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('高级');
    expect(document.body.textContent).toContain('高级 JSON');
    expect(document.body.textContent).toContain('未识别字段');

    expect(document.body.querySelector('button[aria-label="渠道"]')).toBeNull();
    expect(matrixTable()).toBeUndefined();
    expect(shownMatrix()).toBeNull();
  });

  it('gpt 行删掉一个尺寸行后，其它交叉格的值仍在', async () => {
    api.fetchAdminModels.mockResolvedValue([gptImage]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('尺寸与素材');


    expect([...(matrixTable()?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent?.trim())).toEqual([
      '比例',
      '1K',
      '2K',
    ]);

    expect(matrixCells()).toContain('1024x1024');
    expect(matrixCells()).toContain('2048x2048');

    const removeButtons = [...document.body.querySelectorAll('button')].filter(
      (btn) => btn.title === '删除尺寸行',
    );
    expect(removeButtons.length).toBe(2);
    await click(removeButtons[1]);

    expect(matrixCells()).toContain('1024x1024');
    expect(matrixCells()).not.toContain('2048x2048');
  });

  it('★ 矩阵改一格再保存：request_mapping 逐字不变（搬动不改值）', async () => {
    api.fetchAdminModels.mockResolvedValue([gptImage]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('尺寸与素材');
    await pickFromSelect('1:1 行 1K 列', '1536x1024');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(payload.request_mapping).toEqual({
      matrix: { '1K': { '1:1': '1536x1024' }, '2K': { '1:1': '2048x2048' } },
    });
  });

  it('排序号相同的两行：上下移不再假装成功，而是说清楚并留着可改的排序输入框', async () => {
    const sameA = { ...gptImage, id: '4', model_id: 'm-a', model_label: 'A', sort_order: 5 };
    const sameB = { ...gptImage, id: '5', model_id: 'm-b', model_label: 'B', sort_order: 5 };
    api.fetchAdminModels.mockResolvedValue([sameA, sameB]);
    await renderPage();

    const sortInputs = [...(mountNode?.querySelectorAll('input[type="number"]') ?? [])];
    expect(sortInputs.length).toBe(2);
    await click([...(mountNode?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((btn) => btn.title === '下移'));
    expect(mountNode?.textContent).toContain('排序号相同');
    expect(api.updateAdminModel).not.toHaveBeenCalled();
  });
});







describe('ModelList 定价 tab', () => {
  it('已配的价按「积分」显示，量纲由基准维度与单位分母推出来', async () => {
    api.fetchAdminModels.mockResolvedValue([videoPriced]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('定价');


    expect(inputByLabel('基准单价').value).toBe('20');
    expect(document.body.textContent).toContain('基准单价（积分 / 秒）');

    expect(document.body.textContent).not.toContain('元');
  });

  it('★ 没碰过定价 tab：保存**完全不提交** pricing（库里那份原样保留）', async () => {
    api.fetchAdminModels.mockResolvedValue([videoPriced]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');

    await type(inputByLabel('第 1 行展示名'), '864');
    await click(button('保存'));

    expect(api.updateAdminModel).toHaveBeenCalledTimes(1);
    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toHaveProperty('supported_sizes');
    expect(payload).not.toHaveProperty('pricing');
  });

  it('★ 碰过定价但没改价：报「未检测到任何变更」，不把没动过的价挪走哪怕 1 mc', async () => {
    api.fetchAdminModels.mockResolvedValue([videoPriced]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('定价');

    await type(inputByLabel('基准单价'), '1.5');
    await type(inputByLabel('基准单价'), '20');
    await click(button('保存'));

    expect(api.updateAdminModel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('未检测到任何变更');
  });

  it('★ 还没配价的模型：明说「提交会被拒绝」，并能从零配一条（写回 mc）', async () => {
    api.fetchAdminModels.mockResolvedValue([audio]);
    await renderPage();
    await openRowEdit('音频');
    await openTab('定价');

    expect(document.body.textContent).toContain('这条模型还没配价');
    expect(document.body.textContent).toContain('提交会被拒绝');

    await pickFromSelect('基准维度', 'constant:1（按次）');
    await type(inputByLabel('基准单价'), '2');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(payload.pricing).toEqual({
      baseUnit: 'constant:1',
      basePrice: { kind: 'const', value: 2000 },
      unitDenominator: 1,
      minCredits: 1,
      rounding: 'halfUp',
      maxCredits: null,
    });
  });

  it('★ 没填价就保存：拦下来并说明原因，不落一条编出来的 mc', async () => {
    api.fetchAdminModels.mockResolvedValue([audio]);
    await renderPage();
    await openRowEdit('音频');
    await openTab('定价');

    await pickFromSelect('基准维度', 'constant:1（按次）');
    await click(button('保存'));

    expect(api.updateAdminModel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('基准单价必填');
  });
});








describe('ModelList 视频模式「时长跟随原视频」（IKK7QC）', () => {
  const withEdit = {
    ...videoPriced,
    features: { task_types: { edit: { allowed_ratios: ['adaptive'] } } },
  };

  function followBoxes(): HTMLElement[] {
    return [...document.body.querySelectorAll<HTMLElement>('[role="checkbox"]')].filter((el) =>
      el.closest('label')?.textContent?.includes('时长跟随原视频'),
    );
  }

  it('★ 勾上「时长跟随原视频」保存 → task_types 带 allowed_durations: [-1]', async () => {
    api.fetchAdminModels.mockResolvedValue([withEdit]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');

    expect(followBoxes()).toHaveLength(7);
    await click(followBoxes()[5]);
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as { features: Record<string, unknown> };
    expect(payload.features.task_types).toEqual({
      edit: { allowed_ratios: ['adaptive'], allowed_durations: [-1] },
    });
  });

  it('未开放的模式上该勾选框置灰：勾了也会被整条删掉，不该让它看起来能勾', async () => {
    api.fetchAdminModels.mockResolvedValue([withEdit]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');

    const boxes = followBoxes();
    expect(boxes[0]?.getAttribute('aria-disabled')).toBe('true');
    expect(boxes[5]?.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('ModelList 维度绝对加价 dimPrices', () => {

  function checkboxByLabel(label: string): HTMLElement {
    const box = [...document.body.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((el) =>
      el.closest('label')?.textContent?.includes(label),
    );
    if (!box) throw new Error(`没有找到复选框：${label}`);
    return box;
  }

  it('★ 已配的绝对加价按「积分」显示，「首张免费」是勾着的', async () => {
    api.fetchAdminModels.mockResolvedValue([imageDimPriced]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('定价');


    expect(inputByLabel('维度绝对加价第 1 行单价').value).toBe('0.3');
    expect(checkboxByLabel('首张免费').getAttribute('aria-checked')).toBe('true');

    expect(document.body.textContent).toContain('维度绝对加价（积分 / 每个单位）');
  });

  it('★ 改单价：按积分换算成 mc 写回，首张免费跟着走', async () => {
    api.fetchAdminModels.mockResolvedValue([imageDimPriced]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('定价');
    await type(inputByLabel('维度绝对加价第 1 行单价'), '0.05');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as { pricing: Record<string, unknown> };

    expect(payload.pricing.dimPrices).toEqual({
      'usage.referenceCount': { unitMc: 50, firstFree: true },
    });
  });

  it('★ 碰过定价但没改加价：报「未检测到任何变更」，不把没动过的加价挪走哪怕 1 mc', async () => {

    api.fetchAdminModels.mockResolvedValue([
      {
        ...videoPriced,
        pricing: {

          ...(videoPriced.pricing as Record<string, unknown>),
          dimPrices: { 'usage.referenceCount': { unitMc: 100000 } },
        },
      },
    ]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('定价');

    await type(inputByLabel('维度绝对加价第 1 行单价'), '1');
    await type(inputByLabel('维度绝对加价第 1 行单价'), '100');
    await click(button('保存'));

    expect(api.updateAdminModel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('未检测到任何变更');
  });

  it('★ 与积分上限互斥：同时配时拦下保存并说清原因（后端写闸门同一条）', async () => {
    api.fetchAdminModels.mockResolvedValue([imageDimPriced]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('定价');

    await type(inputByLabel('积分上限'), '50');
    await click(button('保存'));

    expect(api.updateAdminModel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('不能同时配');
  });
});








describe('ModelList 输出像素表 video_dimensions', () => {

  function dimensionTable(): HTMLTableElement | undefined {
    return [...document.body.querySelectorAll('table')].find(
      (table) => table.querySelector('thead th')?.textContent === '比例',
    );
  }

  function headers(): (string | null)[] {
    return [...(dimensionTable()?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent?.trim());
  }

  function bodyRows(): string[][] {
    return [...(dimensionTable()?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? ''),
    );
  }

  it('★ 矩阵形态：行=比例选项、列=尺寸选项；键由本行派生，没有手敲键的地方', async () => {
    api.fetchAdminModels.mockResolvedValue([videoPriced]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');


    expect(document.body.textContent).toContain('输出像素表 video_dimensions（视频 · 决定发给上游的输出像素）');

    expect(headers()).toEqual(['比例', '480P', '720P']);
    expect(bodyRows().map((cells) => cells[0])).toEqual(['16:9', '9:16']);

    expect(document.body.querySelectorAll('input[aria-label="输出像素表值"]')).toHaveLength(0);
    expect(document.body.querySelectorAll('input[aria-label="16:9 行 480P 列"]')).toHaveLength(1);
    expect(document.body.querySelectorAll('input[aria-label="9:16 行 720P 列"]')).toHaveLength(1);
    const cells = [...document.body.querySelectorAll<HTMLInputElement>('input[aria-label$=" 列"]')];
    expect(cells.map((el) => el.placeholder)).toEqual(['留空', '留空', '留空', '留空']);
  });

  it('★ 新建一格：键按本行的档位 × 比例拼出来', async () => {
    api.fetchAdminModels.mockResolvedValue([videoPriced]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');

    await type(inputByLabel('16:9 行 480P 列'), '864x496');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as { features: Record<string, unknown> };
    expect(payload.features.video_dimensions).toEqual({
      'resolution=480p|aspect_ratio=16:9': '864x496',
    });
  });

  it('★ 档位大小写不一致：格子照样显示得出值，写回还保留库里原来的键', async () => {


    api.fetchAdminModels.mockResolvedValue([
      {
        ...videoPriced,
        supported_sizes: [
          { id: '4k', label: '4K', api_value: '4K' },
          { id: '720p', label: '720P', api_value: '720p' },
        ],
        supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
        features: { video_dimensions: { 'resolution=4k|aspect_ratio=16:9': '3840x2160' } },
      },
    ]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');

    expect(inputByLabel('16:9 行 4K 列').value).toBe('3840x2160');


    await type(inputByLabel('16:9 行 720P 列'), '1280x720');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as { features: Record<string, unknown> };
    expect(payload.features.video_dimensions).toEqual({

      'resolution=4k|aspect_ratio=16:9': '3840x2160',

      'resolution=720p|aspect_ratio=16:9': '1280x720',
    });
  });

  it('★ 派生不出候选（本行没配尺寸/比例）→ 退回自由键值编辑，不猜一份档位清单', async () => {
    api.fetchAdminModels.mockResolvedValue([
      {
        ...videoPriced,
        supported_sizes: [],
        supported_aspect_ratios: [],
        features: { video_dimensions: { 'resolution=480p|aspect_ratio=16:9': '864x496' } },
      },
    ]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');

    expect(document.body.textContent).toContain('本行还没配尺寸档与比例，键派生不出来');

    expect(dimensionTable()).toBeUndefined();
    expect(inputByLabel('输出像素表键').value).toBe('resolution=480p|aspect_ratio=16:9');
    expect(inputByLabel('输出像素表值').value).toBe('864x496');
  });

  it('库里有、本行档位里没有的键标成孤儿（不静默丢掉）', async () => {
    api.fetchAdminModels.mockResolvedValue([
      { ...videoPriced, features: { video_dimensions: { 'resolution=4k|aspect_ratio=16:9': '3840x2160' } } },
    ]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');

    expect(document.body.textContent).toContain('resolution=4k|aspect_ratio=16:9');
    expect(document.body.textContent).toContain('模型配置里没有这一档');
  });
});







describe('ModelList 渠道', () => {
  it('★ gpt-image 与 gpt-image-openai 读出来是两个不同渠道（同一解析器两种协议，换协议 = 新渠道）', async () => {
    api.fetchAdminModels.mockResolvedValue([gptInline, gptOfficial]);
    await renderPage();
    await openRowEdit('图片');
    expect(await channelOnBasics()).toBe('GPT 图片（内联）');
    await openTab('尺寸与素材');

    expect(shownMatrix()).toBe('gpt');

    await click(button('取消'));
    await openEditModalAt(1);
    expect(await channelOnBasics()).toBe('GPT 图片（官方 openai images 协议）');
    await openTab('尺寸与素材');
    expect(shownMatrix()).toBe('gpt');
  });

  it('★ banana-image 行读出来是 Banana 渠道', async () => {
    api.fetchAdminModels.mockResolvedValue([banana]);
    await renderPage();
    await openRowEdit('图片');
    expect(await channelOnBasics()).toBe('Banana 图片（内联）');
    await openTab('尺寸与素材');
    expect(shownMatrix()).toBe('banana');
  });

  it('★ seedream 图片行（库里 image_protocol 是 NULL）：只改别的东西 → 不提交 features，那个键不会被添出来', async () => {
    api.fetchAdminModels.mockResolvedValue([seedreamImage]);
    await renderPage();
    await openRowEdit('图片');
    expect(await channelOnBasics()).toBe('Seedream 图片（内联）');
    await openTab('尺寸与素材');
    await type(inputByLabel('第 1 行展示名'), '1536');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toHaveProperty('supported_sizes');

    expect(payload).not.toHaveProperty('features');
  });

  it('★ banana 行（显式 inline-image）：只改别的东西 → features 逐字不变', async () => {
    api.fetchAdminModels.mockResolvedValue([banana]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('尺寸与素材');
    await type(inputByLabel('第 1 行展示名'), '1536');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('features');
  });

  it('★ gpt 官方协议行：只改别的东西 → image_protocol 仍是 openai-images（不被抹成缺省）', async () => {
    api.fetchAdminModels.mockResolvedValue([gptOfficial]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('尺寸与素材');
    await type(inputByLabel('第 1 行展示名'), '1536');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('features');
  });

  it('★ 同一解析器换协议：提交的是渠道，出站协议不再单独落键', async () => {
    api.fetchAdminModels.mockResolvedValue([gptInline]);
    await renderPage();
    await openRowEdit('图片');
    await pickChannel('GPT 图片（官方 openai images 协议）');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(payload.channel).toBe('gpt-image-openai');

    expect(payload).not.toHaveProperty('features');
  });

  it('★ 切回内联渠道：提交的是渠道，features 一个字都不动', async () => {
    api.fetchAdminModels.mockResolvedValue([gptOfficial]);
    await renderPage();
    await openRowEdit('图片');
    await pickChannel('GPT 图片（内联）');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.channel).toBe('gpt-image');
    expect(payload).not.toHaveProperty('features');
  });

  it('★ seedream 行切到 Banana：渠道换、映射表跟着换', async () => {
    api.fetchAdminModels.mockResolvedValue([seedreamImage]);
    await renderPage();
    await openRowEdit('图片');
    await pickChannel('Banana 图片（内联）');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.channel).toBe('banana-image');
    expect(payload.request_mapping).toEqual({ quality: {}, size: {} });
  });

  it('★ 出站协议没有自由文本框、也不在高级 JSON 里（它由渠道决定，键已整键退役）', async () => {
    api.fetchAdminModels.mockResolvedValue([gptOfficial]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('尺寸与素材');
    expect(document.body.textContent).not.toContain('出站图片协议');
    await openTab('高级');

    expect(document.body.querySelector('textarea')?.value ?? '').not.toContain('image_protocol');
  });
});
