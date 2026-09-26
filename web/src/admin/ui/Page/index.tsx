/* ============================================
 * Page —— 页面根容器
 *
 * 提供区块之间的统一纵向节奏。没有它，各页会自己写 gap（12 / 16 / 20 都有），
 * 表现是「每页看着都差不多、但就是不齐」。
 * ============================================ */
import type { ReactNode } from 'react';
import styles from './index.module.css';

export default function Page({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}
