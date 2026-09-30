/* ============================================
 * JobRecords 任务记录：全站生成任务查询
 * 数据源 GET /api/admin/job-records（我们自己的 generation_jobs）
 *
 * 骨架（筛选状态机 / 三态 / 分页接线）在 `../../components/AdminQueryTable`；
 * 本页只**声明**筛选长什么样、有哪些列、空态说什么。
 *
 * ⚠️ 这一页**不是账单**：任务 ≠ 消费。任务可能失败全额返还（用户净变化 0，
 *    账本里不会出现一行消费），也可能一个任务对应多次扣费。要看钱去积分记录页。
 * ============================================ */
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  adminJobRecordsOptions,
  type AdminJobRecord,
  type AdminJobRecordQuery,
} from '@/api/adminJobRecords';
import { TASK_TYPE_OPTIONS } from '../../taskTypeLabels';
import AdminQueryTable, {
  type Column,
  type OffsetPaginationState,
} from '../../components/AdminQueryTable';
import { useAppliedFilters, usePagedQuery } from '../../components/AdminQueryTable/useQueryFilters';
import { Badge, Button, Input, Select, type BadgeTone } from '../../ui';

const PAGE_SIZE = 20;

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

/**
 * 模型列的显示文本。
 *
 * ⚠️ 口径是「**有展示名用展示名，没有就原样显示 model_id，都没有才是「—」**」：
 *    - 展示名（中文）维护在 `generation_model_capability.model_label`，只认它，不在这里拼名字
 *      （拼出来的名字与模型列表页对不上，运营会以为是两个模型）；
 *    - 查不到展示名的（模型下架了、只在定价目录里配过价）显示内部 id —— 它至少能拿去搜、
 *      去对配置，比一个「未知模型」有用；
 *    - 没有模型的任务（免费工具族的抠图、混音一类）显示「—」，**不是空串、更不是 undefined**。
 */
const modelText = (row: AdminJobRecord) => row.model_label ?? row.model_id ?? '—';

/** 任务状态全集（对齐 web/src/api/jobs.ts 的 JobStatus，另加扇出任务的 partially_succeeded）。 */
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

/**
 * 任务类型选项（含「全部」）——来自 `../../taskTypeLabels`，**全管理端只有那一份**。
 *
 * ⚠️ 它原先长在本文件里，仪表盘也要同一套名字，于是移到了共用模块：
 *    两份的漂移是必然的（加了新类型只改下拉、没改占比条，同一个类型会出现两个名字）。
 *    新增任务类型时改 `../../taskTypeLabels`，并同步 `web/src/api/jobs.ts` 的 `JobType`。
 */
const TYPE_OPTIONS = TASK_TYPE_OPTIONS;

/**
 * 筛选条件的形状。
 *
 * <p>⚠️ 用 `type` 而不是 `interface`：TS 只给对象**类型别名**隐式索引签名，
 * 而 `useAppliedFilters` 的约束是 `Record<string, string>`（它要靠 `Object.values` 判空）。
 */
type Filters = {
  keyword: string;
  projectId: string;
  type: string;
  status: string;
};

/**
 * 空筛选条件。
 *
 * <p>⚠️ 「全部」一律由**空串**表达（两个下拉的第一项 `value` 都是 `''`），**没有哨兵值**。
 * 这里曾经是 `status: 'all'`，而查询侧的判据是 `applied.type.trim()` 那种「非空即带上」——
 * `'all'` 是真值，于是每次查询都实打实带上 `status=all`，列表被过滤成空。
 * 现在判据与哨兵口径同源（见下面的 `hasFilters` 与查询对象），这类分歧不可能再只出现一半。
 */
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
    // 任务类型是自由文本：**后端**不写死白名单（类型在演进，写死会在新增类型时误伤），
    // 查不到就是空列表。这里给下拉只是「让运营好选」，它**不是**白名单——
    // 传下去的就是选项的原值，中间没有校验。库里出现表里没收录的类型时选不到它，
    // 那属于前端漏收录（补 `../../taskTypeLabels`），不是这条筛选坏了
    ...(applied.type.trim() ? { type: applied.type.trim() } : {}),
    ...(applied.status ? { status: applied.status } : {}),
  };
  const list = useQuery(adminJobRecordsOptions(query));

  const columns: Column<AdminJobRecord>[] = [
    { key: 'job_id', header: '任务 ID', render: (row) => row.job_id },
    {
      key: 'nickname',
      header: '用户名',
      // 用户名 / 手机号来自**我们自己库**的 `bw_users`：`generation_jobs` 里只有 user_id，
      // 认不出人。BFF 拿这一页的 user_id 批量查一次补回来。
      //
      // ⚠️ 判空 `?? '—'`，不是真值判断：后端把「查不到用户」与「用户没有手机号」都收敛成 `null`。
      render: (row) => row.nickname ?? '—',
    },
    {
      key: 'phone',
      header: '手机号',
      // 存量用户没手机号是**常态**（`bw_users.phone` 可空），不是加载没完成
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
            // 「需完整」四个字不能省：用户管理页那个框是**模糊**匹配，这个框是**精确**匹配。
            // 同一句 placeholder 放两页、行为不同，运营会照着上一页的习惯输入半截。
            placeholder="用户 ID / 手机号 / 用户名（需完整）"
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
