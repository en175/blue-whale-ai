// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminModel } from '@/api/admin';
import ModelList from './index';

const api = vi.hoisted(() => ({
  fetchAdminModels: vi.fn(),
  createAdminModel: vi.fn(),
  updateAdminModel: vi.fn(),
  toggleAdminModel: vi.fn(),
  deleteAdminModel: vi.fn(),
  fetchBillingCatalog: vi.fn(),
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

/** 定价 tab 要读换算率（住定价目录里）才能把 mc 渲染成「元」，所以这一层必须给数据。 */
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

/** 换算率 15 的那份目录（与 billing 里那份同形）。 */
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
  channel: 'gpt-image',
  request_mapping: { matrix: { '1K': { '1:1': '1024x1024' }, '2K': { '1:1': '2048x2048' } } },
  sort_order: 10,
};

/** IKF4LI：**同一个解析器（gpt）、两种协议**——`gpt-image-2-light` 的 `features.image_protocol`
 *  在库里是 NULL（键不存在），`gpt-image-2` 是显式 `openai-images`。两者必须读成两个渠道
 *  （所以存储不能真合并成一个字段）。 */
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

/** banana 行：**显式** `inline-image`（迁移有意写在明面上），与 NULL 同义。 */
const banana: AdminModel = {
  ...gptImage,
  id: '9',
  model_id: 'nano-banana-2-t2i',
  model_label: 'Nano Banana 2',
  channel: 'banana-image',
  request_mapping: { quality: { '1K': '1k' }, size: { '1:1': '1x1' } },
};

/** seedream 行：`features.image_protocol` 是 NULL（本来就不带这个键）——保存不该给它添一个。 */
const seedreamImage: AdminModel = {
  ...gptImage,
  id: '10',
  model_id: 'seedream-4-0',
  model_label: 'Seedream 4.0',
  channel: 'seedream-image',
  features: {},
  request_mapping: { matrix: { '1K': { '1:1': '2048x2048' }, '2K': { '1:1': '2048x2048' } } },
};

/**
 * 视频行：两个档位 × 两个比例，且**已经带上 `pricing`**（定价搬到能力行之后的形态）。
 * 20000 mc ÷ 15 积分/元 ÷ 1000 = 1.333333 元。
 */
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
  supported_aspect_ratios: ['16:9', '9:16'],
  supported_durations: [4, 30],
  supported_formats: ['mp4'],
  default_size: '720p',
  default_format: 'mp4',
  default_aspect_ratio: '16:9',
  default_duration: 5,
  features: {},
  pricing: {
    baseUnit: 'usage.c',
    basePrice: { kind: 'const', value: 20000 },
    unitDenominator: 1000000,
    minCredits: 1,
    maxCredits: null,
    rounding: 'halfUp',
  },
  sort_order: 1,
};

/**
 * Seedream 5.0 Pro 的形态：输出图按像素分档（0.3 / 0.6 元），参考图**第 2 张起 0.02 元/张**
 * （首张免费）。`dimPrices` 就是为第二项而生的 —— `dims` 是万分比（相对量），
 * 同一个 0.02 元在两档下会算出两个价。300 mc ÷ 15 积分/元 ÷ 1000 = 0.02 元。
 */
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
  supported_aspect_ratios: ['16:9'],
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

/** 点弹窗里的某个 tab（顶部那排 role=tab；页面上的类型 tab 文字与它们不重合）。 */
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

/** 第 index 行的「编辑」（列表里多行时按顺序取，点第 N 个才能开对行）。 */
async function openEditModalAt(index: number) {
  const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.title === '编辑',
  );
  await click(buttons[index]);
}

/** 「渠道」下拉当前选中的文案（套件 Select 把选中项渲染在触发器上）。 */
function channelLabel(): string {
  const trigger = document.body.querySelector<HTMLButtonElement>('button[aria-label="渠道"]');
  if (!trigger) throw new Error('没有找到渠道下拉');
  return trigger.textContent?.trim() ?? '';
}

/** 渠道在**「基础」**tab 里配（身份级决策），这里读它的当前值。 */
async function channelOnBasics(): Promise<string> {
  await openTab('基础');
  return channelLabel();
}

/** 在「基础」里把渠道切到某个选项。 */
async function pickChannel(label: string) {
  await openTab('基础');
  await pickFromSelect('渠道', label);
}

