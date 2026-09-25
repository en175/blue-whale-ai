// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModelBilling from './index';

const api = vi.hoisted(() => ({
  fetchBillingCatalog: vi.fn(),
  publishBillingCatalog: vi.fn(),
  fetchAdminModels: vi.fn(),
}));

vi.mock('@/api/adminBillingCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminBillingCatalog')>();
  return {
    ...actual,
    fetchBillingCatalog: api.fetchBillingCatalog,
    publishBillingCatalog: api.publishBillingCatalog,
    billingCatalogOptions: () => ({
      queryKey: actual.billingCatalogKeys.active(),
      queryFn: api.fetchBillingCatalog,
    }),
  };
});

/** 模型配置（能力行）：定价页只拿它派生档位候选，取不到就退回手工填键。 */
vi.mock('@/api/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/admin')>();
  return { ...actual, fetchAdminModels: api.fetchAdminModels };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let mountNode: HTMLDivElement;

/** 与 billing 里那份文档同形（键序无所谓，页面按解析后的对象走）。 */
const DOCUMENT = JSON.stringify({
  schemaVersion: 1,
  currency: 'CNY',
  creditsPerYuan: 15,
  models: {
    'doubao-seedance-2-5-260628': {
      text2video: {
        baseUnit: 'usage.seconds',
        basePrice: { kind: 'const', value: 20000 },
        unitDenominator: 1,
        minCredits: 1,
        maxCredits: null,
        rounding: 'halfUp',
      },
    },
  },
  discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
});

const CATALOG = {
  catalogVersion: 3,
  documentHash: 'abcdef0123456789',
  ruleCount: 1,
  creditsPerYuan: 15,
  document: DOCUMENT,
};

function withQuery(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, node);
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitUntilLoaded() {
  for (let i = 0; i < 25; i += 1) {
    if (!document.body.textContent?.includes('加载中…')) return;
    await settle();
  }
  throw new Error(`页面仍在加载: ${document.body.textContent}`);
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(ModelBilling)));
  });
  await waitUntilLoaded();
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`没有找到按钮：${label}`);
  return found;
}

/** 选下拉项：Select 不是原生控件（见 ui/Select），点开触发器再点 role=option。 */
async function choose(label: string, optionIncludes: string) {
  const trigger = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!trigger) throw new Error(`没有找到下拉框：${label}`);
  await click(trigger as unknown as HTMLButtonElement);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
    o.textContent?.includes(optionIncludes),
  );
  if (!option) throw new Error(`没有找到选项：${optionIncludes}`);
  await click(option as unknown as HTMLButtonElement);
}

async function click(el: HTMLButtonElement) {
  await act(async () => el.click());
  await settle();
}

