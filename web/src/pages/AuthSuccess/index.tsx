/* ============================================
 * 真人认证成功提示页：火山刷脸完成后的手机端落地页（无需登录态）
 * ============================================ */
import { CheckCircle2 } from 'lucide-react';
import styles from './index.module.css';

export default function AuthSuccess() {
  return (
    <div className={styles.container}>
      <CheckCircle2 size={64} className={styles.icon} />
      <h1 className={styles.title}>人像库分组已创建成功</h1>
      <p className={styles.hint}>请于 PC 端页面查看</p>
    </div>
  );
}
