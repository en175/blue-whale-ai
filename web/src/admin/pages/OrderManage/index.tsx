/* ============================================
 * OrderManage 订单管理：查看充值订单、支付链路、手动确认与导出
 * 数据源 GET /api/admin/orders + POST /:tradeNo/complete + GET /api/admin/operation-logs
 * ============================================ */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Search, X, CheckCircle2, Check } from 'lucide-react';
import {
  fetchAdminOrders,
  completeAdminOrder,
  fetchOperationLogs,
  type AdminOrderRow,
  type OperationLog,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import { formatLogIp } from '@/admin/formatLogIp';
import styles from './index.module.css';

/** 订单状态 */
type OrderStatus = 'pending' | 'success' | 'expired' | 'failed';

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  success: '已到账',
  expired: '已过期',
  failed: '支付失败',
};

/** CSS 类按状态映射（模板字符串索引无法通过类型检查） */
const STATUS_TEXT_CLS: Record<OrderStatus, string> = {
  pending: styles.st_pending,
  success: styles.st_paid,
  expired: styles.st_expired,
  failed: styles.st_failed,
};

const STATUS_BADGE_CLS: Record<OrderStatus, string> = {
  pending: styles.badge_pending,
  success: styles.badge_paid,
  expired: styles.badge_expired,
  failed: styles.badge_failed,
};

/** 支付方式 code → 展示名 */
const METHOD_LABEL: Record<string, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
};

const methodLabel = (code: string) => METHOD_LABEL[code] ?? (code || '—');

/** ISO 时间 → 本地展示，空值显示 — */
const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';

const fmtMoney = (a: number) => `¥${parseFloat(a.toFixed(2))}`;

const fmt = (n: number) => n.toLocaleString('en-US');

/** 日期键（yyyy-mm-dd），用于区间比较 */
const dateKey = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 支付链路步骤状态 */
type StepState = 'done' | 'wait' | 'fail';

const STEP_LABELS = ['创建订单', '发起支付', '支付回调', '积分到账'];

const stepsFor = (s: OrderStatus): StepState[] => {
  switch (s) {
    case 'success':
      return ['done', 'done', 'done', 'done'];
    case 'pending':
      return ['done', 'done', 'wait', 'wait'];
    case 'expired':
      return ['done', 'wait', 'wait', 'wait'];
    case 'failed':
      return ['done', 'done', 'fail', 'wait'];
  }
};

/** 解析 detail JSON 字符串中的字段 */
function parseDetail(detail: string): { reason?: string; value?: number } {
  try {
    const obj = JSON.parse(detail);
    return typeof obj === 'object' && obj !== null ? (obj as { reason?: string; value?: number }) : {};
  } catch {
    return {};
  }
}