async function type(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

function inputByLabel(label: string): HTMLInputElement {
  const found = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`没有找到输入框：${label}`);
  return found;
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchBillingCatalog.mockResolvedValue(CATALOG);
  // 默认：读不到能力行 → 退回手工填键（下面有专门的 describe 覆盖派生形态）
  api.fetchAdminModels.mockResolvedValue([]);
  api.publishBillingCatalog.mockResolvedValue({
    catalogVersion: 4,
    documentHash: 'ffffffff',
    ruleCount: 1,
    creditsPerYuan: 15,
  });
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('ModelBilling 模型计费', () => {
  it('渲染当前生效版本、规则与人类可读的单价', async () => {
    await renderPage();

    // 版本与内容指纹摆在页头：并发编辑时靠它判断「我手里这份是不是最新的」
    expect(document.body.textContent).toContain('当前生效 v3');
    expect(document.body.textContent).toContain('abcdef01');
    expect(document.body.textContent).toContain('doubao-seedance-2-5-260628');
    expect(document.body.textContent).toContain('text2video');
    // 单价按**元**显示（官方价目表的单位）；20000 mc = ¥1.333333 = 20 积分
    expect(document.body.textContent).toContain('1.333333 元 / 秒');
    expect(document.body.textContent).toContain('1.333333 元 / 秒（20 积分）');
  });

  it('★ 没有改动时「保存并发布」是禁用的（点一次不产生一个内容相同的新版本）', async () => {
    await renderPage();

    expect(button('保存并发布').disabled).toBe(true);
  });

  it('★ 保存的是整份：提示条写明这是整份发布、并发时后保存者覆盖先保存者', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('保存的是整份目录，不是这一行');
    expect(document.body.textContent).toContain('后保存的那份会整份覆盖先保存的那份');
  });

  it('★ 换算率的影响面写在界面上：不影响已提交任务与已下单充值，只影响之后的充值订单', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('不影响已提交的任务');
    expect(document.body.textContent).toContain('冻结');
    expect(document.body.textContent).toContain('新的充值订单');
  });

  it('改了换算率之后才能发布，且发布的是整份文档文本', async () => {
    await renderPage();

    await type(inputByLabel('1 元 = 多少积分'), '20');

    const publishButton = button('保存并发布');
    expect(publishButton.disabled).toBe(false);
    await click(publishButton);
    await click(button('确认发布'));

    expect(api.publishBillingCatalog).toHaveBeenCalledTimes(1);
    const payload = api.publishBillingCatalog.mock.calls[0]?.[0] as {
      document: string;
      note?: string;
    };
    // 发出去的是文本（不是对象），且带着这次改动；没填备注就不传 note
    expect(typeof payload.document).toBe('string');
    expect(JSON.parse(payload.document).creditsPerYuan).toBe(20);
    expect(payload).not.toHaveProperty('note');
    // 发布成功后页头换成新版本
    expect(document.body.textContent).toContain('已发布 v4');
  });

  it('发布被拒（400）时把 billing 的原话显示出来，不吞掉', async () => {
    const { ApiError } = await import('@/api/http');
    api.publishBillingCatalog.mockRejectedValue(
      new ApiError(400, '目录被拒：编译 seedance/text2video 失败：baseUnit 必填', 400),
    );

    await renderPage();
    await type(inputByLabel('1 元 = 多少积分'), '20');
    await click(button('保存并发布'));
    await click(button('确认发布'));

    expect(document.body.textContent).toContain('baseUnit 必填');
  });

  it('★ 删除规则只改草稿不落库（改动要等发布），且就此产生未发布提示', async () => {
    await renderPage();

    await click(document.body.querySelector<HTMLButtonElement>('button[aria-label="删除"]')!);
    await click(button('删除'));

    expect(document.body.textContent).toContain('还没有任何计价规则');
    expect(document.body.textContent).toContain('有未发布的改动');
    expect(api.publishBillingCatalog).not.toHaveBeenCalled();
  });

  it('有未发布的改动时「重新加载」先二次确认，避免默默丢掉编辑', async () => {
    await renderPage();

    await type(inputByLabel('1 元 = 多少积分'), '20');
    await click(button('重新加载'));

    expect(document.body.textContent).toContain('重新加载会丢弃它们');
    await click(button('丢弃改动并重新加载'));

    // 回到线上的那份：值变回 15，未发布提示消失
    expect(inputByLabel('1 元 = 多少积分').value).toBe('15');
    expect(document.body.textContent).not.toContain('有未发布的改动');
  });

  it('新增规则：校验不过时留在弹窗里说清楚，不写进草稿', async () => {
    await renderPage();

    await click(button('新增规则'));
    await click(button('确定'));

    expect(document.body.textContent).toContain('模型 ID 必填');
    expect(document.body.textContent).not.toContain('有未发布的改动');
  });

  it('新增规则：填好模型/任务/单价（**元**）后写进草稿（等发布）', async () => {
    await renderPage();

    await click(button('新增规则'));
    await type(inputByLabel('模型 ID'), 'doubao-seedream-4-0');
    await type(inputByLabel('任务类型'), 'text2image');
    // 填的是元：2 元 / 次 ⇒ 目录里写 30000 mc（creditsPerYuan=15）
    await type(inputByLabel('基准单价'), '2');
    await click(button('确定'));

    expect(document.body.textContent).toContain('doubao-seedream-4-0');
    expect(document.body.textContent).toContain('2 元 / 次');
    expect(document.body.textContent).toContain('有未发布的改动');

    await click(button('保存并发布'));
    await click(button('确认发布'));
    const payload = api.publishBillingCatalog.mock.calls[0]?.[0] as { document: string };
    const published = JSON.parse(payload.document) as {
      models: Record<string, Record<string, { basePrice: { value: number } }>>;
    };
    expect(published.models['doubao-seedream-4-0']?.text2image?.basePrice.value).toBe(30000);
  });

  it('编辑已有规则：改成的新单价进草稿，模型/任务类型这两个键不可改', async () => {
    await renderPage();

    await click(document.body.querySelector<HTMLButtonElement>('button[aria-label="编辑"]')!);

    // 键不可改：改键等于把规则挪到另一个模型下，那该是「新增 + 删除」
    expect(inputByLabel('模型 ID').disabled).toBe(true);
    expect(inputByLabel('任务类型').disabled).toBe(true);

    // 改成 51 元 / 秒（creditsPerYuan=15 ⇒ 目录里是 765000 mc）
    await type(inputByLabel('基准单价'), '51');
    await click(button('确定'));

    expect(document.body.textContent).toContain('51 元 / 秒');
    expect(document.body.textContent).toContain('51 元 / 秒（765 积分）');
    expect(document.body.textContent).toContain('有未发布的改动');

    await click(button('保存并发布'));
    await click(button('确认发布'));
    const payload = api.publishBillingCatalog.mock.calls[0]?.[0] as { document: string };
    const published = JSON.parse(payload.document) as {
      models: Record<string, Record<string, { basePrice: { value: number } }>>;
    };
    expect(published.models['doubao-seedance-2-5-260628']?.text2video?.basePrice.value).toBe(765000);
  });

  it('没有任何生效目录时给出「将发布第 1 版」而不是报错', async () => {    api.fetchBillingCatalog.mockResolvedValue({
      catalogVersion: -1,
      documentHash: '',
      ruleCount: 0,
      creditsPerYuan: -1,
      document: '',
    });

    await renderPage();

    expect(document.body.textContent).toContain('还没有生效的定价目录');
    expect(document.body.textContent).toContain('还没有任何计价规则');
  });

  it('取不到目录时显示失败与重试，而不是渲染成一份空目录', async () => {
    const { ApiError } = await import('@/api/http');
    api.fetchBillingCatalog.mockRejectedValue(new ApiError(503, 'billing 管理端不可用', 503));

    await renderPage();

    // ⚠️ 渲染成空目录会让人以为线上真的没有规则，然后拿一份空文档去发布
    expect(document.body.textContent).toContain('billing 管理端不可用');
    expect(document.body.textContent).not.toContain('还没有任何计价规则');
    expect(button('重试')).toBeTruthy();
  });
});

