// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/http';
import BillingTab from './BillingTab';
import { creditsPerYuanError, floorFactorBpError } from './billingSiteParams';

const api = vi.hoisted(() => ({
  fetchBillingCatalog: vi.fn(),
  publishBillingCatalog: vi.fn(),
}));

vi.mock('@/admin/api/adminBillingCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/admin/api/adminBillingCatalog')>();
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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let mountNode: HTMLDivElement;


const MODELS = {
  'seedance-2.5': {
    text2video: {
      baseUnit: 'usage.seconds',
      basePrice: {
        kind: 'table',
        table: { 'video=0': 100000, 'video=1': 180000 },
      },
      unitDenominator: 1000000,
      minCredits: 1,
      maxCredits: null,
      rounding: 'halfUp',
      dims: { 'usage.referenceCount': 4000 },
      tokenEstimate: {
        divisor: 1024,
        fps: 24,
        dimensions: { 'size=2k|ratio=16:9': '2560x1440' },
        minimumTokens: { 'size=2k|ratio=16:9|seconds=5': 200000 },
      },
      futureRuleField: { 别: '删我' },
    },
  },
  'seedream-4.0': {
    text2image: {
      baseUnit: 'usage.succeededSlots',
      basePrice: { kind: 'const', value: 1800 },
      unitDenominator: 1,
      minCredits: 1,
      rounding: 'halfUp',
    },
  },
  'doubao-seed-1.6': {
    text: {
      baseUnit: 'usage.c',
      basePrice: { kind: 'unset' },
      unitDenominator: 1000000,
      minCredits: 1,
      rounding: 'halfUp',
    },
  },
} as const;

const DOC_OBJ = {
  schemaVersion: 1,
  currency: 'CNY',
  creditsPerYuan: 15,
  futureTopLevel: '别删我',
  models: MODELS,
  discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
};

const PUBLISHED_KEYS = ['creditsPerYuan', 'currency', 'discountPolicy', 'schemaVersion'];

const CATALOG = {
  catalogVersion: 3,
  documentHash: 'hash-v3',
  creditsPerYuan: 15,
  document: JSON.stringify(DOC_OBJ),
};

const CATALOG_V4 = {
  catalogVersion: 4,
  documentHash: 'hash-v4',
  creditsPerYuan: 20,
  document: JSON.stringify({
    schemaVersion: 1,
    currency: 'CNY',
    creditsPerYuan: 20,
    discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
  }),
};

const PUBLISH_RESULT = {
  catalogVersion: 4,
  documentHash: 'hash-v4',
  creditsPerYuan: 20,
};

const RATE_LABEL = '换算率：1 元 = 多少积分';
const FLOOR_LABEL = '折扣底线（万分比）';
const STACK_LABEL = '折扣叠加方式';


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

async function click(el: Element) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
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
  if (!found) throw new Error(`没有找到输入框：${label}（页面上有：${document.body.textContent}）`);
  return found;
}

function publishButton(): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes('发布新版本'),
  );
  if (!found) throw new Error(`没有找到发布按钮（页面上有：${document.body.textContent}）`);
  return found;
}

async function openSelect(trigger: HTMLElement) {
  await act(async () => {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    trigger.dispatchEvent(event);
  });
  await settle();
}

async function choose(label: string, optionIncludes: string) {
  const trigger = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!trigger) throw new Error(`没有找到下拉框：${label}`);
  await openSelect(trigger);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
    o.textContent?.includes(optionIncludes),
  );
  if (!option) throw new Error(`没有找到选项：${optionIncludes}`);
  await click(option);
}

async function renderTab() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(BillingTab)));
  });
  await settle();
}

async function waitForForm() {
  for (let i = 0; i < 25; i += 1) {
    const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${RATE_LABEL}"]`);
    if (input?.value === '15') return;
    await settle();
  }
  throw new Error(`表单没被目录对齐（页面上有：${document.body.textContent}）`);
}

function lastPublishInput(): { document: string; note?: string } {
  const call = api.publishBillingCatalog.mock.calls.at(-1);
  if (!call) throw new Error('一次发布请求都没有发出去');
  return call[0] as { document: string; note?: string };
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchBillingCatalog.mockResolvedValue(CATALOG);
  api.publishBillingCatalog.mockResolvedValue(PUBLISH_RESULT);
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});


describe('站点级参数校验', () => {
  it('换算率越界时逐字复述 billing 编译器的拒绝口径', () => {
    expect(creditsPerYuanError('100001')).toBe(
      'creditsPerYuan=100001 不合法：它表示「1 元等于多少积分」，合法范围 1 ~ 100000（超过上界说明多半是多敲了 0）',
    );
  });

  it('换算率必须是非空正整数（0 / 小数 / 空串都拦）', () => {
    expect(creditsPerYuanError('0')).toContain('不合法');
    expect(creditsPerYuanError('15.5')).toBe('换算率必须是正整数（1 元等于多少积分，如 15）');
    expect(creditsPerYuanError('  ')).toBe('换算率必须是正整数（1 元等于多少积分，如 15）');
    expect(creditsPerYuanError('1')).toBeNull();
    expect(creditsPerYuanError('100000')).toBeNull();
  });

  it('折扣底线：整数、大于 0、不超过 10000（超过 10000 是加价不是打折）', () => {
    expect(floorFactorBpError('3000')).toBeNull();
    expect(floorFactorBpError('10000')).toBeNull();
    expect(floorFactorBpError('0')).toContain('必须大于 0');
    expect(floorFactorBpError('10001')).toContain('加价');
    expect(floorFactorBpError('3.5')).toContain('必须是整数');
  });
});


