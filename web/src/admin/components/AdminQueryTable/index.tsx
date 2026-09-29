/* ============================================
 * AdminQueryTable —— 管理端「列表查询页」的骨架。
 *
 * 三张记录页（任务 / 充值 / 消费）的骨架此前是逐字复制的：三态 tbody 的判据
 * （`isPending` / `isError` / 空列表三条分支）一字不差，连注释都相同。
 *
 * 收成一处的直接收益有两个：
 *
 * 1. **口径单点**。三态、空态文案、分页接线只有一份，第四张列表页从此是「声明」而不是
 *    「复制」——复制出来的东西一定会漂。
 * 2. **第一次有测试面**。三态与分页接线的判定此前只活在页面里，而页面只能整页测；
 *    收进组件之后可以直接对着它测（见 `index.test.tsx`）。
 *
 * ⚠️ 本组件**不含取数**：`useQuery` 仍由页面调用，`queryOptions` 工厂留在
 *    `web/src/api/<resource>.ts`（前端交付规则的 request.md）。组件只接
 *    「已经拿到的结果 + 列定义 + 分页形状」，这样它不需要知道任何资源长什么样。
 * ============================================ */
import type { ReactNode } from "react";
import { isApiError } from "@/api/http";
import { Alert, Button, Empty, Page, PageHeader, Pagination, Table, Toolbar } from "../../ui";

/** 一列：表头 + 这一行怎么渲染。 */
export interface Column<T> {
  /** React key；同一张表里唯一即可 */
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
}

/**
 * 页码分页的形状。`hasNext` 由**本地推**（`page * pageSize < total`）——
 * 本地表能算总数，这是它的特权。
 */
export interface OffsetPaginationState {
  kind: "offset";
  page: number;
  pageSize: number;
  total: number;
  prev: () => void;
  next: () => void;
}

/**
 * 游标分页的形状。**没有 `total`**：账本给不出总数，编一个出来比不显示更糟；
 * `hasNext` 也只能由服务端给的下一个游标回答。
 */
export interface CursorPaginationState {
  kind: "cursor";
  page: number;
  pageSize: number;
  hasNext: boolean;
  prev: () => void;
  next: () => void;
}

/** `<AdminQueryTable>` 要用的那几项查询状态（`useQuery` 结果的子集）。 */
export interface QueryStatus {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: () => void;
}

export interface AdminQueryTableProps<T> {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 筛选输入框（页面的槽位） */
  filters: ReactNode;
  /** 右对齐的动作区，通常是「查询 / 重置」两颗按钮 */
  actions: ReactNode;
  /**
   * 列表为空时说不说「没有匹配的」。
   *
   * <p>直接接 `useAppliedFilters` 的 `hasApplied` —— 它按「**空串 = 全部**」的口径统一算出来。
   * 这条判据此前三页各写一份（其中一份形态还不同），正是本工单要消灭的那种重复。
   */
  hasFilters: boolean;
  /** 有筛选条件、但一条都没匹配上 */
  filteredEmptyMessage: string;
  /** 压根没有数据（或没筛选） */
  emptyMessage: string;
  errorMessage: string;
  /**
   * 表格**内部**那句错误文案（错误时表里那一行说什么）。
   *
   * <p>与 `errorMessage`（顶部横幅）**刻意分开**：横幅给概览、表体给上下文，本来就是
   * 两句不同的话。合成一句会让同一个错误在一页上出现两次，而表体那一行还挂着「重试」按钮，
   * 不是冗余。不传就回落 `errorMessage`。
   */
  tableErrorMessage?: string;
  /**
   * 页面自己的横幅，渲染在查询错误提示之后、表格之前。
   *
   * <p>给的是**位置**不是语义：目前只有充值记录页用它（人工补发的结果横幅）。
   * 那种结果要留在屏幕上让人对照着那一行看，不能塞进 toast。
   */
  notice?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  status: QueryStatus;
  pagination: OffsetPaginationState | CursorPaginationState;
}

/** 三态那一行：三条分支的结构相同，只有内容不同。 */
function StateRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}

export default function AdminQueryTable<T>({
  title,
  subtitle,
  filters,
  actions,
  hasFilters,
  filteredEmptyMessage,
  emptyMessage,
  errorMessage,
  tableErrorMessage,
  notice,
  columns,
  rows,
  rowKey,
  status,
  pagination,
}: AdminQueryTableProps<T>) {
  const colCount = columns.length;

  return (
    <Page>
      <PageHeader title={title} subtitle={subtitle} />

      <Toolbar actions={actions}>{filters}</Toolbar>

      {status.isError && (
        <Alert tone="danger">{isApiError(status.error) ? status.error.message : errorMessage}</Alert>
      )}

      {notice}

      <Table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {status.isPending && (
            <StateRow colSpan={colCount}>
              <Empty message="加载中…" />
            </StateRow>
          )}
          {!status.isPending && status.isError && (
            <StateRow colSpan={colCount}>
              <Empty
                message={tableErrorMessage ?? errorMessage}
                extra={
                  <Button size="sm" onClick={() => void status.refetch()}>
                    重试
                  </Button>
                }
              />
            </StateRow>
          )}
          {!status.isPending && !status.isError && rows.length === 0 && (
            <StateRow colSpan={colCount}>
              <Empty message={hasFilters ? filteredEmptyMessage : emptyMessage} />
            </StateRow>
          )}
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>

      <Pagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        // 游标形状显式给 hasNext（服务端回答的）；页码形状给了 total 由它自己推
        hasNext={
          pagination.kind === "cursor"
            ? pagination.hasNext
            : pagination.page * pagination.pageSize < pagination.total
        }
        // 游标分页没有总数 —— 不传，而不是编一个
        total={pagination.kind === "offset" ? pagination.total : undefined}
        loading={status.isFetching}
        onPrev={pagination.prev}
        onNext={pagination.next}
      />
    </Page>
  );
}
