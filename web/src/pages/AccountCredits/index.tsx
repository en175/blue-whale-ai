/* ============================================
 * 账户积分与订单：独立网页
 * 数据走 fetchAccountCreditsPage，稍后替换函数体即可接真实接口
 * ============================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentTitle } from '@/seo/useDocumentTitle';
import SummaryCards from './SummaryCards';
import { fetchAccountCreditsPage, PLACEHOLDER_PAGE_DATA } from './data';
import type {
  AccountCreditsPageData,
  AcquiredRecord,
  ConsumedRecord,
  OrderRecord,
  OrderStatus,
  RefundedRecord,
} from './types';
import styles from './index.module.css';

type MainTab = 'orders' | 'ledger';
type LedgerTab = 'acquired' | 'consumed' | 'refunded';

const PAGE_SIZES = [10, 20, 50] as const;

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  paid: '已到账',
  failed: '支付失败',
  expired: '已取消',
  grant_failed: '到账异常',
};

const ORDER_STATUS_CLASS: Record<OrderStatus, string> = {
  pending: styles.statusMuted,
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

function formatYuan(value: number | null): string {
  if (value == null) return '—';
  return `¥${value.toFixed(2)}`;
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

const SOURCE_OPTIONS = [
  { value: '', label: '获取来源' },
  { value: '充值到账', label: '充值到账' },
];

const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ value: String(size), label: `${size} 条` }));

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
                  <span className={styles.check}>{active ? '✓' : ''}</span>
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
  const [data, setData] = useState<AccountCreditsPageData>(PLACEHOLDER_PAGE_DATA);
  const [mainTab, setMainTab] = useState<MainTab>('ledger');
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>('acquired');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(20);
  const [dateFrom, setDateFrom] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');

  useEffect(() => {
    let alive = true;
    fetchAccountCreditsPage().then((next) => {
      if (alive) setData(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [mainTab, ledgerTab, pageSize, dateFrom, sourceFilter, statusFilter]);

  const filteredOrders = useMemo(() => {
    return data.orders.filter((row) => {
      if (dateFrom && !row.orderedAt.startsWith(dateFrom)) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      return true;
    });
  }, [data.orders, dateFrom, statusFilter]);

  const filteredAcquired = useMemo(() => {
    return data.acquired.filter((row) => {
      if (dateFrom && !row.acquiredAt.startsWith(dateFrom)) return false;
      if (sourceFilter && row.source !== sourceFilter) return false;
      return true;
    });
  }, [data.acquired, dateFrom, sourceFilter]);

  const filteredConsumed = useMemo(() => {
    return data.consumed.filter((row) => !dateFrom || row.consumedAt.startsWith(dateFrom));
  }, [data.consumed, dateFrom]);

  const filteredRefunded = useMemo(() => {
    return data.refunded.filter((row) => !dateFrom || row.refundedAt.startsWith(dateFrom));
  }, [data.refunded, dateFrom]);

  const currentRows =
    mainTab === 'orders'
      ? filteredOrders
      : ledgerTab === 'acquired'
        ? filteredAcquired
        : ledgerTab === 'consumed'
          ? filteredConsumed
          : filteredRefunded;
  const total = currentRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pagedOrders = filteredOrders.slice(start, start + pageSize);
  const pagedAcquired = filteredAcquired.slice(start, start + pageSize);
  const pagedConsumed = filteredConsumed.slice(start, start + pageSize);
  const pagedRefunded = filteredRefunded.slice(start, start + pageSize);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>账户积分与订单</h1>
      </header>

      <SummaryCards summary={data.summary} />

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
          <button type="button" className={styles.exportBtn}>导出明细</button>
        </div>

        {mainTab === 'ledger' && (
          <div className={styles.subHead}>
            <div className={styles.subTabs}>
              {([
                ['acquired', '已获取'],
                ['consumed', '已消耗'],
                ['refunded', '已退回'],
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
            <span className={styles.subNote}>四类流水 · 一个业务动作一行</span>
          </div>
        )}

        <div className={styles.toolbar}>
          <label className={styles.filter}>
            <span>请选择日期</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          {mainTab === 'orders' ? (
            <FilterSelect
              value={statusFilter}
              onChange={(next) => setStatusFilter(next as '' | OrderStatus)}
              options={[
                { value: '', label: '全部状态' },
                ...(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((key) => ({
                  value: key,
                  label: ORDER_STATUS_LABEL[key],
                })),
              ]}
            />
          ) : ledgerTab === 'acquired' ? (
            <FilterSelect value={sourceFilter} onChange={setSourceFilter} options={SOURCE_OPTIONS} />
          ) : null}
        </div>

        {mainTab === 'orders' ? (
          <OrdersTable rows={pagedOrders} />
        ) : ledgerTab === 'acquired' ? (
          <AcquiredTable rows={pagedAcquired} />
        ) : ledgerTab === 'consumed' ? (
          <ConsumedTable rows={pagedConsumed} />
        ) : (
          <RefundedTable rows={pagedRefunded} />
        )}

        <div className={styles.pager}>
          <button type="button" className={styles.pageBtn} disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            上一页
          </button>
          <span className={styles.pageCurrent}>{safePage}</span>
          <button type="button" className={styles.pageBtn} disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
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
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className={styles.empty}>暂无记录</td>
    </tr>
  );
}

function OrdersTable({ rows }: { rows: OrderRecord[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>下单时间</th>
          <th>商品名称</th>
          <th>订单编号</th>
          <th>支付金额</th>
          <th>到账积分</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={7} /> : rows.map((row) => (
          <tr key={row.id}>
            <td>{row.orderedAt}</td>
            <td>{row.productName}</td>
            <td className={styles.mono}>{row.tradeNo}</td>
            <td>{formatYuan(row.amountYuan)}</td>
            <td>{formatCredits(row.creditsGranted)}</td>
            <td>
              <span className={`${styles.badge} ${ORDER_STATUS_CLASS[row.status]}`}>
                {ORDER_STATUS_LABEL[row.status]}
              </span>
            </td>
            <td>
              <button type="button" className={styles.copyBtn} onClick={() => copyText(row.tradeNo)}>
                复制订单号
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AcquiredTable({ rows }: { rows: AcquiredRecord[] }) {
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
        {rows.length === 0 ? <EmptyRow cols={6} /> : rows.map((row) => (
          <tr key={row.id}>
            <td>{row.acquiredAt}</td>
            <td><span className={styles.tag}>{row.source}</span></td>
            <td>{row.detail}</td>
            <td>{dash(row.effectiveAt)}</td>
            <td className={row.remaining != null ? styles.expireSoon : undefined}>{dash(row.expiresAt)}</td>
            <td className={styles.plus}>{row.credits == null ? '—' : `+${formatCredits(row.credits)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConsumedTable({ rows }: { rows: ConsumedRecord[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>消耗时间</th>
          <th>任务类型</th>
          <th>模型</th>
          <th>任务详情</th>
          <th>任务 ID</th>
          <th>消耗积分</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={6} /> : rows.map((row) => (
          <tr key={row.id}>
            <td>{row.consumedAt}</td>
            <td>
              <span className={styles.tag}>{row.kind === 'expire' ? '过期核销' : row.taskType}</span>
            </td>
            <td>{dash(row.model)}</td>
            <td>{dash(row.detail)}</td>
            <td className={styles.mono}>{dash(row.taskId)}</td>
            <td className={styles.minus}>{row.credits == null ? '—' : `-${formatCredits(row.credits)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RefundedTable({ rows }: { rows: RefundedRecord[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>返还时间</th>
          <th>任务类型</th>
          <th>模型</th>
          <th>任务详情</th>
          <th>任务 ID</th>
          <th>返还积分</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={6} /> : rows.map((row) => (
          <tr key={row.id}>
            <td>{row.refundedAt}</td>
            <td>{row.taskType}</td>
            <td>{dash(row.model)}</td>
            <td>{dash(row.detail)}</td>
            <td className={styles.mono}>{dash(row.taskId)}</td>
            <td className={styles.plus}>{row.credits == null ? '—' : `+${formatCredits(row.credits)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
