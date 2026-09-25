/* ============================================
 * OrderManage 订单管理：查看充值订单、支付链路、手动确认与导出
 * 数据源 GET /api/admin/orders + POST /:tradeNo/complete + GET /api/admin/operation-logs
 *
 * 呈现层全部走 @/admin/ui 的组件，**本页没有自己的样式文件**——
 * 状态色走 Badge 的 tone、加载/失败/空态走 Empty、提示走 Alert，
 * 页面只描述结构，样式一处定义在套件里。
 * ============================================ */
import type { ReactNode } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Download, CheckCircle2, Check } from 'lucide-react';
import {
  fetchAdminOrders,
  completeAdminOrder,
  fetchOperationLogs,
  type AdminOrderRow,
  type OperationLog,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import { formatLogIp } from '@/admin/formatLogIp';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Table,
  Toolbar,
  type BadgeTone,
} from '../../ui';

/** 订单状态 */
type OrderStatus = 'pending' | 'success' | 'expired' | 'failed';

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '待支付',
  success: '已到账',
  expired: '已过期',
  failed: '支付失败',
};

/** 状态 → Badge 色调（模板字符串索引无法通过类型检查，故用显式映射） */
const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending: 'accent',
  success: 'success',
  expired: 'neutral',
  failed: 'danger',
};

/** 列表筛选下拉选项 */
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待支付' },
  { value: 'success', label: '已到账' },
  { value: 'expired', label: '已过期' },
  { value: 'failed', label: '支付失败' },
];

const METHOD_OPTIONS = [
  { value: 'all', label: '全部方式' },
  { value: 'wechat', label: '微信支付' },
  { value: 'alipay', label: '支付宝' },
];

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

