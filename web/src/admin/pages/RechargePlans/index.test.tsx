// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RechargePlans from './index';
import { baseCreditsFormError, tierCardFormError, tierFormError } from './tierForm';
import { ApiError } from '@/shared/api/http';
import { topupTierPreviewKeys, type TopupTier } from '@/admin/api/adminTopupTiers';

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

vi.mock('@/admin/api/adminTopupTiers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/admin/api/adminTopupTiers')>();
  return {
    ...actual,
    ...adminApi,
    topupTiersOptions: () => ({
      queryKey: actual.topupTierKeys.list(),
      queryFn: () => adminApi.fetchTopupTiers(),
    }),
  };
});
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

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client }, createElement(RechargePlans)),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return client;
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

async function fillInput(ariaLabel: string, value: string) {
  const el = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `input[aria-label="${ariaLabel}"], textarea[aria-label="${ariaLabel}"]`
  );
  if (!el) throw new Error(`输入未渲染：${ariaLabel}`);
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  await act(async () => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function selectOption(ariaLabel: string, optionText: string) {
  await act(async () => {
    const trigger = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
    if (!trigger) return;
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    trigger.dispatchEvent(event);
  });
  await act(async () => {
    [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.includes(optionText))
      ?.click();
  });
}

function createPayload() {
  return adminApi.createTopupTier.mock.calls[0][0] as Record<string, unknown>;
}

function tier(id: string, sortOrder: number, name = ''): TopupTier {
  return {
    id,
    name,
    baseCredits: 1000,
    originalPrice: 10,
    discount: 1,
    price: 10,
    isRecommended: false,
    status: 'active',
    startTime: null,
    endTime: null,
    sortOrder,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    description: '',
    bonusCredits: 0,
    activityTag: '',
    buttonText: '立享加赠',
    firstPurchaseEligible: false,
    creditsValidMonths: 24,
    permission: 'all',
    permissionAllowlist: [],
    permissionDeniedHint: '',
  };
}

function dataRows(): HTMLTableRowElement[] {
  return [...document.body.querySelectorAll<HTMLTableRowElement>('tbody tr')].filter(
    (tr) => tr.querySelectorAll('td').length > 1
  );
}

function rowIds(): string[] {
  return dataRows().map((tr) => tr.querySelector('td')?.textContent?.trim() ?? '');
}

async function clickRowButton(rowIndex: number, label: string) {
  const button = dataRows()[rowIndex]?.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  );
  if (!button) throw new Error(`第 ${rowIndex} 行没有「${label}」按钮`);
  await act(async () => {
    button.click();
  });
}

