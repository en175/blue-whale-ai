// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConsumptionRecords from './index';

const api = vi.hoisted(() => ({ fetchAdminConsumptionRecords: vi.fn() }));

vi.mock('@/api/adminConsumptionRecords', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/api/adminConsumptionRecords')>();
  return {
    ...actual,
    fetchAdminConsumptionRecords: api.fetchAdminConsumptionRecords,
    adminConsumptionRecordsOptions: (query: import('@/api/adminConsumptionRecords').AdminConsumptionRecordQuery) => ({
      queryKey: actual.adminConsumptionRecordKeys.list(query),
      queryFn: () => api.fetchAdminConsumptionRecords(query),
    }),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;

const ITEM = {
  id: 'res:7',
  user_id: 9001,
  type: 'consume',
  direction: 'out',
  title: '视频生成 · seedance-2.5',
  credits: 30,
  // 冻 100、实扣 30 —— 余额先降后回的那种行，预扣额必须出得来
  reserved_credits: 100,
  status: 'done',
  created_at: '2026-09-25T10:00:00+08:00',
  settled_at: '2026-09-25T10:01:00+08:00',
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
  throw new Error(`列表仍在加载: ${document.body.textContent}`);
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(ConsumptionRecords)));
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

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

/** 第 n 次请求带的游标（第 1 次是首次加载）。 */
function tokenOfCall(n: number): string {
  return api.fetchAdminConsumptionRecords.mock.calls[n - 1]?.[0]?.pageToken ?? '<缺>';
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchAdminConsumptionRecords.mockResolvedValue({ items: [ITEM], next_page_token: '' });
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('ConsumptionRecords 积分记录（游标分页）', () => {
  it('页面标题是「积分记录」', async () => {
    await renderPage();

    // 钉住改名本身：这一页记的是全站积分流水（含充值/赠送/过期），不只消费。
    expect(document.body.textContent).toContain('积分记录');
  });

  it('首次加载不带游标，且因为是全站视图所以 userId 一个也不传', async () => {
    await renderPage();

    expect(api.fetchAdminConsumptionRecords).toHaveBeenCalledTimes(1);
    expect(tokenOfCall(1)).toBe('');
    // userId 不在参数里 —— 传 undefined 与「不过滤」在契约上是两回事
    expect(api.fetchAdminConsumptionRecords.mock.calls[0]?.[0]).not.toHaveProperty('userId');
  });

  it('渲染归属用户、说明与带方向的金额', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('9001');
    expect(document.body.textContent).toContain('视频生成 · seedance-2.5');
    expect(document.body.textContent).toContain('-30');
  });

  it('预扣与实扣不一致时，金额下方补一行预扣', async () => {
    // 「冻 100、实扣 30」：只显示 -30 的话，用户余额那 70 的来回在界面上没有交代
    await renderPage();

    expect(document.body.textContent).toContain('预扣 100');
  });

  it('两个数一致时**不**显示预扣 —— 写出来只是复读', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [{ ...ITEM, credits: 5, reserved_credits: 5 }],
      next_page_token: '',
    });

    await renderPage();

    expect(document.body.textContent).toContain('-5');
    expect(document.body.textContent).not.toContain('预扣');
  });

  it('没有预扣的行（发放 / 人工调账）不显示预扣', async () => {
    // null 不是 0：0 是「冻了 0 分」，null 是「这一行没有预扣这回事」
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [{ ...ITEM, id: 'lot:12', type: 'recharge', direction: 'in', credits: 500, reserved_credits: null }],
      next_page_token: '',
    });

    await renderPage();

    expect(document.body.textContent).toContain('+500');
    expect(document.body.textContent).not.toContain('预扣');
  });

  it('后端比前端旧、**整个键都不回**时不崩 —— 「没有」的第二种形态', async () => {
    // ⚠️ 2026-09-26 实测：前端先上、后端后上（3100 上跑的是 4 小时前的构建，
    //    压根没投影这一列）时，回包里**根本没有 reserved_credits 这个键**，
    //    拿到的是 `undefined` 而不是 `null`。
    //    当时页面写 `!== null`，而 `undefined !== null` 为真 ⇒ 把「没有」当成「有」
    //    送进渲染 ⇒ `fmt(undefined)` 撞 `toLocaleString of undefined` ⇒ **整页白屏**。
    //    所以这条测试故意**不写那个键**（而不是写成 null）—— 上面那条只覆盖了 null。
    const oldBackendRow = {
      id: 'res:9',
      user_id: 9001,
      type: 'consume',
      direction: 'out',
      title: '视频生成 · seedance-2.5',
      credits: 30,
      status: 'done',
      created_at: '2026-09-25T10:00:00+08:00',
      settled_at: '2026-09-25T10:01:00+08:00',
    };
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [oldBackendRow],
      next_page_token: '',
    });

    await renderPage();

    // 行本身照常渲染，只是没有预扣那一行小字 —— 旧后端下这是唯一正确的呈现
    expect(document.body.textContent).toContain('-30');
    expect(document.body.textContent).not.toContain('预扣');
    expect(document.body.textContent).not.toContain('Unexpected Application Error');
  });

  it('预扣为 0（结算时全额退回）仍要显示 —— 那正是最该解释的一行', async () => {
    // 判空若写成 `if (row.reserved_credits)`，0 会被当成「没有预扣」而整行消失，
    // 恰好漏掉「冻了 12、最后全退回来」这种最需要交代的行
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [{ ...ITEM, credits: 0, reserved_credits: 12 }],
      next_page_token: '',
    });

    await renderPage();

    expect(document.body.textContent).toContain('-0');
    expect(document.body.textContent).toContain('预扣 12');
  });

  it('预扣与金额在**同一个单元格**里 —— 并排，不另起一行、也不单开一列', async () => {
    // ⚠️ 这条守的是**形态**不是文案：上面几条只断言「页面上有这几个字」，
    //    把预扣挪到金额下方另起一行、或者单开一列，它们照样全绿。
    //    而这是用户明确提过的观感要求（「预扣不要换行」）——所以钉在 DOM 结构上：
    //    两段文本必须落在同一个 <td> 内。
    api.fetchAdminConsumptionRecords.mockResolvedValue({ items: [ITEM], next_page_token: '' });

    await renderPage();

    // ITEM：credits 30 / reserved 100 —— 恰好是两个数不一致、该显示预扣的那种行
    const holdCells = [...document.querySelectorAll('tbody tr td')].filter((td) =>
      td.textContent?.includes('预扣'),
    );
    expect(holdCells).toHaveLength(1);
    expect(holdCells[0]?.textContent).toContain('-30');
    expect(holdCells[0]?.textContent).toContain('预扣 100');
  });

  it('点「下一页」把上一页给的游标原样带上；「上一页」回到**当初那一页的**游标', async () => {
    api.fetchAdminConsumptionRecords
      .mockResolvedValueOnce({ items: [ITEM], next_page_token: 'tok-1' })
      .mockResolvedValueOnce({ items: [ITEM], next_page_token: 'tok-2' });

    await renderPage();

    await click('下一页');
    expect(tokenOfCall(2)).toBe('tok-1');

    await click('上一页');
    // 回到首页的游标是空串，不是把 tok-1 删掉就算完 —— 游标是单向的，
    // 「上一页」只能靠自己存过的那个值
    expect(tokenOfCall(3)).toBe('');
  });

  it('首页禁用「上一页」；没有下一页时禁用「下一页」', async () => {
    await renderPage();

    expect(button('上一页').disabled).toBe(true);
    // next_page_token 为空 = 到底了。这里**不从总数推** —— 账本给不出总数
    expect(button('下一页').disabled).toBe(true);
  });

  it('不在界面上编一个总数出来', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('第 1 页');
    expect(document.body.textContent).not.toContain('共');
  });

  it('翻到第 2 页后修改筛选条件，游标回到首页而不是停在第 2 页', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({ items: [ITEM], next_page_token: 'tok-1' });

    await renderPage();
    await click('下一页');
    expect(tokenOfCall(2)).toBe('tok-1');

    const userInput = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="用户 ID（留空 = 全站）"]',
    );
    if (!userInput) throw new Error('用户 ID 输入框未渲染');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(userInput, '9001');
      userInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('查询');

    // 换了条件还停在原游标上，翻出来的页与看到的条件对不上
    expect(tokenOfCall(3)).toBe('');
    expect(api.fetchAdminConsumptionRecords.mock.calls[2]?.[0]?.userId).toBe('9001');
  });
});

describe('ConsumptionRecords — 哨兵口径', () => {
  it('★ 首次查询**不带** type —— 哨兵漏下去会把列表静默过滤成空', async () => {
    // 「全部」由**空值**表达。`'all'` 是真值，一旦写回 EMPTY_FILTERS 而判据没跟着改，
    // 请求里就会多出 `type=all` —— 列表**不报错**，只会静默为空。所以从请求参数上钉。
    await renderPage();

    expect(api.fetchAdminConsumptionRecords).toHaveBeenCalled();
    const first = api.fetchAdminConsumptionRecords.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(first).not.toHaveProperty('type');
  });
});
