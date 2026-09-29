/* ============================================
 * 首页顶栏积分余额徽标：黄色实心闪电 + 额度
 * 仅在登录态显示；未加载 / 未登录时隐藏
 * ============================================ */
import { Zap } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import styles from './index.module.css';

export default function CreditsBadge() {
  const credits = useAuthStore((s) => s.credits);

  if (credits === null) return null;

  return (
    <div className={styles.badge}>
      <Zap size={14} fill="#FBBF24" stroke="none" />
      <span className={styles.value}>{credits.toLocaleString()}</span>
    </div>
  );
}
