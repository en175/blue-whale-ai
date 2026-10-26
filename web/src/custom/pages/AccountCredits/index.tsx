import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  accountConsumptionsOptions,
  creditLotsOptions,
  ordersOptions,
  sourceLabel,
  usageTokenOptions,
  type ConsumptionRow,
  type CreditLotRow,
  type OrderRow,
} from '@/custom/api/accountCredits';
import { ORDER_STATUS_LABEL, type OrderStatus } from '@/custom/enums';
import { taskTypeLabel } from '@/shared/enums/taskTypeLabels';
import { useDocumentTitle } from '@/shared/seo/useDocumentTitle';
import { formatBeijingDateTime } from './format';
import Checkbox from '@/custom/components/Checkbox';
import Empty from '@/custom/components/Empty';
import ExportDialog from './ExportDialog';
import SummaryCards from './SummaryCards';
import styles from './index.module.css';

type MainTab = 'orders' | 'ledger';
type LedgerTab = 'acquired' | 'consumed';

const PAGE_SIZES = [10, 20, 50] as const;

const ORDER_STATUS_CLASS: Record<OrderStatus, string> = {
  pending: styles.statusMuted,
  paid_pending: styles.statusWarn,
  paid: styles.statusOk,
  failed: styles.statusBad,
  expired: styles.statusMuted,
  grant_failed: styles.statusBad,
};

function dash(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  return String(value);
}

function formatCredits(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('zh-CN');
}

const fenToYuan = (fen: number | null): string =>
  fen == null ? '—' : `¥${(fen / 100).toFixed(2)}`;

function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ value: String(size), label: `${size} 条` }));

const ORDER_STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  ...(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((key) => ({
    value: key,
    label: ORDER_STATUS_LABEL[key],
  })),
];

const EXPIRE_SOON_DAYS = 30;

function isExpireSoon(expiresAt: string): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return false;
  const days = (ms - Date.now()) / 86_400_000;
  return days >= 0 && days <= EXPIRE_SOON_DAYS;
}

