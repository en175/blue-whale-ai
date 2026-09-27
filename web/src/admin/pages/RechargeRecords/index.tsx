/* ============================================
 * RechargeRecords 充值记录：全站充值订单查询
 * 数据源 GET /api/admin/recharge-records（我们自己的 recharge_orders）
 *
 * 呈现层全部走 ../../ui 的组件，**本页没有自己的样式文件**——
 * 与 UserManage / SiteConfig 同一条纪律：页面只描述结构，样式一处定义在套件里。
 * ============================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  adminRechargeRecordsOptions,
  type AdminRechargeRecordQuery,
  type AdminRechargeStatus,
} from '@/api/adminRechargeRecords';
import { isApiError } from '@/api/http';
import {
  Alert,
  Badge,
  Button,
  Empty,
  Hint,
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

/** 下拉选项：`all` 是本地哨兵（不发给后端），其余逐字对应后端白名单 */
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  ...(Object.keys(STATUS_LABELS) as AdminRechargeStatus[]).map((value) => ({
    value,
    label: STATUS_LABELS[value],
  })),
];

interface Filters {
  userId: string;
  status: string;
  tradeNo: string;
}

const EMPTY_FILTERS: Filters = { userId: '', status: 'all', tradeNo: '' };

export default function RechargeRecords() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  // 查询条件与输入框分离：否则每敲一个字符都发一次请求
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const query: AdminRechargeRecordQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(applied.userId ? { userId: applied.userId } : {}),
    // Select 只提供上面那几个值，所以这里的收窄是安全的（不是任意字符串）
    ...(applied.status !== 'all' ? { status: applied.status as AdminRechargeStatus } : {}),
    ...(applied.tradeNo ? { tradeNo: applied.tradeNo } : {}),
  };
  const list = useQuery(adminRechargeRecordsOptions(query));

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

  return (
    <Page>
      <PageHeader
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
                由对账任务写入，不会再自愈。
              </div>
              <div>
                <b>「支付失败」是另一回事</b>：用户压根没付成钱，平台没有资金在途。
              </div>
            </Hint>
          </>
        }
        subtitle="全站充值订单：到账积分在下单时冻结，落库后不随换算率变动"
      />

      {/* 筛选栏：条件提交后才生效（回车或点「查询」） */}
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
      </Toolbar>

      {list.isError && (
        <Alert tone="danger">
          {isApiError(list.error) ? list.error.message : '获取充值记录失败'}
        </Alert>
      )}

      <Table>
        <thead>
          <tr>
            <th>交易单号</th>
            <th>用户 ID</th>
            <th>支付金额</th>
            <th>到账积分</th>
            <th>状态</th>
            <th>网关订单号</th>
            <th>创建时间</th>
            <th>支付时间</th>
          </tr>
        </thead>
        <tbody>
          {list.isPending && (
            <tr>
              <td colSpan={8}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {!list.isPending && list.isError && (
            <tr>
              <td colSpan={8}>
                <Empty
                  message="充值记录加载失败"
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
              <td colSpan={8}>
                <Empty
                  message={
                    applied.userId || applied.tradeNo || applied.status !== 'all'
                      ? '没有匹配的充值订单'
                      : '暂无充值订单'
                  }
                />
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.tradeNo}>
              <td>{row.tradeNo}</td>
              <td>{row.userId}</td>
              <td>{fmtYuan(row.amountFen)}</td>
              <td>{fmt(row.credits)}</td>
              <td>
                <Badge dot tone={STATUS_TONES[row.status]}>
                  {STATUS_LABELS[row.status]}
                </Badge>
              </td>
              <td>{row.payOrderId ?? '—'}</td>
              <td>{fmtTime(row.createdAt)}</td>
              <td>{fmtTime(row.paidAt)}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        // 本地表能算总数，下一页由它推出；与消费记录页显式给 hasNext 是同一个组件
        hasNext={page * PAGE_SIZE < total}
        loading={list.isFetching}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />
    </Page>
  );
}