export default function OrderManage() {
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detailNo, setDetailNo] = useState<string | null>(null);
  const [confirmNo, setConfirmNo] = useState<string | null>(null);

  /** 拉取订单列表（前 100 条，筛选均本地进行） */
  const loadOrders = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await fetchAdminOrders({ page: 1, pageSize: 100 });
      setOrders(data.list);
    } catch (e) {
      setLoadError(isApiError(e) ? e.message : '订单加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  /** 本地筛选：状态筛选在服务端返回后本地过滤（符合规范） */
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (
        kw &&
        !o.tradeNo.toLowerCase().includes(kw) &&
        !(o.nickname || '').toLowerCase().includes(kw) &&
        !(o.phone || '').includes(kw) &&
        !String(o.userId).includes(kw)
      )
        return false;
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (methodFilter !== 'all' && o.paymentMethod !== methodFilter) return false;
      const key = dateKey(o.createdAt);
      if (from && key && key < from) return false;
      if (to && key && key > to) return false;
      return true;
    });
  }, [orders, search, statusFilter, methodFilter, from, to]);

  const pendingCount = orders.filter((o) => o.status === 'pending').length;

  const findOrder = (no: string | null) => orders.find((o) => o.tradeNo === no);

  /** 导出 Excel（CSV with BOM） */
  const exportExcel = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ['交易号', '用户', '手机号', '档位', '金额', '积分', '赠送积分', '支付方式', '状态', '创建时间', '支付时间', '到账时间'];
    const lines = filtered.map((o) =>
      [o.tradeNo, o.nickname || `(#${o.userId})`, o.phone, o.tierName, o.price, o.points, o.bonus, methodLabel(o.paymentMethod), STATUS_LABEL[o.status], fmtTime(o.createdAt), fmtTime(o.paidAt), fmtTime(o.arrivedAt)]
        .map(esc)
        .join(',')
    );
    const csv = '\uFEFF' + [head.map(esc).join(','), ...lines].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `订单导出_${dateKey(new Date().toISOString())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>订单管理</h1>
          <p className={styles.subtitle}>查看充值订单、支付链路、手动确认与导出</p>
        </div>
        <button className={styles.exportBtn} onClick={exportExcel}>
          <Download size={16} strokeWidth={2} />
          <span>导出 Excel</span>
        </button>
      </div>

      {/* 筛选行 + 日期区间 */}
      <div className={styles.filterRow}>
        <div className={styles.searchWrap}>
          <Search size={16} strokeWidth={2} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="搜索用户/手机号/交易号..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">全部状态</option>
          <option value="pending">待支付</option>
          <option value="success">已到账</option>
          <option value="expired">已过期</option>
          <option value="failed">支付失败</option>
        </select>
        <select className={styles.select} value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
          <option value="all">全部方式</option>
          <option value="wechat">微信支付</option>
          <option value="alipay">支付宝</option>
        </select>
        <input type="date" className={styles.dateInput} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className={styles.rangeDash}>—</span>
        <input type="date" className={styles.dateInput} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {/* 待处理计数 */}
      <div className={styles.pendingCount}>{pendingCount} 笔待处理</div>

      {/* 订单表格 */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>交易号</th>
              <th>用户</th>
              <th>档位</th>
              <th>金额</th>
              <th>积分</th>
              <th>支付方式</th>
              <th>状态</th>
              <th>时间</th>
              <th className={styles.thRight}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className={styles.tableState}>
                  加载中…
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan={9} className={styles.tableState}>
                  {loadError}{' '}
                  <button className={styles.retryLink} onClick={() => void loadOrders()}>
                    重试
                  </button>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.tableState}>
                  暂无订单
                </td>
              </tr>
            ) : (
              filtered.map((o) => (
                <tr key={o.tradeNo}>
                  <td>
                    <button className={styles.noLink} onClick={() => setDetailNo(o.tradeNo)}>
                      {o.tradeNo}
                    </button>
                  </td>
                  <td className={styles.cellUser}>{o.nickname || `(#${o.userId})`}</td>
                  <td>{o.tierName}</td>
                  <td className={styles.cellNum}>{fmtMoney(o.price)}</td>
                  <td className={styles.cellNum}>{fmt(o.points)}</td>
                  <td>{methodLabel(o.paymentMethod)}</td>
                  <td>
                    <span className={STATUS_TEXT_CLS[o.status]}>{STATUS_LABEL[o.status]}</span>
                  </td>
                  <td className={styles.cellTime}>{fmtTime(o.createdAt)}</td>
                  <td>
                    <div className={styles.actionGroup}>
                      {o.status === 'pending' ? (
                        <button className={styles.iconBtn} title="手动确认" onClick={() => setConfirmNo(o.tradeNo)}>
                          <CheckCircle2 size={16} strokeWidth={2} />
                        </button>
                      ) : (
                        <span className={styles.dash}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 订单详情 */}
      {detailNo && findOrder(detailNo) && (
        <DetailModal order={findOrder(detailNo)!} onClose={() => setDetailNo(null)} />
      )}

      {/* 手动确认 */}
      {confirmNo && findOrder(confirmNo) && (
        <ConfirmOrderModal
          order={findOrder(confirmNo)!}
          onClose={() => setConfirmNo(null)}
          onDone={() => {
            setConfirmNo(null);
            void loadOrders();
          }}
        />
      )}
    </div>
  );
}

