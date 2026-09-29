/* ============================================
 * ConsumptionRecords 消费记录：全站积分流水（读 billing 账本）
 * 数据源 GET /api/admin/consumption-records（BFF → billing 的 /admin/transactions）
 *
 * 骨架（筛选状态机 / 三态 / 分页接线）在 `../../components/AdminQueryTable`；
 * 本页只**声明**筛选、列与空态。
 *
 * ⚠️ 这一页与另外两张记录页的分页形状不同：billing 的账本是**游标分页、没有总数**
 *    （账本持续追加，要准确总数就得扫全表，而扫完那一刻它又变了）。所以：
 *    · 翻页状态由**游标栈**维护（`useCursorStack`），而不是一个页码数字
 *    · 不传 `total` 给 Pagination —— 界面不会显示「共 N 条」，因为没有这个数
 *    · 翻页控件仍是同一个组件，观感与 offset 那两页一致
 *
 * ⚠️ **预扣额**（§「积分」列）：消费行在 billing 侧就是一条预留，预扣额与结算额都在
 *    同一行上。结算后 `credits` 已换成实际值，预扣额若不显示，用户余额「先降后回」
 *    就没有任何一处交代得了（冻 12、实扣 1 的行只会看到 -1）。
 *    所以这一列**只在两个数不一致时**补一行「预扣 N」——理由见下面的渲染注释。
 * ============================================ */
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  adminConsumptionRecordsOptions,
  type AdminConsumptionRecordQuery,
} from '@/api/adminConsumptionRecords';
import AdminQueryTable, {
  type Column,
  type CursorPaginationState,
} from '../../components/AdminQueryTable';
import { useAppliedFilters, useCursorStack } from '../../components/AdminQueryTable/useQueryFilters';
import { Badge, Button, Hint, Input, Select } from '../../ui';

const PAGE_SIZE = 20;

const fmt = (n: number) => n.toLocaleString('en-US');

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

/**
 * 金额格：金额徽标与预扣额**并排一行，不换行**。
 *
 * <p>为什么并排而不是另起一行：预扣是**同一个数的另一半解释**（冻了 N、实扣 M）。
 * 拆成上下两行后，视觉上像是两条独立信息，读的时候还要把它们重新对起来；
 * 并排 + nowrap 让这一格始终是「一个金额 + 一句注解」。
 *
 * <p>列宽交给表格自适应：内容变宽时这一列变宽，而不是把字挤成两行。
 */
const AMOUNT_CELL = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--admin-space-2)',
  whiteSpace: 'nowrap',
} as const;

/** 次要文本（预扣额）。字号与颜色取 token，与 Promotions 的「万分比」同一形态。 */
const SECONDARY_TEXT = {
  fontSize: 'var(--admin-font-xs)',
  color: 'var(--admin-text-muted)',
} as const;

/**
 * 契约里的流水类型（billing 的 TransactionType）。**空串 = 全部** —— 与另外两张记录页
 * 同一套口径（`useQueryFilters` 里写了为什么不用 `'all'` 哨兵）。
 */
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
  { value: 'refund', label: '退款' },
  { value: 'expire', label: '积分过期' },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.filter((option) => option.value !== '').map((option) => [
    option.value,
    option.label,
  ]),
);

/** `type` 用 `type` 而不是 `interface`：见 JobRecords 里的同一条说明。 */
type Filters = {
  userId: string;
  type: string;
};

const EMPTY_FILTERS: Filters = { userId: '', type: '' };

