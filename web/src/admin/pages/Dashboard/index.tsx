/* ============================================
 * Dashboard 后台仪表盘：运行概览统计
 * 数据源 GET /api/admin/dashboard
 *
 * 呈现层全部走 @/admin/ui 的组件，**本页没有自己的样式文件**——
 * 统计卡用 Stat（色走 tone，不在页面里硬编码色值），加载/失败态用 Empty，
 * 页面只描述结构。
 *
 * ⚠️ 只剩「总用户」一张卡：今日充值 / 今日消费 / 待处理订单与最近充值、最近消费原先
 *    读的是 new-api 的账单与充值接口，new-api 降级成上游供应商后那些数不再属于我们。
 *    卡片直接删掉而不是显示 0——恒为 0 的「今日充值」看起来像「今天没人充值」。
 * ============================================ */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { fetchAdminDashboard, type DashboardData } from '@/api/admin';
import { isApiError } from '@/api/http';
import { Button, Empty, Page, PageHeader, Stat, type StatTone } from '../../ui';

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
   * tone 只是强调、不承载语义；value 是**已经格式化好的字符串**（含单位与千分位），
   * Stat 不再加工。 */
  const stats: { label: string; value: string; tone: StatTone; icon: ReactNode }[] = data
    ? [
        {
          label: '总用户',
          value: `${data.totalUsers.toLocaleString()} 人`,
          tone: 'accent',
          icon: <Users size={16} strokeWidth={2} />,
        },
      ]
    : [];

  return (
    <Page>
      <PageHeader title="仪表盘" subtitle="平台运行概览" />

      {loading && <Empty message="加载中…" />}

      {!loading && loadError && (
        <Empty message={loadError} extra={<Button onClick={load}>重试</Button>} />
      )}

      {!loading && !loadError && data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          {stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} tone={s.tone} icon={s.icon} />
          ))}
        </div>
      )}
    </Page>
  );
}
