import { Zap } from 'lucide-react';
import { useAuthStore } from '@/shared/stores/auth';
import styles from './index.module.css';

export default function CreditsBadge() {
  const credits = useAuthStore((s) => s.credits);

  if (typeof credits !== 'number') return null;

  return (
    <div className={styles.badge}>
      <Zap size={14} fill="#FBBF24" stroke="none" />
      <span className={styles.value}>{credits.toLocaleString()}</span>
    </div>
  );
}
