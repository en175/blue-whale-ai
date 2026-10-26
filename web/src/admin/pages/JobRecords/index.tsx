import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  adminJobRecordsOptions,
  type AdminJobRecord,
  type AdminJobRecordQuery,
} from '@/admin/api/adminJobRecords';
import { TASK_TYPE_OPTIONS } from '@/shared/enums/taskTypeLabels';
import AdminQueryTable, {
  type Column,
  type OffsetPaginationState,
} from '../../components/AdminQueryTable';
import { useAppliedFilters, usePagedQuery } from '../../components/AdminQueryTable/useQueryFilters';
import { Badge, Button, Input, Select, type BadgeTone } from '../../ui';

const PAGE_SIZE = 20;

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

const modelText = (row: AdminJobRecord) => row.model_label ?? row.model_id ?? '—';

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  processing: '执行中',
  succeeded: '成功',
  partially_succeeded: '部分成功',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_TONES: Record<string, BadgeTone> = {
  queued: 'neutral',
  processing: 'accent',
  succeeded: 'success',
  partially_succeeded: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
};

const TYPE_OPTIONS = TASK_TYPE_OPTIONS;

type Filters = {
  keyword: string;
  projectId: string;
  type: string;
  status: string;
};

const EMPTY_FILTERS: Filters = { keyword: '', projectId: '', type: '', status: '' };

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

export default function JobRecords() {
  const filters = useAppliedFilters(EMPTY_FILTERS);
  const paging = usePagedQuery(filters.epoch);
  const { applied, draft, setDraft, apply, reset } = filters;

  const query: AdminJobRecordQuery = {
    page: paging.page,
    pageSize: PAGE_SIZE,
    ...(applied.keyword ? { keyword: applied.keyword } : {}),
    ...(applied.projectId ? { projectId: applied.projectId } : {}),
    ...(applied.type.trim() ? { type: applied.type.trim() } : {}),
    ...(applied.status ? { status: applied.status } : {}),
  };
  const list = useQuery(adminJobRecordsOptions(query));

  const columns: Column<AdminJobRecord>[] = [
    { key: 'job_id', header: '任务 ID', render: (row) => row.job_id },
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
    { key: 'project_id', header: '项目 ID', render: (row) => row.project_id || '—' },
    {
      key: 'type',
      header: '类型',
      render: (row) => <Badge tone="neutral">{row.type}</Badge>,
    },
    { key: 'model', header: '模型', render: modelText },
    {
      key: 'status',
      header: '状态',
      render: (row) => (
        <Badge dot tone={STATUS_TONES[row.status] ?? 'neutral'}>
          {STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
    { key: 'progress', header: '进度', render: (row) => `${row.progress}%` },
    { key: 'retry_count', header: '重试', render: (row) => row.retry_count },
    { key: 'created_at', header: '创建时间', render: (row) => fmtTime(row.created_at) },
    { key: 'updated_at', header: '更新时间', render: (row) => fmtTime(row.updated_at) },
    { key: 'error', header: '失败原因', render: (row) => (row.error ? row.error.message : '—') },
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
      title="任务记录"
      subtitle="全站生成任务的执行状态；失败原因与用户在任务详情里看到的是同一份文案"
      hasFilters={filters.hasApplied}
      filteredEmptyMessage="没有匹配的任务"
      emptyMessage="暂无任务"
      errorMessage="获取任务记录失败"
      tableErrorMessage="任务记录加载失败"
      columns={columns}
      rows={list.data?.list ?? []}
      rowKey={(row) => row.job_id}
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
          <Input
            style={{ width: 160 }}
            placeholder="项目 ID"
            value={draft.projectId}
            onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
          />
          <Select
            aria-label="任务类型"
            options={TYPE_OPTIONS}
            value={draft.type}
            onChange={(type) => setDraft((d) => ({ ...d, type }))}
          />
          <Select
            aria-label="任务状态"
            options={STATUS_OPTIONS}
            value={draft.status}
            onChange={(status) => setDraft((d) => ({ ...d, status }))}
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