async function clickButtonByText(text: string) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === text
  );
  if (!button) throw new Error(`没有文案为「${text}」的按钮`);
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  adminApi.fetchTopupTiers.mockResolvedValue({ tiers: [] });
  adminApi.createTopupTier.mockResolvedValue({
    data: {
      id: 1,
      name: '',
      baseCredits: 7500,
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

describe('baseCreditsFormError — 基础积分是配置值，只校验形态', () => {
  it('1 以上的整数合法（含数字串，表单从 DOM 出来本来就是字符串）', () => {
    expect(baseCreditsFormError('1')).toBeNull();
    expect(baseCreditsFormError('7500')).toBeNull();
    expect(baseCreditsFormError(' 499 ')).toBeNull();
  });

  it('空 / 0 / 负数 / 小数 / 非数字非法', () => {
    for (const bad of ['', '   ', '0', '-1', '1.5', 'abc']) {
      expect(baseCreditsFormError(bad)).toBe('基础积分须为 1 以上的整数');
    }
  });

  it('★ 不与原价做任何一致性校验：积分不是原价的整数倍也要放行', () => {
    expect(baseCreditsFormError('7500')).toBeNull();
    expect(baseCreditsFormError('90000')).toBeNull();
  });
});

describe('RechargePlans 档位边界值 toast', () => {
  it('原价 0 保存时 toast 且不发创建请求', async () => {
    await renderPage();
    await openCreateModal();
    await fillAndSave('0', '1');
    expect(toastApi.error).toHaveBeenCalledWith('原价须为正整数');
    expect(adminApi.createTopupTier).not.toHaveBeenCalled();
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
    expect(document.body.textContent).not.toContain('每个原价只能有一个档位');
  });
});

describe('RechargePlans 基础积分是配置值（不是派生量）', () => {
  it('★ 基础积分是**输入框**（配置值），填多少就提交多少 —— 不做「原价 × 换算率」联动', async () => {
    await renderPage();
    await openCreateModal();

    const creditsInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="基础积分"]',
    );
    expect(creditsInput).not.toBeNull();
    expect(creditsInput?.readOnly).toBe(false);

    await fillInput('基础积分', '7500');
    await fillAndSave('100', '1');

    expect(createPayload().baseCredits).toBe(7500);
    expect(createPayload().originalPrice).toBe(100);
  });

  it('基础积分留空 / 0 / 小数 → toast 且不发请求（0 积分档位用户付了钱拿不到东西）', async () => {
    for (const bad of ['', '0', '1.5']) {
      await renderPage();
      await openCreateModal();
      await fillInput('基础积分', bad);
      await fillAndSave('100', '1');

      expect(toastApi.error).toHaveBeenCalledWith('基础积分须为 1 以上的整数');
      expect(adminApi.createTopupTier).not.toHaveBeenCalled();

      toastApi.error.mockClear();
      await act(async () => root.unmount());
      mountNode?.remove();
    }
  });
});

describe('tierCardFormError', () => {
  const base = {
    description: '',
    bonusCredits: 0,
    activityTag: '',
    buttonText: '立享加赠',
    firstPurchaseEligible: false,
    creditsValidMonths: 24,
    permissionAllowlist: [] as string[],
    permissionDeniedHint: '',
  };

  it('按钮文案必填（PRD §10.2）：空串与纯空格都不行', () => {
    expect(tierCardFormError({ ...base, buttonText: '' })).toBe('按钮文案不能为空');
    expect(tierCardFormError({ ...base, buttonText: '   ' })).toBe('按钮文案不能为空');
  });

  it('赠送积分须为 0 或正整数', () => {
    expect(tierCardFormError({ ...base, bonusCredits: -1 })).toBe('赠送积分须为非负整数');
    expect(tierCardFormError({ ...base, bonusCredits: 1.5 })).toBe('赠送积分须为非负整数');
    expect(tierCardFormError({ ...base, bonusCredits: NaN })).toBe('赠送积分须为非负整数');
    expect(tierCardFormError({ ...base, bonusCredits: 0 })).toBeNull();
  });

  it('积分有效期是 1–1200 的整数月（0 会让积分永不到期）', () => {
    expect(tierCardFormError({ ...base, creditsValidMonths: 0 })).toBe(
      '积分有效期须为 1–1200 的整数（单位：月）'
    );
    expect(tierCardFormError({ ...base, creditsValidMonths: 1201 })).toBe(
      '积分有效期须为 1–1200 的整数（单位：月）'
    );
    expect(tierCardFormError({ ...base, creditsValidMonths: 24 })).toBeNull();
  });

  it('文本超列宽时先拦下来，别等写库时炸成 500', () => {
    expect(tierCardFormError({ ...base, description: 'x'.repeat(256) })).toBe(
      '卡片说明最长 255 个字符'
    );
    expect(tierCardFormError({ ...base, activityTag: 'x'.repeat(65) })).toBe(
      '活动标签最长 64 个字符'
    );
  });

  it('白名单元素必须是十进制 userId（一个错字就是一条永远匹配不上的规则）', () => {
    expect(tierCardFormError({ ...base, permissionAllowlist: ['9001'] })).toBeNull();
    expect(tierCardFormError({ ...base, permissionAllowlist: ['9001x'] })).toBe(
      '白名单里的「9001x」不是合法的 userId'
    );
  });
});

describe('RechargePlans 卡片字段（PRD §10.2 / §10.4 / §10.5）', () => {
  it('★ 新建默认草稿：状态预选「草稿」，提交时送 status=draft', async () => {
    await renderPage();
    await openCreateModal();

    const trigger = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="上架状态"]'
    );
    expect(trigger?.textContent).toContain('草稿');

    await fillAndSave('100', '1');
    expect(createPayload().status).toBe('draft');
  });

  it('权限默认「全部登录用户」时不渲染白名单输入（选了才出现）', async () => {
    await renderPage();
    await openCreateModal();

    expect(document.body.querySelector('input[aria-label="添加白名单用户"]')).toBeNull();
  });

  it('★ 权限选「指定用户群」→ 白名单出现，提交带 userId 数组', async () => {
    await renderPage();
    await openCreateModal();
    await selectOption('购买权限', '指定用户群');

    await fillInput('添加白名单用户', '9001');
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === '添加')
        ?.click();
    });

    await fillAndSave('100', '1');
    expect(createPayload().permission).toBe('user_group');
    expect(createPayload().permissionAllowlist).toEqual(['9001']);
  });

  it('★ 卡片字段随创建请求一起送（PRD §10.2 的九项）', async () => {
    await renderPage();
    await openCreateModal();
    await fillInput('卡片说明', '适合轻量体验');
    await fillInput('活动标签', '首购加赠 50%');
    await fillInput('赠送积分', '3750');
    await fillInput('积分有效期（月）', '24');
    await fillInput('无权限提示', '该档位暂不对外开放');

    await fillAndSave('100', '1');

    expect(adminApi.createTopupTier).toHaveBeenCalledWith(
      expect.objectContaining({
        originalPrice: 100,
        discount: 1,
        description: '适合轻量体验',
        activityTag: '首购加赠 50%',
        bonusCredits: 3750,
        creditsValidMonths: 24,
        permissionDeniedHint: '该档位暂不对外开放',
        buttonText: '立享加赠',
        firstPurchaseEligible: false,
      })
    );
  });

  it('★ 实付价格仍由服务端算（不发）；基础积分是配置值（要发）', async () => {
    await renderPage();
    await openCreateModal();
    await fillAndSave('100', '1');

    expect(createPayload()).not.toHaveProperty('price');
    expect(createPayload()).not.toHaveProperty('amount');
    expect(createPayload().baseCredits).toBe(1000);
  });

  it('按钮文案清空 → toast 且不发请求', async () => {
    await renderPage();
    await openCreateModal();
    await fillInput('按钮文案', '   ');
    await fillAndSave('100', '1');

    expect(toastApi.error).toHaveBeenCalledWith('按钮文案不能为空');
    expect(adminApi.createTopupTier).not.toHaveBeenCalled();
  });

  it('积分有效期填 0 → toast 且不发请求', async () => {
    await renderPage();
    await openCreateModal();
    await fillInput('积分有效期（月）', '0');
    await fillAndSave('100', '1');

    expect(toastApi.error).toHaveBeenCalledWith('积分有效期须为 1–1200 的整数（单位：月）');
    expect(adminApi.createTopupTier).not.toHaveBeenCalled();
  });

  it('赠送积分留空按 0 处理（不赠送是合法值，不是非法输入）', async () => {
    await renderPage();
    await openCreateModal();
    await fillInput('赠送积分', '');
    await fillAndSave('100', '1');

    expect(createPayload().bonusCredits).toBe(0);
  });
});

