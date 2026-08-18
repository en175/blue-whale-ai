/* ============================================
 * AdminPlaceholder 后台通用占位页：标题 + 建设中提示
 * ============================================ */
import styles from './index.module.css';

interface AdminPlaceholderProps {
  title: string;
  subtitle: string;
}

export default function AdminPlaceholder({ title, subtitle }: AdminPlaceholderProps) {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>
      <div className={styles.box}>模块建设中</div>
    </div>
  );
}
