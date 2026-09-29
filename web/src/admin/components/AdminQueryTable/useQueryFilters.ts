/* ============================================
 * 列表查询页的**筛选与分页状态机**。
 *
 * 三张记录页（任务 / 充值 / 消费）此前各抄一份，连注释都逐字相同。
 * 抽出来的直接理由是它**已经漂过**：`'all'` 哨兵与空串两套判空口径在同一批页面里并存，
 * 于是「全部」被当成真值传下去、查询实打实带上 `status=all`，列表**静默为空**
 * （JobRecords 里那段注释就是自述）。口径只有一份时，这种分歧不可能只在某一页发生。
 *
 * ⚠️ `empty` 必须传**模块级常量**（不要在渲染里写对象字面量）：它是 `useCallback` 的依赖，
 *    每次渲染给一个新对象会让 `apply` / `reset` 每次都是新函数。
 * ============================================ */
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

export interface AppliedFilters<F extends Record<string, string>> {
  /** 输入框绑的值 */
  draft: F;
  setDraft: Dispatch<SetStateAction<F>>;
  /** 已生效的查询条件 —— 只有点「查询」或「重置」才会变 */
  applied: F;
  apply: () => void;
  reset: () => void;
  /**
   * 生效条件里有没有非空项 —— 决定空列表时说哪句话。
   *
   * <p>放在这里而不是让页面自己 `Object.values(applied)`：**那条判据正是漂过的东西** ——
   * 三页此前各写一份、其中一份还写成了另一种形态（逐字段 `!== ''` 的或）。它和
   * 「空串表示全部」是同一口径的两面，分开写迟早又不一致。
   */
  hasApplied: boolean;
  /**
   * `apply` / `reset` 的次数。
   *
   * <p>分页状态拿它当「回到第 1 页」的信号（见 {@link usePagedQuery} / {@link useCursorStack}）：
   * 换了筛选条件还停在第 3 页，看到的会是一个莫名其妙的空列表。
   * 此前每一页都手写一句 `setPage(1)`，写成 hook 之后页面**不可能漏做**。
   */
  epoch: number;
}

export function useAppliedFilters<F extends Record<string, string>>(empty: F): AppliedFilters<F> {
  const [draft, setDraft] = useState<F>(empty);
  // 查询条件与输入框分离：否则每敲一个字符都发一次请求
  const [applied, setApplied] = useState<F>(empty);
  const [epoch, setEpoch] = useState(0);

  const apply = useCallback(() => {
    setApplied(draft);
    setEpoch((n) => n + 1);
  }, [draft]);

  const reset = useCallback(() => {
    setDraft(empty);
    setApplied(empty);
    setEpoch((n) => n + 1);
  }, [empty]);

  return { draft, setDraft, applied, apply, reset, epoch, hasApplied: hasAny(applied) };
}

/** 有没有非空的筛选项。**空串 = 全部**（没有 `all` 哨兵）—— 见文件头那段说明。 */
function hasAny(filters: Record<string, string>): boolean {
  return Object.values(filters).some((value) => value !== "");
}

/** 页码分页（本地表能算总数，下一页由它推）。 */
export interface PagedQuery {
  page: number;
  prev: () => void;
  next: () => void;
}

/**
 * 页码状态，**跟着 `epoch` 回到第 1 页**。
 *
 * <p>用「记住上一次的 epoch」而不是 `useEffect` 同步：后者会先渲染一帧旧页码再跳回去。
 * 这里在渲染期直接推导出该用的页码，不额外触发一次渲染。
 */
export function usePagedQuery(epoch: number): PagedQuery {
  const [state, setState] = useState({ epoch, page: 1 });
  // epoch 变了 = 这一次的页码还没被用户动过 = 第 1 页
  const page = state.epoch === epoch ? state.page : 1;

  return {
    page,
    prev: () => setState({ epoch, page: Math.max(1, page - 1) }),
    next: () => setState({ epoch, page: page + 1 }),
  };
}

/** 页码分页接给 `<Pagination>` 的形状（下一页由 `page * pageSize < total` 推）。 */
export interface OffsetPagination extends PagedQuery {
  kind: "offset";
  pageSize: number;
  total: number;
}

/** 游标分页的返回：页码、当前游标、以及「下一页要用服务端给的那个游标」。 */
export interface CursorStack {
  page: number;
  pageToken: string;
  prev: () => void;
  /** 服务端给的下一个游标；空串 = 没有下一页（**由服务端回答，本地推不出来**） */
  next: (token: string) => void;
}

/**
 * 游标栈：`tokens[i]` 是第 i+1 页的入参游标。栈深就是当前页码 ——
 * 「上一页」需要**当初那一页的游标**，而游标是从后往前不可逆的，所以只能自己存。
 *
 * <p>同样跟着 `epoch` 回到栈底。
 */
export function useCursorStack(epoch: number): CursorStack {
  const [state, setState] = useState({ epoch, tokens: [""] });
  const tokens = state.epoch === epoch ? state.tokens : [""];

  return {
    page: tokens.length,
    pageToken: tokens[tokens.length - 1] ?? "",
    prev: () => setState({ epoch, tokens: tokens.length > 1 ? tokens.slice(0, -1) : tokens }),
    next: (token: string) => {
      if (token) setState({ epoch, tokens: [...tokens, token] });
    },
  };
}

/** 游标分页接给 `<Pagination>` 的形状（**不传 total**：账本给不出总数，编一个比不显示更糟）。 */
export interface CursorPagination extends Omit<CursorStack, "next"> {
  kind: "cursor";
  pageSize: number;
  /** 服务端给的下一个游标；空串 = 没有下一页 */
  nextToken: string;
  onNext: () => void;
}
