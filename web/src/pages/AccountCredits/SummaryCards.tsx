import type { CreditsSummary } from './types';
import styles from './SummaryCards.module.css';

function dash(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  return String(value);
}

function formatCredits(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('zh-CN');
}

interface SummaryCardsProps {
  summary: CreditsSummary;
}

export default function SummaryCards({ summary }: SummaryCardsProps) {
  const nearest = summary.nearestLot;
  const nearestValue =
    nearest?.remaining == null ? '—' : `剩余 ${formatCredits(nearest.remaining)} 积分`;
  const nearestHint =
    nearest?.expiresAt == null
      ? '暂无即将到期的批次'
      : `${nearest.expiresAt} 到期 · 先到期先消耗`;

  return (
    <section className={styles.row}>
      <article className={styles.card}>
        <div className={styles.label}>当前积分余额</div>
        <div className={styles.value}>{formatCredits(summary.balance)}</div>
        <div className={styles.hint}>全模型可用 · 图片 / 视频 / 音频 / Agent 任务</div>
      </article>
      <article className={styles.card}>
        <div className={styles.label}>积分有效期</div>
        <div className={styles.value}>
          {summary.validityMonths == null ? '—' : `${summary.validityMonths} 个月`}
        </div>
        <div className={styles.hint}>自订单支付成功起算 · 按批次过期核销</div>
      </article>
      <article className={styles.card}>
        <div className={styles.label}>最近到期批次</div>
        <div className={styles.value}>{nearestValue}</div>
        <div className={styles.hint}>{dash(nearest ? nearestHint : null)}</div>
      </article>
    </section>
  );
}
