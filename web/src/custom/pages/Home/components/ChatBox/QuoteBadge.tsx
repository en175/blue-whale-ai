import { Zap } from 'lucide-react';
import styles from './QuoteBadge.module.css';

export default function QuoteBadge({ credits = null }: { credits?: number | null }) {
  return (
    <span className={styles.badge} data-testid="home-quote" aria-label="消耗积分">
      <Zap size={14} fill="#FBBF24" stroke="none" />
      {credits != null && <span className={styles.value}>{credits.toLocaleString()}</span>}
    </span>
  );
}
