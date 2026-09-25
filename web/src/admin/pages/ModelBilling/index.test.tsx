// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModelBilling from './index';

const api = vi.hoisted(() => ({
  fetchBillingCatalog: vi.fn(),
  publishBillingCatalog: vi.fn(),
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
    // 20000 mc = 20 积分 ≈ ¥1.33（1 元 = 15 积分）
    expect(document.body.textContent).toContain('20000 mc');
    expect(document.body.textContent).toContain('20 积分 ≈ ¥1.33');
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

  it('新增规则：填好模型/任务/单价后写进草稿（等发布）', async () => {
    await renderPage();

    await click(button('新增规则'));
    await type(inputByLabel('模型 ID'), 'doubao-seedream-4-0');
    await type(inputByLabel('任务类型'), 'text2image');
    await type(inputByLabel('基准单价'), '50000');
    await click(button('确定'));

    expect(document.body.textContent).toContain('doubao-seedream-4-0');
    expect(document.body.textContent).toContain('50000 mc');
    expect(document.body.textContent).toContain('有未发布的改动');
  });

  it('编辑已有规则：改成的新单价进草稿，模型/任务类型这两个键不可改', async () => {
    await renderPage();

    await click(document.body.querySelector<HTMLButtonElement>('button[aria-label="编辑"]')!);

    // 键不可改：改键等于把规则挪到另一个模型下，那该是「新增 + 删除」
    expect(inputByLabel('模型 ID').disabled).toBe(true);
    expect(inputByLabel('任务类型').disabled).toBe(true);

    await type(inputByLabel('基准单价'), '30000');
    await click(button('确定'));

    expect(document.body.textContent).toContain('30000 mc');
    expect(document.body.textContent).toContain('30 积分 ≈ ¥2.00');
    expect(document.body.textContent).toContain('有未发布的改动');

    await click(button('保存并发布'));
    await click(button('确认发布'));
    const payload = api.publishBillingCatalog.mock.calls[0]?.[0] as { document: string };
    const published = JSON.parse(payload.document) as {
      models: Record<string, Record<string, { basePrice: { value: number } }>>;
    };
    expect(published.models['doubao-seedance-2-5-260628']?.text2video?.basePrice.value).toBe(30000);
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