describe('RechargePlans 写操作 → 原始缓存（IKJ69L）', () => {
  it('★ 下移：请求还没回来界面就已重排（乐观），提交全量重编号，成功后失效用户端预览', async () => {
    adminApi.fetchTopupTiers.mockResolvedValue({
      tiers: [tier('1', 1, 'A'), tier('2', 2, 'B'), tier('3', 3, 'C')],
    });
    let settle!: (value: unknown) => void;
    adminApi.sortTopupTiers.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      })
    );

    const client = await renderPage();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    expect(rowIds()).toEqual(['1', '2', '3']);

    await clickRowButton(0, '下移');

    expect(rowIds()).toEqual(['2', '1', '3']);
    expect(adminApi.sortTopupTiers).toHaveBeenCalledWith([
      { id: '2', sortOrder: 1 },
      { id: '1', sortOrder: 2 },
      { id: '3', sortOrder: 3 },
    ]);
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => {
      settle({ data: [] });
      await Promise.resolve();
    });
    expect(rowIds()).toEqual(['2', '1', '3']);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: topupTierPreviewKeys.all });
  });

  it('★ 排序失败：顺序回滚到交换前，错误原文显示出来，且不动预览缓存', async () => {
    adminApi.fetchTopupTiers.mockResolvedValue({ tiers: [tier('1', 1), tier('2', 2)] });
    let fail!: (reason: unknown) => void;
    adminApi.sortTopupTiers.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      })
    );

    const client = await renderPage();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await clickRowButton(0, '下移');
    expect(rowIds()).toEqual(['2', '1']);

    await act(async () => {
      fail(new ApiError(500, '排序炸了', 500));
      await Promise.resolve();
    });

    expect(rowIds()).toEqual(['1', '2']);
    expect(document.body.textContent).toContain('排序炸了');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('★ 新建成功：服务端返回的原始记录进缓存，表格照它渲染出新的一行', async () => {
    adminApi.fetchTopupTiers.mockResolvedValue({ tiers: [tier('1', 1, '老档')] });
    adminApi.createTopupTier.mockResolvedValue({ data: tier('9', 2, '新档') });

    await renderPage();
    await openCreateModal();
    await fillInput('基础积分', '7500');
    await fillAndSave('10', '1');

    expect(rowIds()).toEqual(['1', '9']);
    expect(document.body.textContent).toContain('新档');
  });

  it('★ 编辑成功：服务端返回的原始记录**替换**缓存里那条，而不是追加', async () => {
    adminApi.fetchTopupTiers.mockResolvedValue({ tiers: [tier('1', 1, '老档')] });
    adminApi.updateTopupTier.mockResolvedValue({ data: tier('1', 1, '改过的档') });

    await renderPage();
    await clickRowButton(0, '编辑');
    await clickButtonByText('保存');

    expect(adminApi.updateTopupTier).toHaveBeenCalled();
    expect(rowIds()).toEqual(['1']);
    expect(document.body.textContent).toContain('改过的档');
  });

  it('★ 删除成功：该行从缓存移除，并失效用户端预览', async () => {
    adminApi.fetchTopupTiers.mockResolvedValue({ tiers: [tier('1', 1), tier('2', 2)] });
    adminApi.deleteTopupTier.mockResolvedValue({ data: null });

    const client = await renderPage();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await clickRowButton(0, '删除');
    await clickButtonByText('确认删除');

    expect(rowIds()).toEqual(['2']);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: topupTierPreviewKeys.all });
  });
});
