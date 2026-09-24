/* ============================================
 * Empty —— 空态
 *
 * 没有数据时给一句话，不要留一片空白。空白让人分不清
 * 「真的没有」和「加载失败了 / 还没加载」。
 * ============================================ */
import type { ReactNode } from 'react';
import styles from './index.module.css';

interface EmptyProps {
  /** 一句话说明为什么没有数据、或者该做什么 */
  message: string;
  extra?: ReactNode;
}

export default function Empty({ message, extra }: EmptyProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.message}>{message}</p>
      {extra !== undefined && <div className={styles.extra}>{extra}</div>}
    </div>
  );
}
