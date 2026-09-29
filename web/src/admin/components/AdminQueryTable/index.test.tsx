// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminQueryTable, { type Column, type QueryStatus } from './index';
import {
  useAppliedFilters,
  useCursorStack,
  usePagedQuery,
  type AppliedFilters,
  type CursorStack,
  type PagedQuery,
} from './useQueryFilters';

/* ============================================
 * 这套骨架此前只活在三个页面里，**只能整页测**（而整页测要先备好假 API、假路由）。
 * 收成组件与 hook 之后，三态、防抖、重置、分页接线第一次可以直接对着测。
 *
 * 每条测试的注释写的是「这条挡的是什么 bug」，不是「这条在测什么函数」——
 * 上面那些行为每一条都是这三页**已经踩过**或**已经漂过**的坑。
 * ============================================ */

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

// ========== 筛选状态机 ==========

const EMPTY = { userId: '', status: '' };

function FiltersProbe({ onState }: { onState: (f: AppliedFilters<typeof EMPTY>) => void }) {
  const filters = useAppliedFilters(EMPTY);
  onState(filters);
  return null;
}

describe('useAppliedFilters — 查询条件与输入框分离', () => {
  async function mount(): Promise<{ get(): AppliedFilters<typeof EMPTY> }> {
    let api: AppliedFilters<typeof EMPTY> | undefined;
    await render(createElement(FiltersProbe, { onState: (f) => (api = f) }));
    return { get: () => api as AppliedFilters<typeof EMPTY> };
  }

  it('★ 改草稿**不会**动生效条件 —— 否则每敲一个字符都发一次请求', async () => {
    const probe = await mount();

    await act(async () => probe.get().setDraft((d) => ({ ...d, userId: '9001' })));

    expect(probe.get().draft.userId).toBe('9001');
    expect(probe.get().applied.userId).toBe('');
  });

  it('apply 把草稿变成生效条件，并让 epoch 自增', async () => {
    const probe = await mount();

    await act(async () => probe.get().setDraft((d) => ({ ...d, userId: '9001' })));
    await act(async () => probe.get().apply());

    expect(probe.get().applied.userId).toBe('9001');
    expect(probe.get().epoch).toBe(1);
  });

  it('reset 把草稿与生效条件一起清空，epoch 同样自增', async () => {
    const probe = await mount();

    await act(async () => probe.get().setDraft((d) => ({ ...d, userId: '9001' })));
    await act(async () => probe.get().apply());
    await act(async () => probe.get().reset());

    expect(probe.get().draft).toEqual(EMPTY);
    expect(probe.get().applied).toEqual(EMPTY);
    expect(probe.get().epoch).toBe(2);
  });

  it('★ 空条件一色用空串 —— 哨兵是真值，会被当成「有这个筛选」', async () => {
    // ⚠️ 这条**不**断言「三页的常量长什么样」——那样写只是在测测试文件自己（评审实证：
    //    把哨兵改回 `all` 它照样绿）。真正的闸门在页面测试里：断言**请求参数**不带它。
    //    这里只钉 hook 这一侧的判据：空条件 ⇒ 没有生效筛选。
    const probe = await mount();

    expect(probe.get().hasApplied).toBe(false);
  });

  it('★ hasApplied 跟着**生效条件**走，不是草稿 —— 否则一敲字空列表就说「没有匹配的」', async () => {
    const probe = await mount();

    await act(async () => probe.get().setDraft((d) => ({ ...d, userId: '9001' })));
    // 还没点「查询」：查询条件没变，空态文案也就不该变
    expect(probe.get().hasApplied).toBe(false);

    await act(async () => probe.get().apply());
    expect(probe.get().hasApplied).toBe(true);

    await act(async () => probe.get().reset());
    expect(probe.get().hasApplied).toBe(false);
  });
});

function PageProbe({ epoch, onState }: { epoch: number; onState: (p: PagedQuery) => void }) {
  onState(usePagedQuery(epoch));
  return null;
}

function CursorProbe({ epoch, onState }: { epoch: number; onState: (c: CursorStack) => void }) {
  onState(useCursorStack(epoch));
  return null;
}

// ========== 分页：两种形状 ==========

describe('分页状态', () => {
  it('★ epoch 一变，页码回到第 1 页 —— 换了筛选还停在第 3 页会看到莫名其妙的空列表', async () => {
    let api: PagedQuery | undefined;
    const view = (epoch: number) =>
      createElement(PageProbe, { epoch, onState: (p) => (api = p) });

    await render(view(0));
    await act(async () => (api as PagedQuery).next());
    expect((api as PagedQuery).page).toBe(2);

    await render(view(1));
    expect((api as PagedQuery).page).toBe(1);
  });

  it('游标栈：next 推一层、prev 弹一层，栈深就是页码', async () => {
    let api: CursorStack | undefined;
    await render(createElement(CursorProbe, { epoch: 0, onState: (c) => (api = c) }));

    expect((api as CursorStack).page).toBe(1);
    expect((api as CursorStack).pageToken).toBe('');

    await act(async () => (api as CursorStack).next('tok-1'));
    expect((api as CursorStack).page).toBe(2);
    expect((api as CursorStack).pageToken).toBe('tok-1');

    await act(async () => (api as CursorStack).prev());
    expect((api as CursorStack).page).toBe(1);
    expect((api as CursorStack).pageToken).toBe('');
  });

  it('游标为空串时 next 不动 —— 「没有下一页」不能被记成一页', async () => {
    let api: CursorStack | undefined;
    await render(createElement(CursorProbe, { epoch: 0, onState: (c) => (api = c) }));

    await act(async () => (api as CursorStack).next(''));

    expect((api as CursorStack).page).toBe(1);
  });

  it('★ 游标栈也跟 epoch 回栈底 —— 换筛选后留着旧游标，翻出来的页与条件对不上', async () => {
    let api: CursorStack | undefined;
    const view = (epoch: number) =>
      createElement(CursorProbe, { epoch, onState: (c) => (api = c) });

    await render(view(0));
    await act(async () => (api as CursorStack).next('tok-1'));
    expect((api as CursorStack).page).toBe(2);

    await render(view(1));
    expect((api as CursorStack).page).toBe(1);
    expect((api as CursorStack).pageToken).toBe('');
  });
});