function FilterSelect({
  value,
  options,
  onChange,
  compact,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((item) => item.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className={`${styles.filterSelect} ${compact ? styles.filterSelectCompact : ''}`} ref={rootRef}>
      <button type="button" className={styles.filter} onClick={() => setOpen((prev) => !prev)}>
        <span>{current?.label}</span>
        <svg className={open ? styles.chevronOpen : styles.chevron} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className={styles.filterMenu}>
          {options.map((item) => {
            const active = item.value === value;
            return (
              <li key={item.value || 'all'}>
                <button
                  type="button"
                  className={active ? styles.filterOptionOn : styles.filterOption}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <Checkbox checked={active} />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function AccountCredits() {
  useDocumentTitle();
  const [mainTab, setMainTab] = useState<MainTab>('ledger');
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>('acquired');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [mainTab, ledgerTab, pageSize, statusFilter]);

  const token = useQuery(usageTokenOptions());
  const orders = useQuery({
    ...ordersOptions({ page, pageSize, ...(statusFilter ? { status: statusFilter } : {}) }),
    enabled: mainTab === 'orders',
    placeholderData: keepPreviousData,
  });
  const lots = useQuery({
    ...creditLotsOptions({ page, pageSize }),
    enabled: mainTab === 'ledger' && ledgerTab === 'acquired',
    placeholderData: keepPreviousData,
  });
  const consumptions = useQuery({
    ...accountConsumptionsOptions({ page, pageSize, type: 'consume,expire' }),
    enabled: mainTab === 'ledger' && ledgerTab === 'consumed',
    placeholderData: keepPreviousData,
  });

  const activeQuery =
    mainTab === 'orders' ? orders : ledgerTab === 'acquired' ? lots : consumptions;
  const total = activeQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, pageCount);
  const pagerVisible = activeQuery.isSuccess && total > 0;

  const exportScope = mainTab === 'orders' ? 'orders' : ledgerTab === 'acquired' ? 'gain' : 'consume';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>账户积分与订单</h1>
      </header>

      <SummaryCards balance={token.data?.credits ?? null} />

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div className={styles.mainTabs}>
            <button type="button" className={mainTab === 'orders' ? styles.mainTabOn : styles.mainTab} onClick={() => setMainTab('orders')}>
              订单记录
            </button>
            <button type="button" className={mainTab === 'ledger' ? styles.mainTabOn : styles.mainTab} onClick={() => setMainTab('ledger')}>
              积分明细
            </button>
          </div>
          <button type="button" className={styles.exportBtn} onClick={() => setExportOpen(true)}>
            导出明细
          </button>
        </div>

        {mainTab === 'ledger' && (
          <div className={styles.subHead}>
            <div className={styles.subTabs}>
              {([
                ['acquired', '已获取'],
                ['consumed', '已消耗'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={ledgerTab === key ? styles.subTabOn : styles.subTab}
                  onClick={() => setLedgerTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.toolbar}>
          {mainTab === 'orders' ? (
            <FilterSelect value={statusFilter} onChange={setStatusFilter} options={ORDER_STATUS_OPTIONS} />
          ) : null}
        </div>

        {mainTab === 'orders' ? (
          <OrdersTable query={orders} />
        ) : ledgerTab === 'acquired' ? (
          <AcquiredTable query={lots} />
        ) : (
          <ConsumedTable query={consumptions} />
        )}

        <div className={styles.pager}>
          <button type="button" className={styles.pageBtn} disabled={!pagerVisible || safePage <= 1} onClick={() => setPage(safePage - 1)}>
            上一页
          </button>
          <span className={styles.pageCurrent}>{safePage}</span>
          <button type="button" className={styles.pageBtn} disabled={!pagerVisible || safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
            下一页
          </button>
          <span className={styles.pageSize}>
            每页
            <FilterSelect
              compact
              value={String(pageSize)}
              onChange={(next) => setPageSize(Number(next) as (typeof PAGE_SIZES)[number])}
              options={PAGE_SIZE_OPTIONS}
            />
            · 共 {total} 条
          </span>
        </div>
      </section>

      <ExportDialog
        open={exportOpen}
        scope={exportScope}
        {...(mainTab === 'orders' && statusFilter ? { status: statusFilter } : {})}
        {...(exportScope === 'consume' ? { type: 'consume,expire' } : {})}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className={styles.empty}><Empty title="暂无记录" /></td>
    </tr>
  );
}

function ErrorRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className={styles.empty}>加载失败</td>
    </tr>
  );
}

function LoadingRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className={styles.empty}>加载中…</td>
    </tr>
  );
}

function rowState<T>(query: { isPending: boolean; isError: boolean; data?: { items: T[] } }) {
  if (query.isPending) return 'loading' as const;
  if (query.isError) return 'error' as const;
  return (query.data?.items.length ?? 0) === 0 ? 'empty' as const : 'rows' as const;
}

function OrdersTable({ query }: { query: { isPending: boolean; isError: boolean; data?: { items: OrderRow[] } } }) {
  const state = rowState(query);
  const rows = query.data?.items ?? [];
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>下单时间</th>
          <th>商品名称</th>
          <th>支付金额</th>
          <th>到账积分</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {state === 'loading' ? <LoadingRow cols={6} />
          : state === 'error' ? <ErrorRow cols={6} />
          : state === 'empty' ? <EmptyRow cols={6} />
          : rows.map((row) => (
            <tr key={row.trade_no}>
              <td>{formatBeijingDateTime(row.created_at)}</td>
              <td>{row.product_name}</td>
              <td>{fenToYuan(row.amount_fen)}</td>
              <td>{row.status === 'paid' ? formatCredits(row.credits + row.bonus_credits) : '—'}</td>
              <td>
                <span className={`${styles.badge} ${ORDER_STATUS_CLASS[row.status] ?? styles.statusMuted}`}>
                  {ORDER_STATUS_LABEL[row.status] ?? row.status}
                </span>
              </td>
              <td>
                <button type="button" className={styles.copyBtn} onClick={() => copyText(row.trade_no)}>
                  复制订单号
                </button>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

function AcquiredTable({ query }: { query: { isPending: boolean; isError: boolean; data?: { items: CreditLotRow[] } } }) {
  const state = rowState(query);
  const rows = query.data?.items ?? [];
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>获取时间</th>
          <th>获取来源</th>
          <th>获取详情</th>
          <th>积分生效时间</th>
          <th>积分到期时间</th>
          <th>积分值</th>
        </tr>
      </thead>
      <tbody>
        {state === 'loading' ? <LoadingRow cols={6} />
          : state === 'error' ? <ErrorRow cols={6} />
          : state === 'empty' ? <EmptyRow cols={6} />
          : rows.map((row) => (
            <tr key={row.lot_id}>
              <td>{formatBeijingDateTime(row.created_at)}</td>
              <td><span className={styles.tag}>{sourceLabel(row.source)}</span></td>
              <td>{row.detail}</td>
              <td>{formatBeijingDateTime(row.created_at)}</td>
              <td className={isExpireSoon(row.expires_at) ? styles.expireSoon : undefined}>
                {row.expires_at ? formatBeijingDateTime(row.expires_at) : '永久有效'}
              </td>
              <td className={styles.plus}>{row.amount == null ? '—' : `+${formatCredits(row.amount)}`}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

function consumedTypeLabel(row: ConsumptionRow): string {
  if (row.task_type) return taskTypeLabel(row.task_type);
  return row.type === 'expire' ? '过期核销' : '—';
}

function ConsumedTable({ query }: { query: { isPending: boolean; isError: boolean; data?: { items: ConsumptionRow[] } } }) {
  const state = rowState(query);
  const rows = query.data?.items ?? [];
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>消耗时间</th>
          <th>任务类型</th>
          <th>模型</th>
          <th>任务详情</th>
          <th>消耗积分</th>
        </tr>
      </thead>
      <tbody>
        {state === 'loading' ? <LoadingRow cols={5} />
          : state === 'error' ? <ErrorRow cols={5} />
          : state === 'empty' ? <EmptyRow cols={5} />
          : rows.map((row) => (
            <tr key={row.id}>
              <td>{formatBeijingDateTime(row.created_at)}</td>
              <td><span className={styles.tag}>{consumedTypeLabel(row)}</span></td>
              <td>{row.model_label ?? row.model_id ?? '—'}</td>
              <td>{dash(row.detail)}</td>
              <td className={styles.minus}>{row.credits == null ? '—' : `-${formatCredits(row.credits)}`}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
