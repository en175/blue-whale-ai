import styles from './SummaryCards.module.css';

function formatCredits(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('zh-CN');
}

interface SummaryCardsProps {
  balance: number | null;
}

export default function SummaryCards({ balance }: SummaryCardsProps) {
  return (
    <section className={styles.row}>
      <article className={styles.card}>
        <div className={styles.label}>当前积分余额</div>
        <div className={styles.value}>{formatCredits(balance)}</div>
      </article>
    </section>
  );
}
