import { useQuery } from '@tanstack/react-query';
import { Eye, Search } from 'lucide-react';
import {
  adminConsumptionRecordsOptions,
  type AdminConsumptionRecord,
  type AdminConsumptionRecordQuery,
} from '@/admin/api/adminConsumptionRecords';
import AdminQueryTable, {
  type Column,
  type OffsetPaginationState,
} from '../../components/AdminQueryTable';
import { useAppliedFilters, usePagedQuery } from '../../components/AdminQueryTable/useQueryFilters';
import { Badge, Button, Hint, Input, MetaRow, Select, Tooltip, type BadgeTone } from '../../ui';
import { taskTypeLabel } from '@/shared/enums/taskTypeLabels';

const PAGE_SIZE = 20;

const fmt = (n: number) => n.toLocaleString('en-US');

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

const AMOUNT_CELL = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--admin-space-2)',
  whiteSpace: 'nowrap',
} as const;

const SECONDARY_TEXT = {
  fontSize: 'var(--admin-font-xs)',
  color: 'var(--admin-text-muted)',
} as const;

const PROMPT_TEXT = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
} as const;

const modelText = (row: AdminConsumptionRecord) => row.model_label ?? row.model_id ?? '—';

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  done: { label: '已完成', tone: 'success' },
  refunded: { label: '已退款', tone: 'neutral' },
};

const TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'consume', label: '消费' },
  { value: 'recharge', label: '充值到账' },
  { value: 'bonus', label: '充值赠送' },
  { value: 'daily', label: '每日登录赠送' },
  { value: 'invite', label: '邀请奖励' },
  { value: 'redeem', label: '兑换码兑换' },
  { value: 'subscription', label: '会员赠送' },
  { value: 'gift', label: '运营赠送' },
  { value: 'compensation', label: '补偿 / 人工调账' },
  { value: 'expire', label: '积分过期' },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.filter((option) => option.value !== '').map((option) => [
    option.value,
    option.label,
  ]),
);

type Filters = {
  keyword: string;
  type: string;
};

const EMPTY_FILTERS: Filters = { keyword: '', type: '' };

export default function ConsumptionRecords() {
  const filters = useAppliedFilters(EMPTY_FILTERS);
  const paging = usePagedQuery(filters.epoch);
  const { applied, draft, setDraft, apply, reset } = filters;

  const query: AdminConsumptionRecordQuery = {
    pageSize: PAGE_SIZE,
    page: paging.page,
    ...(applied.keyword ? { keyword: applied.keyword } : {}),
    ...(applied.type ? { type: applied.type } : {}),
  };
  const list = useQuery(adminConsumptionRecordsOptions(query));

  const rows = list.data?.items ?? [];

  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'created_at', header: '时间', render: (row) => fmtTime(row.created_at) },
    {
      key: 'nickname',
      header: '用户名',
      render: (row) => row.nickname ?? '—',
    },
    {
      key: 'phone',
      header: '手机号',
      render: (row) => row.phone ?? '—',
    },
    {
      key: 'type',
      header: '类型',
      render: (row) => <Badge tone="neutral">{TYPE_LABELS[row.type] ?? row.type}</Badge>,
    },
    {
      key: 'task',
      header: '任务',
      render: (row) => {
        if (row.task_type == null) {
          return row.title;
        }
        const typeLabel = taskTypeLabel(row.task_type);
        return (
          <Tooltip
            label="任务明细"
            title={typeLabel}
            trigger={
              <>
                {typeLabel}
                {}
                <Eye size={15} strokeWidth={2} />
              </>
            }
            content={
              <MetaRow
                items={[
                  { label: '模型', value: modelText(row) },
                  {
                    label: '提示词',
                    value: <div style={PROMPT_TEXT}>{row.prompt ?? '—'}</div>,
                  },
                ]}
              />
            }
          />
        );
      },
    },
    {
      key: 'credits',
      header: '积分',
      render: (row) => {
        const income = row.direction === 'in';
        const zero = row.credits === 0;
        return (
          <div style={AMOUNT_CELL}>
            {}
            <Badge tone={zero ? 'neutral' : income ? 'success' : 'accent'}>
              {zero ? '' : income ? '+' : '-'}
              {fmt(row.credits)}
            </Badge>
            {}
            {row.reserved_credits != null && row.reserved_credits !== row.credits && (
              <span style={SECONDARY_TEXT}>
                扣款 {fmt(row.reserved_credits)} · 已退{' '}
                {fmt(row.reserved_credits - Math.abs(row.credits))}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: '状态',
      render: (row) => {
        const status = STATUS[row.status];
        return (
          <Badge dot tone={status?.tone ?? 'warning'}>
            {status?.label ?? '处理中'}
          </Badge>
        );
      },
    },
    {
      key: 'settled_at',
      header: '结算时间',
      render: (row) => (row.settled_at ? fmtTime(row.settled_at) : '—'),
    },
  ];

  const pagination: OffsetPaginationState = {
    kind: 'offset',
    page: paging.page,
    pageSize: PAGE_SIZE,
    total: list.data?.total ?? 0,
    prev: paging.prev,
    next: paging.next,
  };

  return (
    <AdminQueryTable
      title={
        <>
          积分记录{' '}
          <Hint title="为什么有的行「扣款」与净额不一样">
            <div>
              <b>提交任务时就直接扣一笔（提交即扣）：任务成功不再动账，失败则全额退回原批次。</b>
              所以失败的单会显示「净额 0」，旁边那一行交代它实际扣了多少、又退回了多少——净额正是两者的差。
            </div>
            <div>
              只有净额与扣款不一致的行才补这一行；发放与人工调账本来就没有扣款。
            </div>
          </Hint>
        </>
      }
      subtitle="全站积分流水（读 billing 账本，与用户端的「我的流水」同一个来源）"
      hasFilters={filters.hasApplied}
      filteredEmptyMessage="没有匹配的流水"
      emptyMessage="暂无流水"
      errorMessage="获取积分记录失败"
      tableErrorMessage="积分记录加载失败"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      status={list}
      pagination={pagination}
      filters={
        <>
          <Input
            style={{ width: 220 }}
            placeholder="用户 ID / 手机号 / 用户名（需完整，留空 = 全站）"
            value={draft.keyword}
            onChange={(e) => setDraft((d) => ({ ...d, keyword: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
          />
          <Select
            aria-label="流水类型"
            options={TYPE_OPTIONS}
            value={draft.type}
            onChange={(type) => setDraft((d) => ({ ...d, type }))}
          />
        </>
      }
      actions={
        <>
          <Button size="sm" onClick={reset} disabled={list.isFetching}>
            重置
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Search size={15} strokeWidth={2} />}
            onClick={apply}
            disabled={list.isFetching}
          >
            查询
          </Button>
        </>
      }
    />
  );
}