/** 当前「出站尺寸映射」显示的是哪张表。
 *
 *  ⚠️ **不按 Hint 文案判**：那些解释已经收进「?」图标（悬停才出现），文案不在 DOM 里。
 *  改按**表自己的形态**判，比文案更稳（文案会改写，表的形态不会）：
 *    · banana → 两张一维表的表头「尺寸 → quality」/「比例 → size」
 *    · seedream → 格子是 Input，aria-label 形如「1:1 行 1K 列」
 *    · gpt → 格子是 Select，选中项文案「留空」
 *  三者的判据互斥，所以判定顺序不影响结果。 */
function shownMatrix(): 'gpt' | 'banana' | 'seedream' | null {
  if ((document.body.textContent ?? '').includes('尺寸 → quality')) return 'banana';
  if (document.body.querySelector('input[aria-label*=" 行 "][aria-label$=" 列"]')) return 'seedream';
  if ((document.body.textContent ?? '').includes('留空')) return 'gpt';
  return null;
}

/** 切到某个类型 tab，再点那一行的「编辑」（模型列表按类型分 tab，不是所有行都在当前页签下）。 */
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

/**
 * 弹窗里的下拉已从原生 select 换成套件的自绘 Select（原生控件外观由 OS 决定，
 * 系统深色模式下会渲染成深色方块）：先点触发器展开，再点候选项。
 * 定位方式变了，断言意图不变。
 */
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