/* ── 视频按 token 计价：单价待配的空位、单价表、token 估算参数 ────────────────
 * 用户要的是「一个改单价的地方」：2.5 的单价火山没给，所以它在目录里是**空位**，
 * 运营在管理端填上就好 —— 界面必须让人看得出「这里是待配、提交会被拒绝」，而不是「免费」。 */
describe('ModelBilling 视频 token 计价的规则', () => {
  const TOKEN_DOCUMENT = JSON.stringify({
    schemaVersion: 1,
    currency: 'CNY',
    creditsPerYuan: 15,
    models: {
      'doubao-seedance-2-0-fast-260128': {
        video: {
          baseUnit: 'usage.c',
          basePrice: { kind: 'table', by: ['video'], table: { 'video=0': 555000, 'video=1': 330000 } },
          unitDenominator: 1000000,
          minCredits: 1,
          maxCredits: null,
          rounding: 'halfUp',
          tokenEstimate: {
            divisor: 1024,
            fps: 24,
            inputSecondsKey: 'video_input_seconds',
            dimensions: { 'resolution=720p|aspect_ratio=16:9': '1248x704' },
          },
        },
      },
      'doubao-seedance-2-5-260628': {
        video: {
          baseUnit: 'usage.c',
          basePrice: { kind: 'unset', by: ['video'] },
          unitDenominator: 1000000,
          minCredits: 1,
          maxCredits: null,
          rounding: 'halfUp',
          tokenEstimate: {
            divisor: 1024,
            fps: 24,
            inputSecondsKey: 'video_input_seconds',
            dimensions: { 'resolution=720p|aspect_ratio=16:9': '1248x704' },
          },
        },
      },
    },
    discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
  });

  beforeEach(() => {
    api.fetchBillingCatalog.mockResolvedValue({
      catalogVersion: 5,
      documentHash: 'ffffffff',
      ruleCount: 2,
      creditsPerYuan: 15,
      document: TOKEN_DOCUMENT,
    });
  });

  async function openEditorFor(modelId: string) {
    const row = [...document.body.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.includes(modelId),
    );
    const edit = row?.querySelector<HTMLButtonElement>('button[aria-label="编辑"]');
    if (!edit) throw new Error(`没有找到 ${modelId} 的编辑按钮`);
    await click(edit);
  }

  it('★ 单价待配显示为「提交会被拒绝」，不是 0 也不是空白', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('单价未配（提交会被拒绝）');
  });

  it('★ 价格表的 video 档补中文解释（存储仍只认 video=0 / video=1）', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('video=0（不含视频输入 video0）');
    expect(document.body.textContent).toContain('video=1（含视频输入 video1）');
  });

  it('★ 编辑待配的规则：弹窗讲清「不是免费」，且能就地改成按规格查表', async () => {
    await renderPage();
    await openEditorFor('doubao-seedance-2-5-260628');

    expect(document.body.textContent).toContain('单价还没填 —— 这个模型的提交会被拒绝');
    expect(document.body.textContent).toContain('不会按 0 免费生成');

    // 切成「按规格查表」，填一档价（填的是**元**：70 元 / 百万 token ⇒ 1050000 mc）
    await choose('计价方式', '按规格查表');
    await type(inputByLabel('价格表键'), 'video=0');
    await type(inputByLabel('价格表值'), '70');
    await click(button('确定'));

    // 表格里不再是「待配」，且按元显示并标出量纲
    expect(document.body.textContent).not.toContain('单价未配（提交会被拒绝）');
    expect(document.body.textContent).toContain('70 元 / 百万 token（1050 积分）');
    expect(document.body.textContent).toContain('有未发布的改动');
  });

  it('★ token 估算参数在编辑弹窗里可改（除数 / 帧率 / 尺寸表 / 输入时长键）', async () => {
    await renderPage();
    await openEditorFor('doubao-seedance-2-0-fast-260128');

    // 已有 tokenEstimate → 勾选态，四个字段都带出当前值
    expect(inputByLabel('token 除数').value).toBe('1024');
    expect(inputByLabel('token 帧率').value).toBe('24');
    expect(inputByLabel('输入时长的规格键').value).toBe('video_input_seconds');
    expect(inputByLabel('token 尺寸表键').value).toBe('resolution=720p|aspect_ratio=16:9');
    expect(inputByLabel('token 尺寸表值').value).toBe('1248x704');

    // ★ 尺寸表能在管理端改 —— 官方表没给的档位+比例组合由运营补（这里补 1080p 1:1）
    // ⚠️ 按 aria-label 取那一组的「添加一行」：一页上有四组键值表，文字都是「添加一行」
    await click(
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="给token 尺寸表添加一行"]',
      )!,
    );
    const keyInputs = document.body.querySelectorAll<HTMLInputElement>(
      'input[aria-label="token 尺寸表键"]',
    );
    const valueInputs = document.body.querySelectorAll<HTMLInputElement>(
      'input[aria-label="token 尺寸表值"]',
    );
    expect(keyInputs.length).toBe(2);
    await type(keyInputs[1]!, 'resolution=1080p|aspect_ratio=1:1');
    await type(valueInputs[1]!, '1080x1080');
    await click(button('确定'));

    await click(button('保存并发布'));
    await click(button('确认发布'));
    const payload = api.publishBillingCatalog.mock.calls[0]?.[0] as { document: string };
    const published = JSON.parse(payload.document) as {
      models: Record<
        string,
        Record<string, { tokenEstimate: { dimensions: Record<string, string> } }>
      >;
    };
    expect(
      published.models['doubao-seedance-2-0-fast-260128']?.video?.tokenEstimate.dimensions,
    ).toEqual({
      'resolution=720p|aspect_ratio=16:9': '1248x704',
      'resolution=1080p|aspect_ratio=1:1': '1080x1080',
    });
  });
});

