/* ============================================
 * RechargeRecords 充值记录：全站充值订单查询
 * 数据源 GET /api/admin/recharge-records（我们自己的 recharge_orders）
 *
 * 骨架（筛选状态机 / 三态 / 分页接线）在 `../../components/AdminQueryTable`；
 * 本页只**声明**筛选、列、空态，以及人工补发那条页面独有的横幅。
 *
 * 与 UserManage / SiteConfig 同一条纪律：页面只描述结构，样式一处定义在套件里 ——
 * **本页没有自己的样式文件**。
 * ============================================ */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import {
  adminRechargeRecordKeys,
  adminRechargeRecordsOptions,
  retryAdminRechargeGrant,
  type AdminRechargeRecord,
  type AdminRechargeRecordQuery,
  type AdminRechargeStatus,
} from '@/api/adminRechargeRecords';
import { isApiError } from '@/api/http';
import AdminQueryTable, {
  type Column,
  type OffsetPaginationState,
} from '../../components/AdminQueryTable';
import { useAppliedFilters, usePagedQuery } from '../../components/AdminQueryTable/useQueryFilters';
import { Alert, Badge, Button, Hint, Input, Select, type BadgeTone } from '../../ui';

const PAGE_SIZE = 20;

const fmt = (n: number) => n.toLocaleString('en-US');

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';

/** 单位是**分**（后端 `amount_fen` 如此），展示才换成元。 */
const fmtYuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

/**
 * 六态的中文名。顺序 = 筛选下拉里的顺序（`STATUS_OPTIONS` 由它派生），
 * 所以按「钱还没到 → 钱到了 → 出问题」排，不是按字母。
 *
 * ⚠️ 这两个状态必须**各有各的文案**：`STATUS_LABELS[row.status]` 取不到值时
 * 徽标会渲染成空白 —— 而空白的恰好是「钱收到了、积分没发出去」这种
 * 运营最需要一眼看见的单（见下方 subtitle）。
 */
const STATUS_LABELS: Record<AdminRechargeStatus, string> = {
  pending: '待支付',
  paid_pending: '支付成功待到账',
  paid: '已到账',
  expired: '已过期',
  failed: '支付失败',
  grant_failed: '到账异常',
};

const STATUS_TONES: Record<AdminRechargeStatus, BadgeTone> = {
  pending: 'warning',
  // 钱已收、积分未发：不是错误（会自愈重试），但绝不能与「待支付」同色
  paid_pending: 'accent',
  paid: 'success',
  expired: 'neutral',
  failed: 'danger',
  // 需人工介入，与「支付失败」（用户没付钱，平台没损失）区分开
  grant_failed: 'danger',
};

/**
 * 下拉选项。**空串 = 全部**（本地口径，不发给后端），其余逐字对应后端白名单 ——
 * 与另外两张记录页同一套哨兵口径，见 `useQueryFilters` 里那段说明。
 */
const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  ...(Object.keys(STATUS_LABELS) as AdminRechargeStatus[]).map((value) => ({
    value,
    label: STATUS_LABELS[value],
  })),
];

/** `type` 而不是 `interface`：见 JobRecords 里的同一条说明。 */
type Filters = {
  userId: string;
  status: string;
  tradeNo: string;
};

const EMPTY_FILTERS: Filters = { userId: '', status: '', tradeNo: '' };

/**
 * 哪些状态的单值得给「重试发放」（E-1 的那条出口）。
 *
 * ⚠️ 只有 `paid_pending` / `grant_failed`：这两种才是「**钱收到了、积分没发出去**」。
 * 给每一行都摆一个按钮是错的 —— 对 `pending`（用户还没付钱）点它等于无中生有地发积分，
 * 对 `paid`（早就到账了）点它是纯粹的噪声。**判据与后端 `retryGrantForAdmin` 的那道闸
 * 必须一致**：前端多放一个按钮，运营就会撞上一次 400。
 */
