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

const fmtYuan = (fen: number) => `¥${(fen / 100).toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const fmtCount = (n: number) => n.toLocaleString('en-US');

export default function Dashboard() {
  const [draft, setDraft] = useState(() => {
    const today = beijingToday();
    return { from: today, to: today };
  });
  const [applied, setApplied] = useState(draft);

  const rangeError = validateRange(draft.from, draft.to);
  const stats = useQuery(adminDashboardOptions(applied));

  const data = stats.data;

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

          {}
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
                {}
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