export default function ConsumptionRecords() {
  const filters = useAppliedFilters(EMPTY_FILTERS);
  const cursor = useCursorStack(filters.epoch);
  const { applied, draft, setDraft, apply, reset } = filters;

  const query: AdminConsumptionRecordQuery = {
    pageSize: PAGE_SIZE,
    pageToken: cursor.pageToken,
    ...(applied.userId ? { userId: applied.userId } : {}),
    ...(applied.type ? { type: applied.type } : {}),
  };
  const list = useQuery(adminConsumptionRecordsOptions(query));

  const rows = list.data?.items ?? [];
  const nextToken = list.data?.next_page_token ?? '';

  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'created_at', header: '时间', render: (row) => fmtTime(row.created_at) },
    { key: 'user_id', header: '用户 ID', render: (row) => row.user_id },
    {
      key: 'type',
      header: '类型',
      render: (row) => <Badge tone="neutral">{TYPE_LABELS[row.type] ?? row.type}</Badge>,
    },
    { key: 'title', header: '说明', render: (row) => row.title },
    {
      key: 'credits',
      header: '积分',
      render: (row) => {
        const income = row.direction === 'in';
        return (
          <div style={AMOUNT_CELL}>
            {/* 金额恒正，正负由 direction 表达 —— 与账本口径一致 */}
            <Badge tone={income ? 'success' : 'accent'}>
              {income ? `+${fmt(row.credits)}` : `-${fmt(row.credits)}`}
            </Badge>
            {/* 预扣额：**只在两个数不一致时**才补这一句。
                三个理由，缺一个都会让它变成噪音：
                · 未结算行的 credits 本就是预扣额，再写一遍是同一句话说两次；
                · 发放 / 人工调账行没有预扣（null），什么都不该出；
                · 一致时（冻 5 扣 5）写出来也只是复读。
                于是它只在「余额先降后回」的行上出现 —— 一出现就说明有事发生。
                ⚠️ 判空只能写 `!= null`（**不能**写 `!== null`）：缺值有两种形态，
                   `null` 是后端按契约回的，**键不存在**是后端版本比前端旧时的形态
                   （老构建压根没投影这一列）。漏掉后者，`undefined` 会被当成
                   「有值」进来渲染，`fmt` 一碰就 `toLocaleString` of undefined ——
                   整页白屏（2026-09-26 实测，见 adminConsumptionRecords.ts 的类型注释）。
                也**不能**用真值判断：0 是「全额退回」，那恰恰是最该显示预扣的一行。 */}
            {row.reserved_credits != null && row.reserved_credits !== row.credits && (
              <span style={SECONDARY_TEXT}>预扣 {fmt(row.reserved_credits)}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: '状态',
      render: (row) => (
        // pending 的金额是**预计消耗**，结算后同一行变成实际消耗
        <Badge dot tone={row.status === 'done' ? 'success' : 'warning'}>
          {row.status === 'done' ? '已完成' : '处理中'}
        </Badge>
      ),
    },
    {
      key: 'settled_at',
      header: '结算时间',
      render: (row) => (row.settled_at ? fmtTime(row.settled_at) : '—'),
    },
  ];

  const pagination: CursorPaginationState = {
    kind: 'cursor',
    page: cursor.page,
    pageSize: PAGE_SIZE,
    // 由服务端给的下一个游标回答；从 total 推会让下一页永远灰着（这里压根没有 total）
    hasNext: nextToken !== '',
    prev: cursor.prev,
    next: () => cursor.next(nextToken),
  };

  return (
    <AdminQueryTable
      title={
        <>
          消费记录{' '}
          <Hint title="为什么有的行写着「预扣」">
            {/* ⚠️ 每个 div 的文字写成**一整行**：JSX 把源码里的换行折成一个空格，
                中文句子中途换行会在面板里留下一个「预扣额， 发放」那样的空档。 */}
            <div>
              <b>提交任务时先按预计用量冻结，结算时按实际用量扣费，差额自动退回余额。</b>
              所以余额会先降后回。这一页记的是<b>结算后</b>的账：一行「-1」旁边若不补出「预扣 12」，那 12 冻过、11 退回来这件事就没有任何一处交代得了。
            </div>
            <div>
              只有两个数不一致的行才补这一行；处理中的行显示的金额本身就是预扣额，发放与人工调账没有预扣。
            </div>
          </Hint>
        </>
      }
      subtitle="全站积分流水（读 billing 账本，与用户端的「我的流水」同一个来源）"
      hasFilters={filters.hasApplied}
      filteredEmptyMessage="没有匹配的流水"
      emptyMessage="暂无流水"
      errorMessage="获取消费记录失败"
      tableErrorMessage="消费记录加载失败"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      status={list}
      pagination={pagination}
      filters={
        <>
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
