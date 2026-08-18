/* ============================================
 * Dashboard 后台仪表盘：运行概览统计与最近充值/消费
 * 数据源 GET /api/admin/dashboard
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import { Users, Coins, TrendingUp, Banknote, Clock } from 'lucide-react';
import { fetchAdminDashboard, type DashboardData } from '@/api/admin';
import { isApiError } from '@/api/http';
import styles from './index.module.css';

/** 统计卡片配色（顺序对应 stats 数组） */
const statTheme = [
  { icon: Users, color: '#3e8efc', bg: 'rgba(62,139,252,0.12)' },
  { icon: Coins, color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  { icon: TrendingUp, color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
  { icon: Banknote, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  { icon: Clock, color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
];

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

  /** 运行概览统计卡片数据 */
  const stats = data
    ? [
        { label: '总用户', value: `${data.totalUsers.toLocaleString()} 人` },
        { label: '今日充值', value: `${data.todayRecharge.toLocaleString()} 积分` },
        { label: '今日充值笔数', value: `${data.todayRechargeCount.toLocaleString()} 笔` },
        { label: '今日消费', value: `${data.todaySpend.toLocaleString()} 积分` },
        { label: '待处理订单', value: `${data.pendingOrders.toLocaleString()} 笔` },
      ]
    : [];

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>仪表盘</h1>
      <p className={styles.subtitle}>积分支付系统运行概览</p>

      {loading && <div className={styles.stateBox}>加载中…</div>}

      {!loading && loadError && (
        <div className={styles.stateBox}>
          <span>{loadError}</span>
          <button className={styles.retry} onClick={load}>重试</button>
        </div>
      )}

      {!loading && !loadError && data && (
        <>
          {/* 统计卡片 */}
          <div className={styles.stats}>
            {stats.map((s, i) => {
              const theme = statTheme[i];
              const Icon = theme.icon;
              return (
                <div className={styles.statCard} key={s.label}>
                  <div className={styles.statTop}>
                    <span className={styles.statLabel}>{s.label}</span>
                    <span
                      className={styles.statIcon}
                      style={{ backgroundColor: theme.bg, color: theme.color }}
                    >
                      <Icon size={18} strokeWidth={2} />
                    </span>
                  </div>
                  <div className={styles.statValue}>{s.value}</div>
                </div>
              );
            })}
          </div>

          {/* 最近充值 / 最近消费 */}
          <div className={styles.panels}>
            <div className={styles.panel}>
              <h3 className={styles.panelTitle}>最近充值</h3>
              {data.recentRecharges.length === 0 ? (
                <div className={styles.empty}>暂无记录</div>
              ) : (
                data.recentRecharges.map((r) => (
                  <div className={styles.row} key={r.tradeNo}>
                    <span className={styles.rowId}>{r.nickname || `#${r.userId}`}</span>
                    <span className={styles.rowMain}>+{r.points.toLocaleString()} 积分</span>
                    <span className={styles.rowTime}>{timeAgo(r.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
            <div className={styles.panel}>
              <h3 className={styles.panelTitle}>最近消费</h3>
              {data.recentConsumes.length === 0 ? (
                <div className={styles.empty}>暂无记录</div>
              ) : (
                data.recentConsumes.map((r, i) => (
                  <div className={styles.row} key={`${r.userId}-${r.createdAt}-${i}`}>
                    <span className={styles.rowId}>#{r.userId}</span>
                    <span className={styles.rowModel} title={r.model}>{r.model}</span>
                    <span className={styles.rowMain}>-{r.points.toLocaleString()} 积分</span>
                    <span className={styles.rowTime}>{timeAgo(r.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
