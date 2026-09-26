// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RechargePlans from './index';
import { tierFormError } from './tierForm';
import { ApiError } from '@/api/http';

const adminApi = vi.hoisted(() => ({
  fetchTopupTiers: vi.fn(),
  createTopupTier: vi.fn(),
  updateTopupTier: vi.fn(),
  deleteTopupTier: vi.fn(),
  sortTopupTiers: vi.fn(),
  fetchTopupTierPreview: vi.fn(),
  syncTopupTiersToGo: vi.fn(),
}));

const toastApi = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@/api/admin', () => adminApi);
vi.mock('sonner', () => ({
  toast: toastApi,
  Toaster: () => null,
}));

let root: Root;
let mountNode: HTMLDivElement;

function nativeInput(input: HTMLInputElement, next: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderPage() {  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(RechargePlans));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function openCreateModal() {
  await act(async () => {
    [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('新建档位'))
      ?.click();
  });
}

async function fillAndSave(price: string, ratio: string) {
  const priceInput = document.body.querySelector<HTMLInputElement>('input[aria-label="原价（元）"]');
  const ratioInput = document.body.querySelector<HTMLInputElement>('input[aria-label="折扣比例"]');
  if (!priceInput || !ratioInput) throw new Error('档位表单输入未渲染');
  await act(async () => {
    nativeInput(priceInput, price);
    nativeInput(ratioInput, ratio);
  });
  await act(async () => {
    [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '保存')
      ?.click();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  adminApi.fetchTopupTiers.mockResolvedValue([]);
  adminApi.createTopupTier.mockResolvedValue({
    data: {
      id: 1,
      name: '',
      amount: 5_000_000,
      originalPrice: 10,
      discount: 1,
      price: 10,
      isRecommended: false,
      status: 'active',
      startTime: null,
      endTime: null,
      sortOrder: 1,
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    },
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('tierFormError', () => {
  it('原价 0/负数/非整数非法', () => {
    expect(tierFormError(0, 1)).toBe('原价须为正整数');
    expect(tierFormError(-1, 1)).toBe('原价须为正整数');
    expect(tierFormError(9.5, 1)).toBe('原价须为正整数');
  });

  it('折扣 0 或大于 1 非法', () => {
    expect(tierFormError(10, 0)).toBe('折扣比例须在 (0, 1] 之间');
    expect(tierFormError(10, 1.5)).toBe('折扣比例须在 (0, 1] 之间');
  });

  it('正整数原价且折扣 ∈ (0, 1] 合法', () => {
    expect(tierFormError(10, 1)).toBeNull();
    expect(tierFormError(10, 0.8)).toBeNull();
  });
});

describe('RechargePlans 档位边界值 toast', () => {
  it('原价 0 保存时 toast 且不发创建请求', async () => {
    await renderPage();
    await openCreateModal();
    await fillAndSave('0', '1');
    expect(toastApi.error).toHaveBeenCalledWith('原价须为正整数');
    expect(adminApi.createTopupTier).not.toHaveBeenCalled();
    // 校验错误只走 toast，不落到表单里（本页已无私有样式类，改为断言文案未渲染）
    expect(document.body.textContent).not.toContain('原价须为正整数');
  });

  it('原价负数保存时 toast 且不发创建请求', async () => {
    await renderPage();
    await openCreateModal();
    await fillAndSave('-1', '1');
    expect(toastApi.error).toHaveBeenCalledWith('原价须为正整数');
    expect(adminApi.createTopupTier).not.toHaveBeenCalled();
  });

  it('折扣 0 或大于 1 保存时 toast 且不发创建请求', async () => {
    await renderPage();
    await openCreateModal();
    await fillAndSave('10', '0');
    expect(toastApi.error).toHaveBeenCalledWith('折扣比例须在 (0, 1] 之间');
    expect(adminApi.createTopupTier).not.toHaveBeenCalled();

    toastApi.error.mockClear();
    await fillAndSave('10', '1.5');
    expect(toastApi.error).toHaveBeenCalledWith('折扣比例须在 (0, 1] 之间');
    expect(adminApi.createTopupTier).not.toHaveBeenCalled();
  });

  it('原价非整数仍 toast', async () => {
    await renderPage();
    await openCreateModal();
    await fillAndSave('9.5', '1');
    expect(toastApi.error).toHaveBeenCalledWith('原价须为正整数');
    expect(adminApi.createTopupTier).not.toHaveBeenCalled();
  });

  it('接口失败不写页面 formError（toast 由 http 层负责）', async () => {
    adminApi.createTopupTier.mockRejectedValue(
      new ApiError(409, '每个原价只能有一个档位：已存在原价 ¥10 的档位', 409),
    );
    await renderPage();
    await openCreateModal();
    await fillAndSave('10', '1');
    await act(async () => {
      await Promise.resolve();
    });
    expect(toastApi.error).not.toHaveBeenCalled();
    // 上游错误文案不渲染到表单里（本页已无私有样式类，改为断言文案未渲染）
    expect(document.body.textContent).not.toContain('每个原价只能有一个档位');
  });
});
