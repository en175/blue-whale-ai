// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RechargePlans from './index';
import { baseCreditsFormError, tierCardFormError, tierFormError } from './tierForm';
import { ApiError } from '@/api/http';
import { topupTierPreviewKeys, type TopupTier } from '@/api/adminTopupTiers';

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

// 页面走 Query（IKJ058），所以**工厂本身**也要桩：`vi.mock` 换的是模块导出的绑定，
// 而 `topupTiersOptions` 内部引用的仍是模块自己的 `fetchTopupTiers` —— 只桩 fetch 不生效。
vi.mock('@/api/adminTopupTiers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminTopupTiers')>();
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
  // 页面走 Query（IKJ058），必须给一棵带 client 的树
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
  // 再等一个宏任务：Query 拿到数据后还要走几跳内部调度才会把行渲染出来，
  // 只冲一个微任务的话，紧接着断言表格内容的用例会看到空表。
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

/** 填一个 aria-label 命中的输入框（卡片字段那批都用它；卡片说明是多行框）。 */
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

/** 自绘 Select：点触发器展开，再点 role=option 的那一项。 */
async function selectOption(ariaLabel: string, optionText: string) {
  await act(async () => {
    document.body
      .querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`)
      ?.click();
  });
  await act(async () => {
    [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.includes(optionText))
      ?.click();
  });
}

/** 当前创建请求的入参。 */
function createPayload() {
  return adminApi.createTopupTier.mock.calls[0][0] as Record<string, unknown>;
}

/** 一条原始档位记录 —— 缓存里存的就是这个形状，不是页面用的 `Plan`。 */
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

/** 数据行 —— 跳过加载/空态那种只有一个 td 的整行。 */
function dataRows(): HTMLTableRowElement[] {
  return [...document.body.querySelectorAll<HTMLTableRowElement>('tbody tr')].filter(
    (tr) => tr.querySelectorAll('td').length > 1
  );
}

/** 表格当前的行顺序（第一格是档位 ID）。 */
function rowIds(): string[] {
  return dataRows().map((tr) => tr.querySelector('td')?.textContent?.trim() ?? '');
}

/** 点某一行里的操作按钮（上移 / 下移 / 编辑 / 删除）。 */
async function clickRowButton(rowIndex: number, label: string) {
  const button = dataRows()[rowIndex]?.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  );
  if (!button) throw new Error(`第 ${rowIndex} 行没有「${label}」按钮`);
  await act(async () => {
    button.click();
  });
}

/** 按文案点按钮（弹窗里的「保存」「确认删除」）。 */
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
    // ¥499 → 7,500 积分（499 × 15 = 7,485）：对不上是**对的**。
    // 校验器只收一个参数，物理上就没法拿它跟原价比 —— 这条守着别哪天又给它接回一个价格参数。
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

describe('RechargePlans 基础积分是配置值（不是派生量）', () => {
  it('★ 基础积分是**输入框**（配置值），填多少就提交多少 —— 不做「原价 × 换算率」联动', async () => {
    // ⚠️ 这条钉的是 2026-09-27 的口径反转：这个框**曾经**是只读的派生预览
    //    （「积分 = 原价 × 换算率」，还因此让列表接口带回 creditsPerYuan）。
    //    现在基础积分是**配置值**：充值常有折扣，运营填的 7,500 就是用户到账的数
    //    （499 × 15 = 7,485 只是巧合，不是公式）。
    //
    //    故意填一个**不是原价整数倍**的数：任何「还在按原价算积分」的实现都会把它改成 1500。
    await renderPage();
    await openCreateModal();

    const creditsInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="基础积分"]',
    );
    expect(creditsInput).not.toBeNull();
    // 可输入：不再是 readOnly 的派生预览框
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
    // PRD §10.5「新建卡片默认草稿，不展示给用户」。表单若默认「上架」，
    // 运营一点保存就把价格、赠送、标签都还没配的卡片卖给用户了。
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
        // 按钮文案没动过 → 默认值（PRD §10.2「默认『立享加赠』」）
        buttonText: '立享加赠',
        firstPurchaseEligible: false,
      })
    );
  });

  it('★ 实付价格仍由服务端算（不发）；基础积分是配置值（要发）', async () => {
    // 2026-09-27 起 `amount`（遗留 quota 列）与基础积分不再是同一个东西：
    // 后者是运营的输入（`baseCredits`），必须随请求送出；
    // 「实付 = 原价 × 折扣」仍是派生量，送出去会被服务端忽略，真送就意味着某天有人会拿它当输入。
    await renderPage();
    await openCreateModal();
    await fillAndSave('100', '1');

    expect(createPayload()).not.toHaveProperty('price');
    expect(createPayload()).not.toHaveProperty('amount');
    // 新建表单的起点值（运营可按活动口径改写）
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

/**
 * IKJ69L：给「写操作 → 原始缓存」这层翻译补护栏。
 *
 * <p>本页展示的是 `toPlan()` 映射过的 `Plan[]` 视图，而缓存里存的是**原始 `{tiers}`**，
 * 两者**没有反向映射** —— 所以每处写操作都得拿原始记录去更新缓存（页面里的 `setTiers`）。
 * 这是 IKJ058 整个 diff 里唯一的非机械代码，此前一条用例都没有：
 * 谁哪天顺手把它改回「在视图空间里替换」，页面看起来照样能跑，只是数据会悄悄错位。
 */
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

    // 请求还挂着，顺序已经变了 —— 「上下移点下去要立刻动」就是这一条。
    // 断言的是**立即**生效：上面那次 act 没有等排序请求，它也永远不会自己 resolve。
    expect(rowIds()).toEqual(['2', '1', '3']);
    expect(adminApi.sortTopupTiers).toHaveBeenCalledWith([
      { id: '2', sortOrder: 1 },
      { id: '1', sortOrder: 2 },
      { id: '3', sortOrder: 3 },
    ]);
    // 还没成功，预览缓存不该被动
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

    // 追加而不是替换；顺序按 sortOrder 排，所以新的那条排在后面
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