/* ============ 订单详情·支付全链路 + 操作日志 ============ */
function DetailModal({ order, onClose }: { order: AdminOrderRow; onClose: () => void }) {
  const steps = stepsFor(order.status);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState('');

  /** 打开时按 category=order + 交易号拉取操作日志 */
  useEffect(() => {
    let cancelled = false;
    fetchOperationLogs({ category: 'order', searchText: order.tradeNo })
      .then((list) => {
        if (!cancelled) setLogs(list);
      })
      .catch((e) => {
        if (!cancelled) setLogsError(isApiError(e) ? e.message : '日志加载失败');
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [order.tradeNo]);

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>订单详情·支付全链路</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {/* 链路步骤 */}
          <div className={styles.steps}>
            {steps.map((s, i) => (
              <Fragment key={STEP_LABELS[i]}>
                {i > 0 && <div className={steps[i - 1] === 'done' && s === 'done' ? styles.stepLineDone : styles.stepLine} />}
                <div className={`${styles.stepItem} ${s === 'done' ? styles.stepDone : s === 'fail' ? styles.stepFail : styles.stepWait}`}>
                  <div className={styles.stepDot}>{s === 'done' && <Check size={16} strokeWidth={3} />}</div>
                  <div className={styles.stepLabel}>{STEP_LABELS[i]}</div>
                </div>
              </Fragment>
            ))}
          </div>

          {/* 信息网格 */}
          <div className={styles.infoGrid}>
            <div>
              <div className={styles.infoLabel}>交易号</div>
              <div className={`${styles.infoValue} ${styles.mono}`}>{order.tradeNo}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>状态</div>
              <span className={STATUS_BADGE_CLS[order.status]}>{STATUS_LABEL[order.status]}</span>
            </div>
            <div>
              <div className={styles.infoLabel}>用户</div>
              <div className={styles.infoValue}>
                {order.nickname ? `${order.nickname} (#${order.userId})` : `(#${order.userId})`}
              </div>
            </div>
            <div>
              <div className={styles.infoLabel}>手机号</div>
              <div className={styles.infoValue}>{order.phone || '—'}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>档位</div>
              <div className={styles.infoValue}>{order.tierName}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>金额</div>
              <div className={styles.infoValue}>{fmtMoney(order.price)}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>购买积分</div>
              <div className={styles.infoValue}>{fmt(order.points)}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>赠送积分</div>
              <div className={`${styles.infoValue} ${styles.greenText}`}>+{fmt(order.bonus)}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>支付方式</div>
              <div className={styles.infoValue}>{methodLabel(order.paymentMethod)}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>支付平台流水号</div>
              <div className={`${styles.infoValue} ${styles.mono}`}>{order.platformRefNo || '—'}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>IP</div>
              <div className={`${styles.infoValue} ${styles.mono}`}>{order.ip || '—'}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>创建时间</div>
              <div className={styles.infoValue}>{fmtTime(order.createdAt)}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>支付时间</div>
              <div className={styles.infoValue}>{fmtTime(order.paidAt)}</div>
            </div>
            <div>
              <div className={styles.infoLabel}>到账时间</div>
              <div className={styles.infoValue}>{fmtTime(order.arrivedAt)}</div>
            </div>
          </div>

          {/* 操作日志（补单记录） */}
          <div className={styles.logSection}>
            <h3 className={styles.logTitle}>操作日志</h3>
            {logsLoading ? (
              <div className={styles.logEmpty}>加载中…</div>
            ) : logsError ? (
              <div className={styles.logEmpty}>{logsError}</div>
            ) : logs.length === 0 ? (
              <div className={styles.logEmpty}>暂无操作记录</div>
            ) : (
              <div className={styles.logList}>
                {logs.map((log) => {
                  const d = parseDetail(log.detail);
                  return (
                    <div key={log.id} className={styles.logItem}>
                      <div className={styles.logHead}>
                        <span className={styles.logAction}>{log.action === 'order.complete' ? '手动补单确认' : log.action}</span>
                        <span className={styles.logMeta}>
                          {log.operator} · {formatLogIp(log.ipAddress)} · {fmtTime(log.createdAt)}
                        </span>
                      </div>
                      {d.reason && <div className={styles.logReason}>原因：{d.reason}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ============ 手动确认订单 ============ */
function ConfirmOrderModal({
  order,
  onClose,
  onDone,
}: {
  order: AdminOrderRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const valid = reason.trim().length > 0 && !saving;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setError('');
    try {
      await completeAdminOrder(order.tradeNo, reason.trim());
      onDone();
    } catch (e) {
      setError(isApiError(e) ? e.message : '确认失败，请稍后重试');
      setSaving(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modalNarrow} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>手动确认订单</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.summaryBox}>
            <div className={styles.summaryLine}>
              <span className={styles.summaryLabel}>交易号：</span>
              <span className={styles.mono}>{order.tradeNo}</span>
            </div>
            <div className={styles.summaryLine}>
              <span className={styles.summaryLabel}>用户：</span>
              <span>{order.nickname ? `${order.nickname} (#${order.userId})` : `(#${order.userId})`}</span>
            </div>
            <div className={styles.summaryLine}>
              <span className={styles.summaryLabel}>金额：</span>
              <b>
                {fmtMoney(order.price)} — {fmt(order.points)} 积分
              </b>
            </div>
          </div>

          <div className={styles.warnBox}>确认后用户积分将立即到账。仅 pending 状态可确认。</div>

          <div className={styles.label}>
            确认原因 <span className={styles.required}>*</span>
          </div>
          <input
            className={styles.input}
            placeholder="请输入确认原因（必填），如：支付回调丢失、用户已付款..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && <div className={styles.formError}>{error}</div>}
        </div>
        <div className={styles.modalFoot}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={saving}>
            取消
          </button>
          <button className={styles.confirmGreen} disabled={!valid} onClick={() => void submit()}>
            {saving ? '确认中…' : '确认并到账'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