// ========== 组件的三态与分页接线 ==========

const COLUMNS: Column<{ id: string }>[] = [{ key: 'id', header: 'ID', render: (row) => row.id }];

function status(over: Partial<QueryStatus> = {}): QueryStatus {
  return {
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
    ...over,
  };
}

function table(over: {
  status?: QueryStatus;
  rows?: { id: string }[];
  hasFilters?: boolean;
  /** 覆盖**表体**那句错误文案（横幅那句仍是 `errorMessage`） */
  tableErrorMessage?: string;
  pagination?: Parameters<typeof AdminQueryTable<{ id: string }>>[0]["pagination"];
}) {
  return createElement(AdminQueryTable<{ id: string }>, {
    title: '测试列表',
    filters: null,
    actions: null,
    hasFilters: over.hasFilters ?? false,
    filteredEmptyMessage: '没有匹配的',
    emptyMessage: '暂无数据',
    errorMessage: '加载失败',
    tableErrorMessage: over.tableErrorMessage,
    columns: COLUMNS,
    rows: over.rows ?? [],
    rowKey: (row) => row.id,
    status: over.status ?? status(),
    pagination: over.pagination ?? {
      kind: "offset",
      page: 1,
      pageSize: 20,
      total: 0,
      prev: () => {},
      next: () => {},
    },
  });
}

const text = () => mountNode.textContent ?? '';

describe('AdminQueryTable — 三态', () => {
  it('pending 显示「加载中…」', async () => {
    await render(table({ status: status({ isPending: true }) }));
    expect(text()).toContain('加载中…');
  });

  it('error 显示错误文案与重试按钮，点它调 refetch', async () => {
    const refetch = vi.fn();
    await render(table({ status: status({ isError: true, refetch }) }));

    expect(text()).toContain('加载失败');
    const retry = [...mountNode.querySelectorAll('button')].find((b) => b.textContent === '重试');
    expect(retry).toBeDefined();

    await act(async () => (retry as HTMLButtonElement).click());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('★ 空列表按 hasFilters 分流两句文案 —— 没筛选时说「暂无」，「没有匹配」会让人以为筛错了', async () => {
    await render(table({ hasFilters: false }));
    expect(text()).toContain('暂无数据');

    await render(table({ hasFilters: true }));
    expect(text()).toContain('没有匹配的');
  });

  it('有数据时不渲染任何空态', async () => {
    await render(table({ rows: [{ id: 'a' }], hasFilters: true }));
    expect(text()).not.toContain('暂无数据');
    expect(text()).not.toContain('没有匹配的');
    expect(text()).toContain('a');
  });

  it('★ 三态**互斥**：pending 时只出「加载中…」那一行', async () => {
    // 三条分支此前是三份复制品，散在三个页面里各写一遍。只断言「加载中…在」抓不到
    // 「三条同时渲染」——而那正是收成一个组件要守的口径（三条分支恰好出一条）。
    await render(table({ status: status({ isPending: true }) }));

    expect(text()).toContain('加载中…');
    expect(text()).not.toContain('暂无数据');
    expect(text()).not.toContain('加载失败');
    expect(mountNode.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('★ 三态互斥：error 时不出空态', async () => {
    await render(table({ status: status({ isError: true }) }));

    expect(text()).toContain('加载失败');
    expect(text()).not.toContain('暂无数据');
    expect(mountNode.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('★ 横幅与表体是**两句不同**的话 —— 合成一句会让同一个错误在一页上出现两次', async () => {
    // 表体那一行还挂着「重试」按钮，不是冗余：横幅给概览、表体给上下文 + 动作。
    await render(
      table({
        status: status({ isError: true }),
        tableErrorMessage: '任务记录加载失败',
      }),
    );

    expect(text()).toContain('加载失败'); // 横幅（errorMessage）
    expect(text()).toContain('任务记录加载失败'); // 表体（tableErrorMessage）
  });
});

describe('AdminQueryTable — 分页二态', () => {
  it('offset：hasNext 由**本地**推（page * pageSize < total）', async () => {
    await render(
      table({
        pagination: { kind: 'offset', page: 1, pageSize: 20, total: 25, prev: () => {}, next: () => {} },
      }),
    );
    const next = [...mountNode.querySelectorAll('button')].find((b) => b.textContent === '下一页');
    expect((next as HTMLButtonElement).disabled).toBe(false);

    await render(
      table({
        pagination: { kind: 'offset', page: 2, pageSize: 20, total: 25, prev: () => {}, next: () => {} },
      }),
    );
    const last = [...mountNode.querySelectorAll('button')].find((b) => b.textContent === '下一页');
    expect((last as HTMLButtonElement).disabled).toBe(true);
  });

  it('★ cursor：hasNext 由**服务端**回答，且**不显示「共 N 条」**（账本给不出总数，编一个比不显示更糟）', async () => {
    await render(
      table({
        pagination: { kind: 'cursor', page: 1, pageSize: 20, hasNext: true, prev: () => {}, next: () => {} },
      }),
    );

    const next = [...mountNode.querySelectorAll('button')].find((b) => b.textContent === '下一页');
    expect((next as HTMLButtonElement).disabled).toBe(false);
    expect(text()).not.toContain('共');
  });
});