/* ── 候选集来自模型配置（用户口径：「模型尺寸表，模型配置里面有啊」）────────────────
 *
 * 定价页此前让运营**手敲**规格键（`resolution=720p|aspect_ratio=16:9`），而同一件事已经在
 * 模型配置里声明过了 —— 两个真相源，并且已经漂过。这里钉住派生后的行为：
 * 键只读、只填数、候选集外来的是孤儿（标出来、不静默删）。
 */
describe('ModelBilling 规格键由模型配置派生', () => {
  const CAPABILITY_DOCUMENT = JSON.stringify({
    schemaVersion: 1,
    currency: 'CNY',
    creditsPerYuan: 15,
    models: {
      // 图片：按尺寸档配价。能力行是 1k/1.5k/2k，目录里却配了 1k/2k/4k —— 就是那个漂移
      'doubao-seedream-5-0-pro-260628': {
        text2image: {
          baseUnit: 'usage.succeededSlots',
          basePrice: {
            kind: 'table',
            by: ['size'],
            table: { 'size=1k': 4500, 'size=2k': 9000, 'size=4k': 9000 },
          },
          unitDenominator: 1,
          minCredits: 1,
          maxCredits: null,
          rounding: 'halfUp',
        },
      },
      // 视频：按 token 配价，尺寸表的键应当来自能力行
      'doubao-seedance-2-5-260628': {
        text2video: {
          baseUnit: 'usage.c',
          basePrice: {
            kind: 'table',
            by: ['resolution', 'video'],
            table: { 'resolution=720p|video=0': 1050000 },
          },
          unitDenominator: 1000000,
          minCredits: 1,
          maxCredits: null,
          rounding: 'halfUp',
          tokenEstimate: {
            divisor: 1024,
            fps: 24,
            inputSecondsKey: 'video_input_seconds',
            dimensions: {
              'resolution=720p|aspect_ratio=16:9': '1248x704',
              'resolution=4k|aspect_ratio=16:9': '3840x2160',
            },
          },
        },
      },
    },
    discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
  });

  /** 能力行夹具：只填本页读的字段。 */
  const capabilityRow = (over: Record<string, unknown>) => ({
    id: '1',
    provider_id: 'volcengine',
    capability_type: 'image',
    model_label: 'x',
    icon: null,
    supported_sizes: [],
    supported_aspect_ratios: [],
    supported_durations: null,
    supported_formats: [],
    default_size: null,
    default_format: null,
    default_aspect_ratio: null,
    default_duration: null,
    features: {},
    channel_parser: null,
    request_mapping: null,
    enabled: true,
    sort_order: 0,
    is_default: false,
    created_at: '',
    updated_at: '',
    ...over,
  });

  beforeEach(() => {
    api.fetchBillingCatalog.mockResolvedValue({
      catalogVersion: 6,
      documentHash: 'ffffffff',
      ruleCount: 2,
      creditsPerYuan: 15,
      document: CAPABILITY_DOCUMENT,
    });
    api.fetchAdminModels.mockResolvedValue([
      capabilityRow({
        model_id: 'doubao-seedream-5-0-pro-260628',
        model_label: 'Seedream 5.0 Pro',
        supported_sizes: [
          { id: '1k', label: '1K', api_value: '1K' },
          { id: '1.5k', label: '1.5K', api_value: '1.5K' },
          { id: '2k', label: '2K', api_value: '2K' },
        ],
        supported_aspect_ratios: ['1:1'],
        default_aspect_ratio: '1:1',
        request_mapping: { matrix: { '2K': { '1:1': '2048x2048' }, '1K': { '1:1': '1024x1024' } } },
      }),
      capabilityRow({
        model_id: 'doubao-seedance-2-5-260628',
        capability_type: 'video',
        model_label: 'Seedance 2.5',
        supported_sizes: [
          { id: '480p', label: '480P', api_value: '480p' },
          { id: '720p', label: '720P', api_value: '720p' },
        ],
        supported_aspect_ratios: ['16:9', '9:16'],
        default_aspect_ratio: '16:9',
      }),
    ]);
  });

  async function openEditorFor(modelId: string) {
    const row = [...document.body.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.includes(modelId),
    );
    const edit = row?.querySelector<HTMLButtonElement>('button[aria-label="编辑"]');
    if (!edit) throw new Error(`没有找到 ${modelId} 的编辑按钮`);
    await click(edit);
  }

  function labels(label: string): HTMLInputElement[] {
    return [...document.body.querySelectorAll<HTMLInputElement>(`input[aria-label="${label}"]`)];
  }

  it('★ 图片价格表：候选键来自能力行；能力行没有的档位标成孤儿，缺的档位直接列出来补', async () => {
    await renderPage();
    await openEditorFor('doubao-seedream-5-0-pro-260628');

    // 键是只读文本（不再是输入框）——不再有「价格表键」这种自由输入
    expect(labels('价格表键')).toHaveLength(0);
    expect(document.body.textContent).toContain('size=1k');
    expect(document.body.textContent).toContain('size=1.5k'); // 能力行有、目录缺 → 列出来等着填
    expect(document.body.textContent).toContain('size=4k'); // 目录有、能力行没有 → 孤儿
    expect(document.body.textContent).toContain('模型配置里没有这一档');
    // 像素数就摆在档位旁边：按像素分档定价时要看得见 2K = 419 万
    expect(document.body.textContent).toContain('2048x2048（419 万像素）');
    expect(document.body.textContent).toContain('1024x1024（105 万像素）');
    // 要加档位去模型配置加，这里不提供手工加行
    expect(document.body.textContent).toContain('这里不提供手工加行');
  });

  it('★ 图片价格表：给缺的那一档填价（元）→ 只把填过的档位写进目录', async () => {
    await renderPage();
    await openEditorFor('doubao-seedream-5-0-pro-260628');

    // 行序 = 候选（1k / 1.5k / 2k）+ 孤儿（4k）
    // 1.5K = 1536² = 236 万 < 261 万 ⇒ 0.30 元/张
    await type(labels('价格表值')[1]!, '0.3');
    await click(button('确定'));

    await click(button('保存并发布'));
    await click(button('确认发布'));
    const payload = api.publishBillingCatalog.mock.calls[0]?.[0] as { document: string };
    const published = JSON.parse(payload.document) as {
      models: Record<string, Record<string, { basePrice: { table: Record<string, number> } }>>;
    };
    expect(
      published.models['doubao-seedream-5-0-pro-260628']?.text2image?.basePrice.table,
    ).toEqual({
      'size=1k': 4500,
      'size=2k': 9000,
      'size=4k': 9000, // 孤儿行**保留**：静默删掉等于在保存里顺手改了别人的配置
      'size=1.5k': 4500, // 0.3 元 × 15 积分/元 × 1000 = 4500 mc
    });
  });

  it('★ 视频尺寸表：候选键 = 分辨率档 × 宽高比；能力行没有的组合是孤儿、不新增键', async () => {
    await renderPage();
    await openEditorFor('doubao-seedance-2-5-260628');

    // 候选 4 行（480p/720p × 16:9/9:16）+ 孤儿 1 行（resolution=4k|aspect_ratio=16:9）
    const keyInputs = labels('token 尺寸表键');
    expect(keyInputs).toHaveLength(0); // 键不再可手敲
    expect(labels('token 尺寸表值')).toHaveLength(5);
    expect(document.body.textContent).toContain('resolution=480p|aspect_ratio=16:9');
    expect(document.body.textContent).toContain('resolution=720p|aspect_ratio=9:16');
    expect(document.body.textContent).toContain('模型配置里没有这一档');
    // 尺寸表也没有「添加一行」
    expect(
      document.body.querySelector('button[aria-label="给token 尺寸表添加一行"]'),
    ).toBeNull();
  });

  it('★ 视频尺寸表：只填宽度就写进目录 —— 预扣推得出这一档了', async () => {
    await renderPage();
    await openEditorFor('doubao-seedance-2-5-260628');

    // 第 1 行是 resolution=480p|aspect_ratio=16:9（能力行里没有宽高，留空给运营填）
    await type(labels('token 尺寸表值')[0]!, '864x480');
    await click(button('确定'));

    await click(button('保存并发布'));
    await click(button('确认发布'));
    const payload = api.publishBillingCatalog.mock.calls[0]?.[0] as { document: string };
    const published = JSON.parse(payload.document) as {
      models: Record<
        string,
        Record<string, { tokenEstimate: { dimensions: Record<string, string> } }>
      >;
    };
    expect(
      published.models['doubao-seedance-2-5-260628']?.text2video?.tokenEstimate.dimensions,
    ).toEqual({
      'resolution=720p|aspect_ratio=16:9': '1248x704',
      // 孤儿行保留（运营没删）
      'resolution=4k|aspect_ratio=16:9': '3840x2160',
      'resolution=480p|aspect_ratio=16:9': '864x480',
    });
  });

  it('读不到能力行时退回手工填键，并在弹窗里说明原因（不替它猜一份档位清单）', async () => {
    api.fetchAdminModels.mockResolvedValue([]);

    await renderPage();
    await openEditorFor('doubao-seedance-2-5-260628');

    expect(document.body.textContent).toContain('读不到这个模型的**能力行**');
    expect(labels('token 尺寸表键')).toHaveLength(2); // 目录里既有那两行，照旧可编辑
  });
});
