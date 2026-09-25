/* ============================================
 * JobRecords 任务记录：全站生成任务查询
 * 数据源 GET /api/admin/job-records（我们自己的 generation_jobs）
 *
 * 呈现层全部走 ../../ui 的组件，**本页没有自己的样式文件**。
 *
 * ⚠️ 这一页**不是账单**：任务 ≠ 消费。任务可能失败全额返还（用户净变化 0，
 *    账本里不会出现一行消费），也可能一个任务对应多次扣费。要看钱去消费记录页。
 * ============================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  adminJobRecordsOptions,
  type AdminJobRecordQuery,
} from '@/api/adminJobRecords';
import { isApiError } from '@/api/http';
import {
  Alert,
  Badge,
  Button,
  Empty,
  Input,
  Page,
  PageHeader,
  Pagination,
  Select,
  Table,
  Toolbar,
  type BadgeTone,
} from '../../ui';

const PAGE_SIZE = 20;

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

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

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

interface Filters {
  userId: string;
  projectId: string;
  type: string;
  status: string;
}

const EMPTY_FILTERS: Filters = { userId: '', projectId: '', type: 'all', status: 'all' };

export default function JobRecords() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  // 查询条件与输入框分离：否则每敲一个字符都发一次请求
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const query: AdminJobRecordQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(applied.userId ? { userId: applied.userId } : {}),
    ...(applied.projectId ? { projectId: applied.projectId } : {}),
    // 任务类型是自由文本：后端不写死白名单（类型在演进，写死会在新增类型时误伤），
    // 所以这里也是输入框而不是下拉
    ...(applied.type.trim() ? { type: applied.type.trim() } : {}),
    ...(applied.status !== 'all' ? { status: applied.status } : {}),
  };
  const list = useQuery(adminJobRecordsOptions(query));

  const apply = () => {
    setApplied(draft);
    // 换了筛选条件还停在第 3 页，看到的会是一个莫名其妙的空列表
    setPage(1);
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const rows = list.data?.list ?? [];
  const total = list.data?.total ?? 0;
  const filtered =
    applied.userId || applied.projectId || applied.type.trim() || applied.status !== 'all';

  return (
    <Page>
      <PageHeader
        title="任务记录"
        subtitle="全站生成任务的执行状态；失败原因与用户在任务详情里看到的是同一份文案"
      />

      <Toolbar
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
      >
        <Input
          style={{ width: 160 }}
          placeholder="用户 ID"
          value={draft.userId}
          onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))}
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
        <Input
          style={{ width: 160 }}
          placeholder="任务类型（如 video）"
          value={draft.type}
          onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
          }}
        />
        <Select
          aria-label="任务状态"
          options={STATUS_OPTIONS}
          value={draft.status}
          onChange={(status) => setDraft((d) => ({ ...d, status }))}
        />
      </Toolbar>

      {list.isError && (
        <Alert tone="danger">
          {isApiError(list.error) ? list.error.message : '获取任务记录失败'}
        </Alert>
      )}

      <Table>
        <thead>
          <tr>
            <th>任务 ID</th>
            <th>用户 ID</th>
            <th>项目 ID</th>
            <th>类型</th>
            <th>状态</th>
            <th>进度</th>
            <th>厂商</th>
            <th>重试</th>
            <th>创建时间</th>
            <th>更新时间</th>
            <th>失败原因</th>
          </tr>
        </thead>
        <tbody>
          {list.isPending && (
            <tr>
              <td colSpan={11}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {!list.isPending && list.isError && (
            <tr>
              <td colSpan={11}>
                <Empty
                  message="任务记录加载失败"
                  extra={
                    <Button size="sm" onClick={() => void list.refetch()}>
                      重试
                    </Button>
                  }
                />
              </td>
            </tr>
          )}
          {!list.isPending && !list.isError && rows.length === 0 && (
            <tr>
              <td colSpan={11}>
                <Empty message={filtered ? '没有匹配的任务' : '暂无任务'} />
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.job_id}>
              <td>{row.job_id}</td>
              <td>{row.user_id}</td>
              <td>{row.project_id || '—'}</td>
              <td>
                <Badge tone="neutral">{row.type}</Badge>
              </td>
              <td>
                <Badge dot tone={STATUS_TONES[row.status] ?? 'neutral'}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </Badge>
              </td>
              <td>{row.progress}%</td>
              <td>{row.provider ?? '—'}</td>
              <td>{row.retry_count}</td>
              <td>{fmtTime(row.created_at)}</td>
              <td>{fmtTime(row.updated_at)}</td>
              <td>{row.error ? row.error.message : '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        hasNext={page * PAGE_SIZE < total}
        loading={list.isFetching}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />
    </Page>
  );
}
