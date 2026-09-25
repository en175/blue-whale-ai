/* ============================================
 * ConsumptionRecords 消费记录：全站积分流水（读 billing 账本）
 * 数据源 GET /api/admin/consumption-records（BFF → billing 的 /admin/transactions）
 *
 * 呈现层全部走 ../../ui 的组件，**本页没有自己的样式文件**。
 *
 * ⚠️ 这一页与另外两张记录页的分页形状不同：billing 的账本是**游标分页、没有总数**
 *    （账本持续追加，要准确总数就得扫全表，而扫完那一刻它又变了）。所以：
 *    · 翻页状态由**游标栈**维护（`tokens`），而不是一个页码数字
 *    · 不传 `total` 给 Pagination —— 界面不会显示「共 N 条」，因为没有这个数
 *    · 翻页控件仍是同一个组件，观感与 offset 那两页一致
 * ============================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  adminConsumptionRecordsOptions,
  type AdminConsumptionRecordQuery,
} from '@/api/adminConsumptionRecords';
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
} from '../../ui';

const PAGE_SIZE = 20;

const fmt = (n: number) => n.toLocaleString('en-US');

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

/** 契约里的流水类型（billing 的 TransactionType）。空 = 全部 */
const TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'consume', label: '消费' },
  { value: 'recharge', label: '充值到账' },
  { value: 'bonus', label: '充值赠送' },
  { value: 'daily', label: '每日登录赠送' },
  { value: 'invite', label: '邀请奖励' },
  { value: 'redeem', label: '兑换码兑换' },
  { value: 'subscription', label: '会员赠送' },
  { value: 'gift', label: '运营赠送' },
  { value: 'compensation', label: '补偿 / 人工调账' },
  { value: 'refund', label: '退款' },
  { value: 'expire', label: '积分过期' },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.filter((o) => o.value !== 'all').map((o) => [o.value, o.label]),
);

interface Filters {
  userId: string;
  type: string;
}

const EMPTY_FILTERS: Filters = { userId: '', type: 'all' };

export default function ConsumptionRecords() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  // 查询条件与输入框分离：否则每敲一个字符都发一次请求
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  // 游标栈：`tokens[i]` 是第 i+1 页的入参游标。栈深就是当前页码——
  // 「上一页」需要**当初那一页的游标**，而游标是从后往前不可逆的，所以只能自己存。
  const [tokens, setTokens] = useState<string[]>(['']);

  const page = tokens.length;
  const pageToken = tokens[tokens.length - 1] ?? '';

  const query: AdminConsumptionRecordQuery = {
    pageSize: PAGE_SIZE,
    pageToken,
    ...(applied.userId ? { userId: applied.userId } : {}),
    ...(applied.type !== 'all' ? { type: applied.type } : {}),
  };
  const list = useQuery(adminConsumptionRecordsOptions(query));

  const rows = list.data?.items ?? [];
  const nextToken = list.data?.next_page_token ?? '';

  const apply = () => {
    setApplied(draft);
    // 换了筛选条件还停在原来的游标上，翻出来的页与看到的条件对不上
    setTokens(['']);
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setTokens(['']);
  };

  return (
    <Page>
      <PageHeader
        title="消费记录"
        subtitle="全站积分流水（读 billing 账本，与用户端的「我的流水」同一个来源）"
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
          style={{ width: 180 }}
          placeholder="用户 ID（留空 = 全站）"
          value={draft.userId}
          onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))}
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
      </Toolbar>

      {list.isError && (
        <Alert tone="danger">
          {isApiError(list.error) ? list.error.message : '获取消费记录失败'}
        </Alert>
      )}

      <Table>
        <thead>
          <tr>
            <th>时间</th>
            <th>用户 ID</th>
            <th>类型</th>
            <th>说明</th>
            <th>积分</th>
            <th>状态</th>
            <th>结算时间</th>
          </tr>
        </thead>
        <tbody>
          {list.isPending && (
            <tr>
              <td colSpan={7}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {!list.isPending && list.isError && (
            <tr>
              <td colSpan={7}>
                <Empty
                  message="消费记录加载失败"
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
              <td colSpan={7}>
                <Empty
                  message={
                    applied.userId || applied.type !== 'all'
                      ? '没有匹配的流水'
                      : '暂无流水'
                  }
                />
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const income = row.direction === 'in';
            return (
              <tr key={row.id}>
                <td>{fmtTime(row.created_at)}</td>
                <td>{row.user_id}</td>
                <td>
                  <Badge tone="neutral">{TYPE_LABELS[row.type] ?? row.type}</Badge>
                </td>
                <td>{row.title}</td>
                <td>
                  {/* 金额恒正，正负由 direction 表达 —— 与账本口径一致 */}
                  <Badge tone={income ? 'success' : 'accent'}>
                    {income ? `+${fmt(row.credits)}` : `-${fmt(row.credits)}`}
                  </Badge>
                </td>
                <td>
                  {/* pending 的金额是**预计消耗**，结算后同一行变成实际消耗 */}
                  <Badge dot tone={row.status === 'done' ? 'success' : 'warning'}>
                    {row.status === 'done' ? '已完成' : '处理中'}
                  </Badge>
                </td>
                <td>{row.settled_at ? fmtTime(row.settled_at) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        // 不传 total：账本给不出总数，编一个出来比不显示更糟
        hasNext={nextToken !== ''}
        loading={list.isFetching}
        onPrev={() => setTokens((t) => (t.length > 1 ? t.slice(0, -1) : t))}
        onNext={() => {
          if (nextToken) setTokens((t) => [...t, nextToken]);
        }}
      />
    </Page>
  );
}
