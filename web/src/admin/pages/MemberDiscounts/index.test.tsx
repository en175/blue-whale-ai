// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import MemberDiscounts from './index';

const api = vi.hoisted(() => ({
  fetchMemberDiscounts: vi.fn(),
  createMemberDiscount: vi.fn(),
  updateMemberDiscount: vi.fn(),
  deleteMemberDiscount: vi.fn(),
  fetchBillingCatalog: vi.fn(),
}));

vi.mock('@/api/adminBillingDiscounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminBillingDiscounts')>();
  return {
    ...actual,
    fetchMemberDiscounts: api.fetchMemberDiscounts,
    createMemberDiscount: api.createMemberDiscount,
    updateMemberDiscount: api.updateMemberDiscount,
    deleteMemberDiscount: api.deleteMemberDiscount,
    memberDiscountsOptions: () => ({
      queryKey: actual.memberDiscountKeys.list(),
      queryFn: api.fetchMemberDiscounts,
    }),
  };
});

vi.mock('@/api/adminBillingCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminBillingCatalog')>();
  return {
    ...actual,
    fetchBillingCatalog: api.fetchBillingCatalog,
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

const ROWS = [
  {
    id: 1,
    tier: 'pro',
    modelPattern: '*',
    taskPattern: '*',
    discountBp: 9000,
    priority: 0,
    status: 'enabled',
    gmtCreate: '2026-09-20T10:00:00',
    gmtModified: '2026-09-20T10:00:00',
  },
  {
    id: 2,
    tier: 'max',
    modelPattern: 'seedance-*',
    taskPattern: 'text2video',
    discountBp: 8000,
    priority: 5,
    status: 'disabled',
    gmtCreate: '2026-09-21T10:00:00',
    gmtModified: '2026-09-21T10:00:00',
  },
];

const CATALOG = {
  catalogVersion: 3,
  documentHash: 'abc',
  creditsPerYuan: 15,
  document: JSON.stringify({
    schemaVersion: 1,
    currency: 'CNY',
    creditsPerYuan: 15,
    discountPolicy: { stackMode: 'best', floorFactorBp: 3000 },
  }),
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

async function click(el: Element) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(MemberDiscounts)));
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`没有找到按钮：${label}（页面上有：${document.body.textContent}）`);
  return found;
}

function buttonByAria(label: string): HTMLButtonElement {
  const found = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`没有找到按钮：${label}`);
  return found;
}

