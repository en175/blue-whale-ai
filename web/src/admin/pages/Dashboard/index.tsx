/* ============================================
 * Dashboard 后台仪表盘：运行概览统计与最近充值/消费
 * 数据源 GET /api/admin/dashboard
 *
 * 呈现层全部走 @/admin/ui 的组件，**本页没有自己的样式文件**——
 * 统计卡用 Stat（色走 tone，不在页面里硬编码色值），面板用 Card，
 * 加载/失败/空态用 Empty，页面只描述结构。
 * ============================================ */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Users, Coins, TrendingUp, Banknote, Clock } from 'lucide-react';
import { fetchAdminDashboard, type DashboardData } from '@/api/admin';
import { isApiError } from '@/api/http';
import { Button, Card, Empty, Page, PageHeader, Stat, type StatTone } from '../../ui';

/** ISO 时间转相对时间展示 */
function timeAgo(iso: string | null): string {
  if (!iso) return '--';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  /** 页面加载获取运行概览数据 */
  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetchAdminDashboard()
      .then(setData)
      .catch((e) => setLoadError(isApiError(e) ? e.message : '获取仪表盘数据失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  /** 运行概览统计卡片数据。
   * tone 只是强调、不承载语义：收入走 success、支出走 warning、待办走 danger，
   * 具体选色由本页决定（Stat 不猜业务含义）。
   * value 是**已经格式化好的字符串**（含单位与千分位），Stat 不再加工。 */
  const stats: { label: string; value: string; tone: StatTone; icon: ReactNode }[] = data
    ? [
        {
          label: '总用户',
          value: `${data.totalUsers.toLocaleString()} 人`,
          tone: 'accent',
          icon: <Users size={16} strokeWidth={2} />,
        },
        {
          label: '今日充值',
          value: `${data.todayRecharge.toLocaleString()} 积分`,
          tone: 'success',
          icon: <Coins size={16} strokeWidth={2} />,
        },
        {
          label: '今日充值笔数',
          value: `${data.todayRechargeCount.toLocaleString()} 笔`,
          tone: 'accent',
          icon: <TrendingUp size={16} strokeWidth={2} />,
        },
        {
          label: '今日消费',
          value: `${data.todaySpend.toLocaleString()} 积分`,
          tone: 'warning',
          icon: <Banknote size={16} strokeWidth={2} />,
        },
        {
          label: '待处理订单',
          value: `${data.pendingOrders.toLocaleString()} 笔`,
          tone: 'danger',
          icon: <Clock size={16} strokeWidth={2} />,
        },
      ]
    : [];

  return (
    <Page>
      <PageHeader title="仪表盘" subtitle="积分支付系统运行概览" />

      {loading && <Empty message="加载中…" />}

      {!loading && loadError && (
        <Empty message={loadError} extra={<Button onClick={load}>重试</Button>} />
      )}

      {!loading && !loadError && data && (
        <>
          {/* 统计卡片 */}
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}
          >
            {stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} tone={s.tone} icon={s.icon} />
            ))}
          </div>

          {/* 最近充值 / 最近消费 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 16 }}>
            <Card title="最近充值">
              {data.recentRecharges.length === 0 ? (
                <Empty message="暂无记录" />
              ) : (
                data.recentRecharges.map((r) => (
                  <div
                    key={r.tradeNo}
                    style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0' }}
                  >
                    <span>{r.nickname || `#${r.userId}`}</span>
                    <span style={{ flex: 1 }}>+{r.points.toLocaleString()} 积分</span>
                    <span>{timeAgo(r.createdAt)}</span>
                  </div>
                ))
              )}
            </Card>
            <Card title="最近消费">
              {data.recentConsumes.length === 0 ? (
                <Empty message="暂无记录" />
              ) : (
                data.recentConsumes.map((r, i) => (
                  <div
                    key={`${r.userId}-${r.createdAt}-${i}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0' }}
                  >
                    <span>#{r.userId}</span>
                    <span style={{ flex: 1 }} title={r.model}>
                      {r.model}
                    </span>
                    <span>-{r.points.toLocaleString()} 积分</span>
                    <span>{timeAgo(r.createdAt)}</span>
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}
