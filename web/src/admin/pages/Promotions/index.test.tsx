// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import Promotions from './index';

const api = vi.hoisted(() => ({
  fetchPromotions: vi.fn(),
  createPromotion: vi.fn(),
  updatePromotion: vi.fn(),
  deletePromotion: vi.fn(),
  fetchBillingCatalog: vi.fn(),
}));

vi.mock('@/api/adminBillingPromotions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminBillingPromotions')>();
  return {
    ...actual,
    fetchPromotions: api.fetchPromotions,
    createPromotion: api.createPromotion,
    updatePromotion: api.updatePromotion,
    deletePromotion: api.deletePromotion,
    promotionsOptions: () => ({
      queryKey: actual.promotionKeys.list(),
      queryFn: api.fetchPromotions,
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

const NIGHT = {
  id: 3,
  code: 'night-70',
  name: '夜间 7 折',
  discountBp: 7000,
  modelIds: ['seedance-*'],
  taskTypes: ['text2video'],
  tierScope: ['pro', 'max'],
  startAt: '2026-10-01T00:00:00',
  endAt: '2026-11-01T00:00:00',
  dailyTimeStart: '22:00:00',
  dailyTimeEnd: '06:00:00',
  daysOfWeek: [1, 5],
  status: 'enabled',
  priority: 5,
  createdBy: '42',
  gmtCreate: '2026-09-20T10:00:00',
  gmtModified: '2026-09-20T10:00:00',
};

const CATALOG = {
  catalogVersion: 3,
  documentHash: 'abc',
  creditsPerYuan: 15,
  document: JSON.stringify({
    schemaVersion: 1,
    currency: 'CNY',
    creditsPerYuan: 15,
    discountPolicy: { stackMode: 'multiply', floorFactorBp: 3000 },
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
    root.render(withQuery(createElement(Promotions)));
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

async function check(label: string) {
  const box = [...document.body.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((el) =>
    el.closest('label')?.textContent?.includes(label),
  );
  if (!box) throw new Error(`没有找到复选框：${label}`);
  await click(box);
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchPromotions.mockResolvedValue([NIGHT]);
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

describe('限时活动页', () => {
  it('列表把人话拼出来：折扣、模型/任务范围、等级、时间窗、时段', async () => {
    await renderPage();
    const text = document.body.textContent ?? '';

    expect(text).toContain('夜间 7 折');
    expect(text).toContain('night-70');
    expect(text).toContain('7 折');
    expect(text).toContain('seedance-*');
    expect(text).toContain('任务：text2video');
    expect(text).toContain('专业、旗舰');
    expect(text).toContain('2026-10-01 00:00');
    expect(text).toContain('周一、周五 22:00–06:00');
  });

  it('★ 冻结语义写在最上面：改活动不影响已提交未结算的任务', async () => {
    await renderPage();

    const help = document.body.querySelector('button[aria-label="说明"]');
    expect(help, '页面顶部应有一个「?」').not.toBeNull();
    expect(document.body.textContent).not.toContain('改活动不影响已提交未结算的任务');
  });

  it('★ 叠加方式（multiply）只读展示 —— 活动配多少要看它', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('multiply');
    expect(document.body.textContent).not.toContain('目录级配置');
    expect(document.body.querySelectorAll('button[aria-label="说明"]').length).toBeGreaterThan(0);
  });

  it('没有活动时给空态（而不是让人以为页面坏了）', async () => {
    api.fetchPromotions.mockResolvedValue([]);
    await renderPage();

    expect(document.body.textContent).toContain('还没有任何限时活动');
  });

  it('★ 模型范围不能留空 —— 空在计价侧等于「全部模型都打折」', async () => {
    await renderPage();

    await click(button('新建活动'));
    await type(inputByLabel('活动标识'), 'night-70');
    await type(inputByLabel('活动名称'), '夜间 7 折');
    await type(inputByLabel('起始时间'), '2026-10-01T00:00');
    await type(inputByLabel('结束时间'), '2026-11-01T00:00');
    await click(buttonByAria('删除 *'));
    await click(button('保存'));

    expect(api.createPromotion).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('模型范围至少填一个');
  });

  it('★ 每日时段只填一半被拦下（那在计价侧等于全天）', async () => {
    await renderPage();

    await click(button('新建活动'));
    await type(inputByLabel('活动标识'), 'night-70');
    await type(inputByLabel('活动名称'), '夜间 7 折');
    await type(inputByLabel('起始时间'), '2026-10-01T00:00');
    await type(inputByLabel('结束时间'), '2026-11-01T00:00');
    await type(inputByLabel('每日时段起'), '22:00');
    await click(button('保存'));

    expect(api.createPromotion).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('要么都填');
  });

  it('★ 新建：时间窗倒挂被拦下', async () => {
    await renderPage();

    await click(button('新建活动'));
    await type(inputByLabel('活动标识'), 'night-70');
    await type(inputByLabel('活动名称'), '夜间 7 折');
    await type(inputByLabel('起始时间'), '2026-11-01T00:00');
    await type(inputByLabel('结束时间'), '2026-10-01T00:00');
    await click(button('保存'));

    expect(api.createPromotion).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('结束时间必须晚于起始时间');
  });

  it('★ 新建：折换算成万分比；留空的条件归一成 null（不限只有一种表示）', async () => {
    api.createPromotion.mockResolvedValue(NIGHT);
    await renderPage();

    await click(button('新建活动'));
    await type(inputByLabel('活动标识'), 'night-70');
    await type(inputByLabel('活动名称'), '夜间 7 折');
    await type(inputByLabel('折扣'), '6.5');
    await type(inputByLabel('起始时间'), '2026-10-01T00:00');
    await type(inputByLabel('结束时间'), '2026-11-01T00:00');
    await check('周一');
    await click(button('保存'));

    expect(api.createPromotion).toHaveBeenCalledWith({
      code: 'night-70',
      name: '夜间 7 折',
      discountBp: 6500,
      modelIds: ['*'],
      taskTypes: null,
      tierScope: null,
      startAt: '2026-10-01T00:00',
      endAt: '2026-11-01T00:00',
      dailyTimeStart: null,
      dailyTimeEnd: null,
      daysOfWeek: [1],
      status: 'draft',
      priority: 0,
    });
  });

  it('保存失败用 Alert danger 呈现后端给的原话', async () => {
    api.createPromotion.mockRejectedValue(new ApiError(400, '活动标识已存在：night-70'));
    await renderPage();

    await click(button('新建活动'));
    await type(inputByLabel('活动标识'), 'night-70');
    await type(inputByLabel('活动名称'), '夜间 7 折');
    await type(inputByLabel('起始时间'), '2026-10-01T00:00');
    await type(inputByLabel('结束时间'), '2026-11-01T00:00');
    await click(button('保存'));

    const alerts = [...document.body.querySelectorAll('[role="status"]')].map((a) => a.textContent);
    expect(alerts.join('|')).toContain('活动标识已存在');
  });

  it('★ 列表上直接停用：整条回传且只改 status（不改其它字段）', async () => {
    api.updatePromotion.mockResolvedValue({ ...NIGHT, status: 'disabled' });
    await renderPage();

    await click(buttonByAria('停用 night-70'));

    expect(api.updatePromotion).toHaveBeenCalledWith(3, {
      code: 'night-70',
      name: '夜间 7 折',
      discountBp: 7000,
      modelIds: ['seedance-*'],
      taskTypes: ['text2video'],
      tierScope: ['pro', 'max'],
      startAt: '2026-10-01T00:00',
      endAt: '2026-11-01T00:00',
      dailyTimeStart: '22:00',
      dailyTimeEnd: '06:00',
      daysOfWeek: [1, 5],
      status: 'disabled',
      priority: 5,
    });
  });

  it('★ 删除要二次确认，且文案说清对已提交任务无影响', async () => {
    api.deletePromotion.mockResolvedValue({ deleted: true });
    await renderPage();

    await click(buttonByAria('删除 night-70'));

    expect(document.body.textContent).toContain('删除活动');
    expect(document.body.textContent).toContain('已提交的任务不受影响');
    expect(api.deletePromotion).not.toHaveBeenCalled();

    await click(button('确认删除'));
    expect(api.deletePromotion).toHaveBeenCalledWith(3);
  });

  it('编辑：回填折与时段（`22:00:00` → `22:00`）', async () => {
    await renderPage();

    await click(buttonByAria('编辑 night-70'));

    expect(inputByLabel('折扣').value).toBe('7');
    expect(inputByLabel('每日时段起').value).toBe('22:00');
    expect(inputByLabel('起始时间').value).toBe('2026-10-01T00:00');
  });
});