async function choose(label: string, optionIncludes: string) {
  const trigger = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!trigger) throw new Error(`没有找到下拉框：${label}`);
  await click(trigger);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) =>
    o.textContent?.includes(optionIncludes),
  );
  if (!option) throw new Error(`没有找到选项：${optionIncludes}`);
  await click(option);
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
  api.fetchMemberDiscounts.mockResolvedValue(ROWS);
  api.fetchBillingCatalog.mockResolvedValue(CATALOG);
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('会员折扣页', () => {
  it('列出等级（中文名）、折扣（折）与状态', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('专业');
    expect(document.body.textContent).toContain('9 折');
    expect(document.body.textContent).toContain('8 折');
    expect(document.body.textContent).toContain('停用');
    expect(document.body.textContent).toContain('万分比 9000');
  });

  it('★ 冻结语义写在最上面：改折扣不影响已提交未结算的任务', async () => {
    await renderPage();

    const help = document.body.querySelector('button[aria-label="说明"]');
    expect(help, '页面顶部应有一个「?」').not.toBeNull();
    expect(document.body.textContent).not.toContain('改折扣不影响已提交未结算的任务');
    expect(help!.compareDocumentPosition(document.body.querySelector('table')!) &
      Node.DOCUMENT_POSITION_FOLLOWING, '「?」应在表格之前（最上面）').toBeTruthy();
  });

  it('★ 叠加方式与底线只读展示（当前目录是 best / 3000）', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('best');
    expect(document.body.textContent).toContain('3 折（3000）');
    expect(document.body.textContent).not.toContain('目录级配置');
    expect(document.body.textContent).not.toContain('同时命中 →');
    expect(document.body.querySelectorAll('button[aria-label="说明"]').length).toBeGreaterThan(0);
  });

  it('读不到定价目录时提示去模型计费页，而不是装作没这回事', async () => {
    api.fetchBillingCatalog.mockRejectedValue(new Error('boom'));
    await renderPage();

    expect(document.body.textContent).toContain('读不到当前的折扣叠加策略');
  });

  it('没有数据时给空态与入口，而不是一片空白', async () => {
    api.fetchMemberDiscounts.mockResolvedValue([]);
    await renderPage();

    expect(document.body.textContent).toContain('还没有任何会员折扣');
  });

  it('保存失败用 Alert danger 呈现后端给的原话', async () => {
    api.createMemberDiscount.mockRejectedValue(new ApiError(400, '折扣必须大于 0'));
    await renderPage();

    await click(button('新增折扣'));
    await choose('会员等级', '专业（pro）');
    await click(button('保存'));

    const alerts = [...document.body.querySelectorAll('[role="status"]')].map((a) => a.textContent);
    expect(alerts.join('|')).toContain('折扣必须大于 0');
  });

  it('★ 新建：等级必须选（不预选，避免配到错的等级上）', async () => {
    await renderPage();

    await click(button('新增折扣'));
    await click(button('保存'));

    expect(api.createMemberDiscount).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('请选择会员等级');
  });

  it('★ 新建：折换算成万分比写回接口（8.5 折 → 8500）', async () => {
    api.createMemberDiscount.mockResolvedValue({ ...ROWS[0], id: 9, discountBp: 8500 });
    await renderPage();

    await click(button('新增折扣'));
    await choose('会员等级', '专业（pro）');
    await type(inputByLabel('折扣'), '8.5');
    await click(button('保存'));

    expect(api.createMemberDiscount).toHaveBeenCalledWith({
      tier: 'pro',
      modelPattern: '*',
      taskPattern: '*',
      discountBp: 8500,
      priority: 0,
      status: 'enabled',
    });
  });

  it('折不合法时当场拦下，不发请求', async () => {
    await renderPage();

    await click(button('新增折扣'));
    await choose('会员等级', '专业（pro）');
    await type(inputByLabel('折扣'), '0');
    await click(button('保存'));

    expect(api.createMemberDiscount).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('0~10');
  });

  it('编辑：回填当前值，保存走 PUT 且带 id', async () => {
    api.updateMemberDiscount.mockResolvedValue({ ...ROWS[0], discountBp: 8000 });
    await renderPage();

    await click(buttonByAria('编辑 pro 的折扣'));
    expect(inputByLabel('折扣').value).toBe('9');
    await type(inputByLabel('折扣'), '8');
    await click(button('保存'));

    expect(api.updateMemberDiscount).toHaveBeenCalledWith(1, {
      tier: 'pro',
      modelPattern: '*',
      taskPattern: '*',
      discountBp: 8000,
      priority: 0,
      status: 'enabled',
    });
  });

  it('★ 删除要二次确认，且确认文案说清对已提交任务无影响', async () => {
    api.deleteMemberDiscount.mockResolvedValue({ deleted: true });
    await renderPage();

    await click(buttonByAria('删除 max 的折扣'));

    expect(document.body.textContent).toContain('删除会员折扣');
    expect(document.body.textContent).toContain('已提交的任务不受影响');
    expect(api.deleteMemberDiscount).not.toHaveBeenCalled();

    await click(button('确认删除'));
    expect(api.deleteMemberDiscount).toHaveBeenCalledWith(2);
  });

  it('删除失败也照原话呈现（而不是「操作失败」）', async () => {
    api.deleteMemberDiscount.mockRejectedValue(
      new ApiError(404, '目标不存在：会员折扣不存在：id=2'),
    );
    await renderPage();

    await click(buttonByAria('删除 max 的折扣'));
    await click(button('确认删除'));

    expect(document.body.textContent).toContain('目标不存在');
  });
});
