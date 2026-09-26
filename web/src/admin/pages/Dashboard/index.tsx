/* ============================================
 * Dashboard 后台仪表盘：按区间统计的运行概览
 * 数据源 GET /api/admin/dashboard?from=&to=
 *
 * 呈现层全部走 @/admin/ui 的组件，**本页没有自己的样式文件**——
 * 指标卡用 Stat（色走 tone，不在页面里硬编码色值），占比条用 Bar，
 * 加载/失败/空态用 Empty / Alert，页面只描述结构。
 *
 * ── 口径（与后端 dashboard-range.ts 是同一套，改一处必须改另一处）────────────────
 *
 * 区间是**北京时间的自然日、含首尾**，默认今天。上界是**次日零点且不含**——
 * 半开区间，DATETIME 只到秒，用 23:59:59 当上界会漏掉那一秒里的行。
 *
 * 超过 30 天前端也拦一道：**那是体验，不是权威**。后端才是权威
 * （直接打 API 的人绕不过去），这里拦只是别让人选完才被拒。
 *
 * ── 关于「总使用积分」与「总充值积分」────────────────────────────────────────
 *
 * 两者是**两个独立的数，不是一个结余的两面**：使用是消耗（出）、充值发放是（进）。
 * 相减也不是余额——余额还要算上赠送、过期核销与冻结。所以这里不提供任何「结余」。
 * 另外充值积分按**档位原价**派生、收入金额是**实付**：折扣是让利，少收钱不少给积分。
 * ============================================ */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coins, ListChecks, TrendingUp, Users } from 'lucide-react';
import {
  DASHBOARD_MAX_RANGE_DAYS,
  adminDashboardOptions,
  beijingToday,
  validateRange,
} from '@/api/adminDashboard';
import { isApiError } from '@/api/http';
import { taskTypeLabel } from '../../taskTypeLabels';
import { Alert, Bar, Button, Card, Empty, Input, Page, PageHeader, Stat, Toolbar, type StatTone } from '../../ui';

/** 金额的展示单位是**元**，后端给的是**分**。只在这里换一次，别在回调里各除一遍。 */
const fmtYuan = (fen: number) => `¥${(fen / 100).toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const fmtCount = (n: number) => n.toLocaleString('en-US');

export default function Dashboard() {
  // 默认今天（北京时间）。**不能用 toISOString().slice(0,10)**：
  // 服务器/浏览器时区非 +08:00 时，北京时间 00:00–08:00 之间它会退回前一天
  const [draft, setDraft] = useState(() => {
    const today = beijingToday();
    return { from: today, to: today };
  });
  // 查询条件与输入框分离：否则改一个日期就发一次请求
  const [applied, setApplied] = useState(draft);

  const rangeError = validateRange(draft.from, draft.to);
  const stats = useQuery(adminDashboardOptions(applied));

  const data = stats.data;

  /** 结果指标卡。tone 只是强调、不承载语义；value 是**已经格式化好的字符串**（含单位），
   * Stat 不再加工。 */
  const cards: { label: string; value: string; tone: StatTone; icon: ReactNode }[] = data
    ? [
        {
          label: '总用户',
          value: `${fmtCount(data.totalUsers)} 人`,
          tone: 'accent',
          icon: <Users size={16} strokeWidth={2} />,
        },
        {
          label: '任务数',
          value: `${fmtCount(data.totalJobs)} 个`,
          tone: 'neutral',
          icon: <ListChecks size={16} strokeWidth={2} />,
        },
        {
          label: '总使用积分',
          // ⚠️ null = 计费服务取不到，与 0 是两件事。显示成 0 会变成一句
          //    「这段时间没人消费」的假话，而真相是我们不知道
          value: data.totalUsedCredits === null ? '—' : `${fmtCount(data.totalUsedCredits)} 分`,
          tone: 'warning',
          icon: <Coins size={16} strokeWidth={2} />,
        },
        {
          label: '总充值积分',
          value: `${fmtCount(data.totalRechargeCredits)} 分`,
          tone: 'success',
          icon: <TrendingUp size={16} strokeWidth={2} />,
        },
        {
          label: '总收入金额',
          value: fmtYuan(data.totalRevenueFen),
          tone: 'accent',
          icon: <Coins size={16} strokeWidth={2} />,
        },
      ]
    : [];

  return (
    <Page>
      <PageHeader title="仪表盘" subtitle="平台运行概览（按北京时间自然日统计）" />

      <Toolbar
        actions={
          <Button
            size="sm"
            variant="primary"
            onClick={() => setApplied(draft)}
            // 区间超限时**不让提交**：等打完接口再报错，用户得先白等一次往返，
            // 而这一条本地就能判
            disabled={rangeError !== '' || stats.isFetching}
          >
            查询
          </Button>
        }
      >
        <Input
          type="date"
          aria-label="起始日期"
          style={{ width: 160 }}
          value={draft.from}
          onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
        />
        <span style={{ color: 'var(--admin-text-muted)' }}>至</span>
        <Input
          type="date"
          aria-label="结束日期"
          style={{ width: 160 }}
          value={draft.to}
          onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
        />
        <Button size="sm" onClick={() => setDraft({ from: beijingToday(), to: beijingToday() })}>
          今天
        </Button>
      </Toolbar>

      {rangeError !== '' && (
        <Alert tone="warning" title="查询区间不合法">
          {rangeError}（最多 {DASHBOARD_MAX_RANGE_DAYS} 天）
        </Alert>
      )}

      {stats.isPending && <Empty message="加载中…" />}

      {!stats.isPending && stats.isError && (
        <Empty
          message={isApiError(stats.error) ? stats.error.message : '获取仪表盘数据失败'}
          extra={
            <Button size="sm" onClick={() => void stats.refetch()}>
              重试
            </Button>
          }
        />
      )}

      {!stats.isPending && !stats.isError && data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
            {cards.map((c) => (
              <Stat key={c.label} label={c.label} value={c.value} tone={c.tone} icon={c.icon} />
            ))}
          </div>

          {/*
            ⚠️ 计费服务取不到时<b>显式说一句</b>，而不是让「总使用积分」那张卡静静地显示破折号。
               破折号自己说明不了它是「取不到」还是「这页还没做」。
          */}
          {data.totalUsedCredits === null && (
            <Alert tone="warning" title="总使用积分取不到">
              计费服务当前不可用，该项未统计——它显示「—」不代表这段时间没有消费。
            </Alert>
          )}

          <Card title={`任务类型构成 · ${data.from} 至 ${data.to}`}>
            {data.jobTypeCounts.length === 0 ? (
              <Empty message="这段时间没有任务" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/*
                  ⚠️ 占比的分母是<b>区间内的任务总数</b>（＝上面那张「任务数」卡），
                     不是全表任务数。后端由同一份分组结果求和得出分母，所以各条占比
                     恒能加到 100%（除四舍五入的误差）。
                  ⚠️ `totalJobs` 为 0 时上面那个分支已经走空态了，
                     不会有 0/0 传进 Bar —— Bar 自己也钳 NaN 兜底。
                */}
                {data.jobTypeCounts.map((row) => (
                  <Bar
                    key={row.type}
                    label={taskTypeLabel(row.type)}
                    value={fmtCount(row.count)}
                    ratio={data.totalJobs === 0 ? 0 : row.count / data.totalJobs}
                  />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