/** 弹窗里那个「gpt 矩阵」表（页面本身也有 table，按首列表头文本定位）。 */
function matrixTable(): HTMLTableElement | undefined {
  // ⚠️ trim：表头是「比例 <Hint/>」——图标没有文字，但 JSX 里的换行/空格会进 textContent
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
    // IKHBDO：task_types 此前只能在整个 features 的 JSON 里手写
    expect(document.body.textContent).toContain('任务类型比例约束 task_types');
    expect(document.body.textContent).toContain('first_last_frame');
    expect(document.body.textContent).toContain('prolong');
  });

  it('★ 切换渠道 → 下面换表（三种解析器各一次，都在「尺寸与素材」的「出站尺寸映射」）', async () => {
    api.fetchAdminModels.mockResolvedValue([]);
    await renderPage();
    await openCreateModal();
    await pickFromSelect('类型', '图片');
    // 控制项（渠道）在「基础」，它控制的表在「尺寸与素材」——
    // 两张 tab 各司其职：渠道是身份决策，表长什么样是执行期细节。
    await pickChannel('GPT 图片（内联）');
    await openTab('尺寸与素材');
    // 三张表同在一个 tab，各自的小节标题说清谁是谁（图片这张是执行期查表）
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
    // 基础 tab：创建态不展示供应商
    expect(document.body.textContent).not.toContain('供应商 provider_id');
    await openTab('尺寸与素材');
    expect(document.body.textContent).not.toContain('尺寸选项');
    expect(document.body.textContent).not.toContain('比例选项');
    expect(document.body.textContent).not.toContain('时长范围');
    // IKHBDO：文本行此前既没有结构化 features 块（被类型过滤挡住），也没有高级 JSON
    // （兜底只对 image / video 渲染）——两种条件互相抵消，features 完全不可配。
    expect(document.body.textContent).toContain('特性 features（结构化）');
    await openTab('高级');
    expect(document.body.textContent).toContain('高级 JSON');
  });

  it('编辑音频行：身份字段在「基础」，默认时长/features 在「尺寸与素材」，高级 JSON 在「高级」', async () => {
    api.fetchAdminModels.mockResolvedValue([audio]);
    await renderPage();
    await openRowEdit('音频');
    // 基础 tab：编辑态只读展示身份字段（类型 + 供应商）
    expect(document.body.textContent).toContain('供应商（不可改）');
    expect(document.body.textContent).toContain('new-api');
    expect(document.body.textContent).toContain('new-api');
    await openTab('尺寸与素材');
    // IKHBDO：音频行的 default_duration 原先被锁在 video 专属块里——列表页却把它当「默认参数」展示
    expect(document.body.textContent).toContain('默认时长（秒）');
    const durationInputs = [...document.body.querySelectorAll('input')].filter((el) => el.value === '8');
    expect(durationInputs.length).toBeGreaterThan(0);
    // 音频不可配时长范围（IKG4UR 不变式），也不该出现尺寸/比例块
    expect(document.body.textContent).not.toContain('时长范围');
    expect(document.body.textContent).not.toContain('尺寸选项');
    // D：音频行此前没有任何 features 入口
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
    // A：seedream 行的尺寸换算矩阵此前只有一行提示文案，没有任何编辑入口
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
    // 搬走的四块一个都不该留在「高级」：渠道控件、以及三张映射表（按表本身的形态判）
    expect(document.body.querySelector('button[aria-label="渠道"]')).toBeNull();
    expect(matrixTable()).toBeUndefined();
    expect(shownMatrix()).toBeNull();
  });

  it('gpt 行删掉一个尺寸行后，其它交叉格的值仍在', async () => {
    api.fetchAdminModels.mockResolvedValue([gptImage]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('尺寸与素材');
    // IKHU8P：矩阵转置成「行=比例、列=尺寸」——表头首列是「比例」，后面依次是各尺寸档。
    // 这条钉住方向：行列若再被换回去（正是 IKHU8P 要修的那个缺陷），下面按 select 取值的断言全都不受影响。
    expect([...(matrixTable()?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent?.trim())).toEqual([
      '比例',
      '1K',
      '2K',
    ]);
    // 格子里的下拉已换成套件 Select，选中的官方 size 就显示在触发器上
    expect(matrixCells()).toContain('1024x1024');
    expect(matrixCells()).toContain('2048x2048');
    // 尺寸行与矩阵现在同在一个 tab：删行不必来回切页签
    const removeButtons = [...document.body.querySelectorAll('button')].filter(
      (btn) => btn.title === '删除尺寸行',
    );
    expect(removeButtons.length).toBe(2);
    await click(removeButtons[1]);
    // IKHBDO：删行 / 删比例 chip 原先按空矩阵重建，整张交叉格被清零（其余格的映射全丢）
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
    // 矩阵的键仍是 size.id（1K / 2K）、值仍是官方 size —— 与搬动前「高级」tab 里改出来的形态一致
    expect(payload.request_mapping).toEqual({
      matrix: { '1K': { '1:1': '1536x1024' }, '2K': { '1:1': '2048x2048' } },
    });
  });

  it('排序号相同的两行：上下移不再假装成功，而是说清楚并留着可改的排序输入框', async () => {
    const sameA = { ...gptImage, id: '4', model_id: 'm-a', model_label: 'A', sort_order: 5 };
    const sameB = { ...gptImage, id: '5', model_id: 'm-b', model_label: 'B', sort_order: 5 };
    api.fetchAdminModels.mockResolvedValue([sameA, sameB]);
    await renderPage();
    // 排序号可直接编辑（原先只有一个只读单元格，重复时无处可改）
    const sortInputs = [...(mountNode?.querySelectorAll('input[type="number"]') ?? [])];
    expect(sortInputs.length).toBe(2);
    await click([...(mountNode?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((btn) => btn.title === '下移'));
    expect(mountNode?.textContent).toContain('排序号相同');
    expect(api.updateAdminModel).not.toHaveBeenCalled();
  });
});

/* ── 定价 tab：原「模型计费」页的定价编辑收进模型列表 ─────────────────────────────
 *
 * 数据现在长在能力行上（`pricing`），保存是一次普通 PUT。这里钉住两条不变式：
 *   ① 没碰过定价 tab ⇒ **完全不提交** pricing（库里那份原样保留）；
 *   ② 碰过但没改价 ⇒ 恒等写回（「打开看一眼、点保存」不会把价挪动哪怕 1 mc）。
 */
describe('ModelList 定价 tab', () => {
  it('已配的价按「元」显示，量纲由基准维度与单位分母推出来', async () => {
    api.fetchAdminModels.mockResolvedValue([videoPriced]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('定价');

    // 20000 mc ÷ 15 积分/元 ÷ 1000 = 1.333333 元
    expect(inputByLabel('基准单价').value).toBe('1.333333');
    expect(document.body.textContent).toContain('基准单价（元 / 百万 token）');
    // 换算率的说明收进「?」里（默认不占版面），需要时才展开
    expect(document.body.textContent).not.toContain('1 元 = 15 积分');
  });

  it('★ 没碰过定价 tab：保存**完全不提交** pricing（库里那份原样保留）', async () => {
    api.fetchAdminModels.mockResolvedValue([videoPriced]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');
    // 只改一个与定价无关的字段（尺寸行的像素宽）
    await type(inputByLabel('第 1 行像素宽'), '864');
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
    // 改一个别的值再改回来 —— 文本与原值渲染出来的文本逐字相同 ⇒ 原值写回
    await type(inputByLabel('基准单价'), '1.5');
    await type(inputByLabel('基准单价'), '1.333333');
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
    // 2 元 / 次 × 15 积分/元 × 1000 = 30000 mc
    expect(payload.pricing).toEqual({
      baseUnit: 'constant:1',
      basePrice: { kind: 'const', value: 30000 },
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
    // 只选了基准维度、价没填（这一步已经算「动过定价」，所以走校验而不是静默不提交）
    await pickFromSelect('基准维度', 'constant:1（按次）');
    await click(button('保存'));

    expect(api.updateAdminModel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('基准单价必填');
  });
});

/* ── 维度绝对加价（`dimPrices`）：每个单位**固定**多少钱，与基准单价无关 ──────────────
 *
 * 这一块是 Seedream 5.0 Pro 的「参考图第 2 张起 0.02 元/张、首张免费」进来的：
 * `dims` 是万分比（金额随笔单价变），表达不了「同一个 0.02 元作用在 0.3 / 0.6 两档上」。
 * 这里钉住三件运营真会做的事：看得见（元）、改得动（写回 mc）、以及配不成非法组合
 * （unitMc 必须 > 0、与积分上限互斥 —— 两条都是后端写闸门同一口径）。
 */
describe('ModelList 维度绝对加价 dimPrices', () => {
  /** 「首张免费」这类带中文 label 的复选框（点击处理挂在 label 上，见 ui/Checkbox）。 */
  function checkboxByLabel(label: string): HTMLElement {
    const box = [...document.body.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((el) =>
      el.closest('label')?.textContent?.includes(label),
    );
    if (!box) throw new Error(`没有找到复选框：${label}`);
    return box;
  }

  it('★ 已配的绝对加价按「元」显示，「首张免费」是勾着的', async () => {
    api.fetchAdminModels.mockResolvedValue([imageDimPriced]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('定价');

    // 300 mc ÷ 15 积分/元 ÷ 1000 = 0.02 元
    expect(inputByLabel('维度绝对加价第 1 行单价').value).toBe('0.02');
    expect(checkboxByLabel('首张免费').getAttribute('aria-checked')).toBe('true');
    // 解释收进「?」里：展开前不占版面
    expect(document.body.textContent).toContain('维度绝对加价（元 / 每个单位）');
  });

  it('★ 改单价：按元换算成 mc 写回，首张免费跟着走', async () => {
    api.fetchAdminModels.mockResolvedValue([imageDimPriced]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('定价');
    await type(inputByLabel('维度绝对加价第 1 行单价'), '0.05');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as { pricing: Record<string, unknown> };
    // 0.05 元 × 15 积分/元 × 1000 = 750 mc
    expect(payload.pricing.dimPrices).toEqual({
      'usage.referenceCount': { unitMc: 750, firstFree: true },
    });
  });

  it('★ 碰过定价但没改加价：报「未检测到任何变更」，不把没动过的加价挪走哪怕 1 mc', async () => {
    // 除不尽的 mc（100000 mc = ¥6.666666…）：只按「元 → mc」换算会漂，必须命中「原值写回」那条分支
    api.fetchAdminModels.mockResolvedValue([
      {
        ...videoPriced,
        pricing: {
          // `AdminModel.pricing` 是 unknown（形态由 catalogDraft 的 CatalogRuleView 描述）
          ...(videoPriced.pricing as Record<string, unknown>),
          dimPrices: { 'usage.referenceCount': { unitMc: 100000 } },
        },
      },
    ]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('定价');
    // 改一个别的值再改回来 —— 文本与「原值渲染出来的文本」逐字相同 ⇒ 原值写回
    await type(inputByLabel('维度绝对加价第 1 行单价'), '1');
    await type(inputByLabel('维度绝对加价第 1 行单价'), '6.666667');
    await click(button('保存'));

    expect(api.updateAdminModel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('未检测到任何变更');
  });

  it('★ 与积分上限互斥：同时配时拦下保存并说清原因（后端写闸门同一条）', async () => {
    api.fetchAdminModels.mockResolvedValue([imageDimPriced]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('定价');
    // 加价在里面、上限在外面，两边都在这一页上
    await type(inputByLabel('积分上限'), '50');
    await click(button('保存'));

    expect(api.updateAdminModel).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('不能同时配');
  });
});

/* ── 输出像素表（`features.video_dimensions`）：**行=比例、列=尺寸**的矩阵 ────────────
 *
 * 存储仍是扁平的 `"resolution=480p|aspect_ratio=16:9" → "864x496"`（不跨进程：跨进程的是
 * backend 解析出来的 output_width / output_height 两个标量），矩阵只是视图。
 * 键由本行的「档位 × 比例」派生——后端写闸门要求键形如 `resolution=X|aspect_ratio=Y`、
 * 值形如 `WxH`，形态不对直接拒存，所以矩阵里没有人手敲键的地方。
 */
describe('ModelList 输出像素表 video_dimensions', () => {
  /** 输出像素表那张矩阵（行列方向与 gpt / seedream 的矩阵一致：首列是「比例」）。 */
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

    // 图片行那张「出站尺寸映射」不在视频行渲染：这里只有视频这张，标题点明它只在预扣时用
    expect(document.body.textContent).toContain('输出像素表 video_dimensions（视频 · 只在预扣估 token 时用）');
    // 列头是尺寸档（2 个），首列是比例；行是比例选项（2 个）
    expect(headers()).toEqual(['比例', '480P', '720P']);
    expect(bodyRows().map((cells) => cells[0])).toEqual(['16:9', '9:16']);
    // 2 比例 × 2 档位 = 4 个格子，每个格子是可编辑的宽高输入框
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
    // 能力行的 api_value 写 `4K`，库里的键是从定价目录搬来的 `4k` —— 同一个值的两种写法。
    // 不做归一比较的话，`4K` 那一整列会显示成空，运营一保存就把已配的像素抹掉。
    api.fetchAdminModels.mockResolvedValue([
      {
        ...videoPriced,
        supported_sizes: [
          { id: '4k', label: '4K', api_value: '4K' },
          { id: '720p', label: '720P', api_value: '720p' },
        ],
        supported_aspect_ratios: ['16:9'],
        features: { video_dimensions: { 'resolution=4k|aspect_ratio=16:9': '3840x2160' } },
      },
    ]);
    await renderPage();
    await openRowEdit('视频');
    await openTab('尺寸与素材');

    expect(inputByLabel('16:9 行 4K 列').value).toBe('3840x2160');

    // 只改另一个格子再保存
    await type(inputByLabel('16:9 行 720P 列'), '1280x720');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as { features: Record<string, unknown> };
    expect(payload.features.video_dimensions).toEqual({
      // 恒等写回：没动过的格子键还是库里的 `4k`，不被一次保存改成 `4K`
      'resolution=4k|aspect_ratio=16:9': '3840x2160',
      // 新建的格子才按本行的 api_value 拼键
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
    // 没有矩阵，只有自由键值编辑（库里有几行就显示几行）
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

/* ── 渠道：能力行 `channel` 列（取代 channel_parser × features.image_protocol 两个字段）──
 *
 * 一个渠道 = 一个固定组合（解析器 × 协议），不给自由组合。渠道是**解析与出站的唯一来源**：
 * 它在「基础」tab 里配（身份级决策），「尺寸与素材」只回显、并据此决定显示哪张映射表。
 * 旧的两个字段已随 040 迁移删掉/清空，代码里没有读方。
 */
describe('ModelList 渠道', () => {
  it('★ gpt-image 与 gpt-image-openai 读出来是两个不同渠道（同一解析器两种协议，换协议 = 新渠道）', async () => {
    api.fetchAdminModels.mockResolvedValue([gptInline, gptOfficial]);
    await renderPage();
    await openRowEdit('图片');
    expect(await channelOnBasics()).toBe('GPT 图片（内联）');
    await openTab('尺寸与素材');
    // 解析器仍是 gpt：下面显示的是那张 gpt 交叉格
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
    await type(inputByLabel('第 1 行像素宽'), '1536');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toHaveProperty('supported_sizes');
    // 渠道路径下 features 逐字未变 ⇒ diff 层判成没变更，整个 features 都不提交
    expect(payload).not.toHaveProperty('features');
  });

  it('★ banana 行（显式 inline-image）：只改别的东西 → features 逐字不变', async () => {
    api.fetchAdminModels.mockResolvedValue([banana]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('尺寸与素材');
    await type(inputByLabel('第 1 行像素宽'), '1536');
    await click(button('保存'));

    const payload = api.updateAdminModel.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('features');
  });

  it('★ gpt 官方协议行：只改别的东西 → image_protocol 仍是 openai-images（不被抹成缺省）', async () => {
    api.fetchAdminModels.mockResolvedValue([gptOfficial]);
    await renderPage();
    await openRowEdit('图片');
    await openTab('尺寸与素材');
    await type(inputByLabel('第 1 行像素宽'), '1536');
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
    // 同一解析器换协议 = **另一个渠道**（渠道是解析与出站的唯一来源）
    expect(payload.channel).toBe('gpt-image-openai');
    // 出站协议不再单独落一个 features 键：提交体里连 features 都不该出现
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
    // 库里这一行已经没有这个键了（040 迁移清掉），界面上自然也不该冒出来
    expect(document.body.querySelector('textarea')?.value ?? '').not.toContain('image_protocol');
  });
});
