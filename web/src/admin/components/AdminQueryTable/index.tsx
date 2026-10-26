import type { ReactNode } from "react";
import { isApiError } from "@/shared/api/http";
import { Alert, Button, Empty, Page, PageHeader, Pagination, Table, Toolbar } from "../../ui";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
}

export interface OffsetPaginationState {
  kind: "offset";
  page: number;
  pageSize: number;
  total: number;
  prev: () => void;
  next: () => void;
}

export interface CursorPaginationState {
  kind: "cursor";
  page: number;
  pageSize: number;
  hasNext: boolean;
  prev: () => void;
  next: () => void;
}

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
  filters: ReactNode;
  actions: ReactNode;
  hasFilters: boolean;
  filteredEmptyMessage: string;
  emptyMessage: string;
  errorMessage: string;
  tableErrorMessage?: string;
  notice?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  status: QueryStatus;
  pagination: OffsetPaginationState | CursorPaginationState;
}

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
        hasNext={
          pagination.kind === "cursor"
            ? pagination.hasNext
            : pagination.page * pagination.pageSize < pagination.total
        }
        total={pagination.kind === "offset" ? pagination.total : undefined}
        loading={status.isFetching}
        onPrev={pagination.prev}
        onNext={pagination.next}
      />
    </Page>
  );
}