/** 步骤状态 → Badge 色调：已完成绿、失败红、等待中性 */
const STEP_TONE: Record<StepState, BadgeTone> = {
  done: 'success',
  wait: 'neutral',
  fail: 'danger',
};

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
    <Page>
      <PageHeader
        title="订单管理"
        subtitle="查看充值订单、支付链路、手动确认与导出"
        extra={
          <Button icon={<Download size={16} strokeWidth={2} />} onClick={exportExcel}>
            导出 Excel
          </Button>
        }
      />

      {/* 筛选行 + 日期区间；待处理计数放右对齐区 */}
      <Card>
        <Toolbar actions={<span>{pendingCount} 笔待处理</span>}>
          <Input
            style={{ flex: 1, minWidth: 240 }}
            placeholder="搜索用户/手机号/交易号..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            aria-label="状态筛选"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={setStatusFilter}
          />
          <Select
            aria-label="支付方式筛选"
            options={METHOD_OPTIONS}
            value={methodFilter}
            onChange={setMethodFilter}
          />
          <Input
            type="date"
            aria-label="开始日期"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span>—</span>
          <Input
            type="date"
            aria-label="结束日期"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Toolbar>
      </Card>

      {/* 订单表格 */}
      <Table>
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
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={9}>
                <Empty message="加载中…" />
              </td>
            </tr>
          ) : loadError ? (
            <tr>
              <td colSpan={9}>
                <Empty
                  message={loadError}
                  extra={<Button onClick={() => void loadOrders()}>重试</Button>}
                />
              </td>
            </tr>
          ) : filtered.length === 0 ? (
            <tr>
              <td colSpan={9}>
                <Empty message="暂无订单" />
              </td>
            </tr>
          ) : (
            filtered.map((o) => (
              <tr key={o.tradeNo}>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="查看订单详情"
                    onClick={() => setDetailNo(o.tradeNo)}
                  >
                    {o.tradeNo}
                  </Button>
                </td>
                <td>{o.nickname || `(#${o.userId})`}</td>
                <td>{o.tierName}</td>
                <td>{fmtMoney(o.price)}</td>
                <td>{fmt(o.points)}</td>
                <td>{methodLabel(o.paymentMethod)}</td>
                <td>
                  <Badge tone={STATUS_TONE[o.status]} dot>
                    {STATUS_LABEL[o.status]}
                  </Badge>
                </td>
                <td>{fmtTime(o.createdAt)}</td>
                <td>
                  {o.status === 'pending' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="手动确认"
                      aria-label={`手动确认订单 ${o.tradeNo}`}
                      icon={<CheckCircle2 size={16} strokeWidth={2} />}
                      onClick={() => setConfirmNo(o.tradeNo)}
                    />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

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
    </Page>
  );
}

/* ============ 详情字段：标签在上、值在下 ============ */
function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div>
        <small>{label}</small>
      </div>
      <div>{children}</div>
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

  return (
    <Modal open title="订单详情·支付全链路" onClose={onClose} width={760}>
      {/* 链路步骤：已完成的步骤带勾，状态同时由色调与符号表达（不只靠颜色） */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}
      >
        {STEP_LABELS.map((label, i) => (
          <Fragment key={label}>
            {i > 0 && <span aria-hidden="true">→</span>}
            <Badge tone={STEP_TONE[steps[i]]} dot>
              {steps[i] === 'done' && <Check size={12} strokeWidth={3} />}
              {label}
            </Badge>
          </Fragment>
        ))}
      </div>

      {/* 信息网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
        <InfoItem label="交易号">{order.tradeNo}</InfoItem>
        <InfoItem label="状态">
          <Badge tone={STATUS_TONE[order.status]} dot>
            {STATUS_LABEL[order.status]}
          </Badge>
        </InfoItem>
        <InfoItem label="用户">
          {order.nickname ? `${order.nickname} (#${order.userId})` : `(#${order.userId})`}
        </InfoItem>
        <InfoItem label="手机号">{order.phone || '—'}</InfoItem>
        <InfoItem label="档位">{order.tierName}</InfoItem>
        <InfoItem label="金额">{fmtMoney(order.price)}</InfoItem>
        <InfoItem label="购买积分">{fmt(order.points)}</InfoItem>
        <InfoItem label="赠送积分">+{fmt(order.bonus)}</InfoItem>
        <InfoItem label="支付方式">{methodLabel(order.paymentMethod)}</InfoItem>
        <InfoItem label="支付平台流水号">{order.platformRefNo || '—'}</InfoItem>
        <InfoItem label="IP">{order.ip || '—'}</InfoItem>
        <InfoItem label="创建时间">{fmtTime(order.createdAt)}</InfoItem>
        <InfoItem label="支付时间">{fmtTime(order.paidAt)}</InfoItem>
        <InfoItem label="到账时间">{fmtTime(order.arrivedAt)}</InfoItem>
      </div>

      {/* 操作日志（补单记录） */}
      <div style={{ marginTop: 24 }}>
        <h3>操作日志</h3>
        {logsLoading ? (
          <Empty message="加载中…" />
        ) : logsError ? (
          <Empty message={logsError} />
        ) : logs.length === 0 ? (
          <Empty message="暂无操作记录" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {logs.map((log) => {
              const d = parseDetail(log.detail);
              return (
                <Card key={log.id}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <span>
                      {log.action === 'order.complete' ? '手动补单确认' : log.action}
                    </span>
                    <small>
                      {log.operator} · {formatLogIp(log.ipAddress)} · {fmtTime(log.createdAt)}
                    </small>
                  </div>
                  {d.reason && <div style={{ marginTop: 6 }}>原因：{d.reason}</div>}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
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

  return (
    <Modal
      open
      title="手动确认订单"
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => void submit()}>
            {saving ? '确认中…' : '确认并到账'}
          </Button>
        </>
      }
    >
      <Card>
        <div>
          交易号：<b>{order.tradeNo}</b>
        </div>
        <div>
          用户：
          <b>{order.nickname ? `${order.nickname} (#${order.userId})` : `(#${order.userId})`}</b>
        </div>
        <div>
          金额：
          <b>
            {fmtMoney(order.price)} — {fmt(order.points)} 积分
          </b>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <Alert tone="warning">确认后用户积分将立即到账。仅 pending 状态可确认。</Alert>
      </div>

      <div style={{ marginTop: 16 }}>确认原因 *</div>
      <Input
        style={{ width: '100%', marginTop: 6 }}
        placeholder="请输入确认原因（必填），如：支付回调丢失、用户已付款..."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}