const RETRYABLE: readonly AdminRechargeStatus[] = ['paid_pending', 'grant_failed'];

/**
 * 首购加赠那一格：显示**这一单挂着多少赠送**与**实际发没发**。
 *
 * <p>⚠️ 两者缺一不可。只看额度会把「用户已经用过了」误读成「发了」；
 * 只看结果则看不出「这一单本来该有多少」。这正是本工单要修的那类事——
 * 运营配了赠送、界面上却无处确认它生没生效。
 *
 * <p>没有赠送的单显示「—」而不是「0」：「送 0 分」与「没有赠送」是两件事。
 */
function BonusCell({ row }: { row: AdminRechargeRecord }) {
  if (row.firstPurchaseEligible !== 1 || row.bonusCredits <= 0) return <>—</>;
  const amount = fmt(row.bonusCredits);
  if (row.firstPurchaseState === 'first') {
    return <Badge tone="success">+{amount} 已发</Badge>;
  }
  if (row.firstPurchaseState === 'repeat') {
    return <Badge tone="neutral">{amount} 未发 · 该档位已用过</Badge>;
  }
  // unknown：还没走到发放那一步（未支付），或撞了幂等键但拿不到归属
  return <Badge tone="warning">{amount} 未判定</Badge>;
}

export default function RechargeRecords() {
  const filters = useAppliedFilters(EMPTY_FILTERS);
  const paging = usePagedQuery(filters.epoch);
  const { applied, draft, setDraft, apply, reset } = filters;

  /**
   * 人工补发的结果横幅（成功/失败都在这一处说）。
   *
   * <p>用页面级横幅而不是 toast：补发是一次**明确的操作**，它的结果要留在屏幕上让人
   * 对照着那一行看（尤其是失败时——运营往往要连着再点一次别的单）。
   */
  const [retryNotice, setRetryNotice] = useState('');
  const [retryError, setRetryError] = useState('');

  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: (tradeNo: string) => retryAdminRechargeGrant(tradeNo),
    onSuccess: (result) => {
      setRetryError('');
      setRetryNotice(
        result.status === 'paid'
          ? `${result.tradeNo} 补发成功，积分已到账`
          // 补发**不代表**一定成：服务端回的是回读后的真实状态。说成成功就是骗人
          : `${result.tradeNo} 补发已执行，但订单仍停在「${STATUS_LABELS[result.status]}」，`
            + '需继续排查（详见服务端日志）',
      );
      void queryClient.invalidateQueries({ queryKey: adminRechargeRecordKeys.all });
    },
    onError: (error) => {
      setRetryNotice('');
      setRetryError(isApiError(error) ? error.message : '补发失败，请稍后重试');
    },
  });

  const query: AdminRechargeRecordQuery = {
    page: paging.page,
    pageSize: PAGE_SIZE,
    ...(applied.userId ? { userId: applied.userId } : {}),
    // Select 只提供上面那几个值，所以这里的收窄是安全的（不是任意字符串）
    ...(applied.status ? { status: applied.status as AdminRechargeStatus } : {}),
    ...(applied.tradeNo ? { tradeNo: applied.tradeNo } : {}),
  };
  const list = useQuery(adminRechargeRecordsOptions(query));

  const columns: Column<AdminRechargeRecord>[] = [
    { key: 'tradeNo', header: '交易单号', render: (row) => row.tradeNo },
    { key: 'userId', header: '用户 ID', render: (row) => row.userId },
    { key: 'amountFen', header: '支付金额', render: (row) => fmtYuan(row.amountFen) },
    { key: 'credits', header: '到账积分', render: (row) => fmt(row.credits) },
    {
      key: 'bonus',
      header: '赠送积分',
      render: (row) => <BonusCell row={row} />,
    },
    {
      key: 'status',
      header: '状态',
      render: (row) => (
        <Badge dot tone={STATUS_TONES[row.status]}>
          {STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    { key: 'payOrderId', header: '网关订单号', render: (row) => row.payOrderId ?? '—' },
    { key: 'createdAt', header: '创建时间', render: (row) => fmtTime(row.createdAt) },
    { key: 'paidAt', header: '支付时间', render: (row) => fmtTime(row.paidAt) },
    {
      key: 'actions',
      header: '操作',
      render: (row) => (
        // ⚠️ 这是「钱收到了、积分始终发不出去」的单**唯一**的人工出口：
        // 自动重试窗口用尽之后，没有任何别的路径会再碰它（E-1）。
        // 只对这两种状态出现 —— 别的状态点了没有意义，服务端也会拒。
        // 不做二次确认：补发是幂等的（billing 的 purchased:{tradeNo} 幂等键），
        // 点错一行不会多发积分，弹一个确认框只会让救火时多一步。
        RETRYABLE.includes(row.status) ? (
          <Button
            size="sm"
            icon={<RefreshCw size={14} strokeWidth={2} />}
            disabled={retry.isPending}
            onClick={() => retry.mutate(row.tradeNo)}
          >
            重试发放
          </Button>
        ) : null
      ),
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
          充值记录{' '}
          <Hint title="状态怎么读（6 态）">
            <div>
              <b>支付成功待到账 = 钱已经收到了，积分还没发出去。</b>
              回调先写这个状态、再发积分，发放成功才变「已到账」；发放失败的单会停在这里并自动重试，
              所以它不等于出错，但必须去看 —— 对用户来说这就是「付了钱没到账」。
            </div>
            <div>
              <b>到账异常 = 重试也没发出去，需要人工介入。</b>
              由对账任务写入，不会再自愈。这两种状态的行上有<b>「重试发放」</b>按钮 ——
              它是这笔钱**唯一**的人工出口：自动重试窗口（2 小时）用尽之后，
              再没有任何自动路径会碰它。
            </div>
            <div>
              <b>「支付失败」是另一回事</b>：用户压根没付成钱，平台没有资金在途。
            </div>
          </Hint>
          <Hint title="赠送积分怎么读">
            <div>
              档位配了「首购加赠」时，<b>该档位的第一笔成功支付</b>会额外发一批赠送积分。
              这一列显示的是<b>这一单挂着多少赠送</b>与<b>实际发没发</b>——
              只看额度会把「用户已经用过了」误读成「发了」。
            </div>
            <div>
              <b>已发</b>：本单就是该档位首单，赠送已入账。
              <b>未发 · 该档位已用过</b>：赠送已被同档位的另一笔单拿走。
              <b>未判定</b>：还没到发放那一步（未支付），或结算撞车但没拿到归属。
            </div>
            <div>
              <b>「—」= 这单没有赠送这回事</b>（档位不参与，或没配额度）。
              不写 0 —— 「送 0 分」与「没有赠送」是两件事。
            </div>
          </Hint>
        </>
      }
      subtitle="全站充值订单：到账积分在下单时冻结，落库后不随换算率变动"
      hasFilters={filters.hasApplied}
      filteredEmptyMessage="没有匹配的充值订单"
      emptyMessage="暂无充值订单"
      errorMessage="获取充值记录失败"
      tableErrorMessage="充值记录加载失败"
      notice={
        <>
          {retryNotice && <Alert tone="success">{retryNotice}</Alert>}
          {retryError && <Alert tone="danger">{retryError}</Alert>}
        </>
      }
      columns={columns}
      rows={list.data?.list ?? []}
      rowKey={(row) => row.tradeNo}
      status={list}
      pagination={pagination}
      filters={
        <>
          <Input
            style={{ width: 220 }}
            placeholder="交易单号（精确）"
            value={draft.tradeNo}
            onChange={(e) => setDraft((d) => ({ ...d, tradeNo: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
          />
          <Input
            style={{ width: 160 }}
            placeholder="用户 ID"
            value={draft.userId}
            onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply();
            }}
          />
          <Select
            aria-label="订单状态"
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