describe('★ 保存 = 白名单重建一份只有站点级字段的目录', () => {
  it('只改换算率：发出去的文档里没有 models 段，也没有别的历史残留键', async () => {
    await renderTab();
    await waitForForm();

    await type(inputByLabel(RATE_LABEL), '20');
    await click(publishButton());

    const posted = JSON.parse(lastPublishInput().document) as Record<string, unknown>;

    expect(posted).not.toHaveProperty('models');
    expect(posted).not.toHaveProperty('futureTopLevel');
    expect(Object.keys(posted).sort()).toEqual(PUBLISHED_KEYS);
    expect(posted).toEqual({
      schemaVersion: 1,
      currency: 'CNY',
      creditsPerYuan: 20,
      discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
    });
  });

  it('只改折扣策略：同样只有站点级字段，且没动的那一项逐字不变', async () => {
    await renderTab();
    await waitForForm();

    await choose(STACK_LABEL, 'best');
    await type(inputByLabel(FLOOR_LABEL), '4000');
    await click(publishButton());

    const posted = JSON.parse(lastPublishInput().document) as Record<string, unknown>;

    expect(Object.keys(posted).sort()).toEqual(PUBLISHED_KEYS);
    expect(posted).toEqual({
      schemaVersion: 1,
      currency: 'CNY',
      creditsPerYuan: 15,
      discountPolicy: { stackMode: 'best', floorFactorBp: 4000 },
    });
  });

  it('发布备注按实际改了的项写（只改换算率就不该像改过折扣）', async () => {
    await renderTab();
    await waitForForm();

    await type(inputByLabel(RATE_LABEL), '20');
    await click(publishButton());

    expect(lastPublishInput().note).toBe('系统设置·计费：换算率 15 → 20');
  });
});


describe('整份发布的保存语义', () => {
  it('保存前就明说「会发布一版新目录」，按钮上写着新版本号', async () => {
    await renderTab();
    await waitForForm();

    expect(publishButton().textContent).toContain('v3 → v4');
    expect(document.body.textContent).not.toContain('保存会发布一版新的定价目录');
  });

  it('保存后回显新版本号，并按新版本重取目录', async () => {
    api.fetchBillingCatalog
      .mockResolvedValueOnce(CATALOG)
      .mockResolvedValue(CATALOG_V4);
    await renderTab();
    await waitForForm();

    await type(inputByLabel(RATE_LABEL), '20');
    await click(publishButton());

    expect(document.body.textContent).toContain('已发布 v4');
    expect(inputByLabel(RATE_LABEL).value).toBe('20');
    expect(publishButton().textContent).toContain('v4 → v5');
    expect(publishButton().disabled).toBe(true);
    expect(api.fetchBillingCatalog).toHaveBeenCalledTimes(2);
  });

  it('★ 原文里残留着 models 段时，没改动也仍然是灰的（基线按同一口径重建，不拿原文比）', async () => {
    await renderTab();
    await waitForForm();

    expect(JSON.parse(CATALOG.document)).toHaveProperty('models');
    expect(publishButton().disabled).toBe(true);
    expect(api.publishBillingCatalog).not.toHaveBeenCalled();
  });

  it('拦下不合法的换算率：不发请求，并显示编译器口径的错误', async () => {
    await renderTab();
    await waitForForm();

    await type(inputByLabel(RATE_LABEL), '100001');

    expect(document.body.textContent).toContain(
      'creditsPerYuan=100001 不合法：它表示「1 元等于多少积分」，合法范围 1 ~ 100000（超过上界说明多半是多敲了 0）',
    );
    expect(publishButton().disabled).toBe(true);

    await click(publishButton());
    expect(api.publishBillingCatalog).not.toHaveBeenCalled();
  });

  it('发布失败：说清改动没生效、目录仍是当前版本', async () => {
    api.publishBillingCatalog.mockRejectedValueOnce(
      new ApiError(400, 'creditsPerYuan=0 不合法：它表示「1 元等于多少积分」'),
    );
    await renderTab();
    await waitForForm();

    await type(inputByLabel(RATE_LABEL), '20');
    await click(publishButton());

    expect(document.body.textContent).toContain('creditsPerYuan=0 不合法');
    expect(document.body.textContent).toContain('目录仍是 v3');
    expect(document.body.textContent).not.toContain('已发布');
  });

  it('还没有生效目录时不装作能改：给提示，不给发布按钮', async () => {
    api.fetchBillingCatalog.mockResolvedValue({
      catalogVersion: -1,
      documentHash: '',
      creditsPerYuan: -1,
      document: '',
    });
    await renderTab();

    expect(document.body.textContent).toContain('还没有生效的定价目录');
    expect(
      [...document.body.querySelectorAll('button')].some((b) =>
        b.textContent?.includes('发布新版本'),
      ),
    ).toBe(false);
  });

  it('目录文档解析不了时不发布（拿没读懂的内容覆盖更坏）', async () => {
    api.fetchBillingCatalog.mockResolvedValue({
      ...CATALOG,
      document: '{ 不是 json',
    });
    await renderTab();

    expect(document.body.textContent).toContain('定价目录文档解析失败');
    expect(api.publishBillingCatalog).not.toHaveBeenCalled();
  });
});
