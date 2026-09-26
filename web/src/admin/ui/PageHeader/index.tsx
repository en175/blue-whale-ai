/* ============================================
 * PageHeader —— 页面标题区
 *
 * 每个页面顶部都是这个结构：标题 + 一行说明 + 右侧动作。
 * 抽出来是为了让**字号/间距/对齐**只有一处定义——这层不统一时，
 * 十个页面会长得「像但不一样」，而那种差别说不清在哪，只是看着乱。
 * ============================================ */
import type { ReactNode } from 'react';
import styles from './index.module.css';

interface PageHeaderProps {
  title: ReactNode;
  /** 一行说明。写「这一页能做什么」，不要复述标题 */
  subtitle?: ReactNode;
  /** 右侧动作区（按钮等） */
  extra?: ReactNode;
}

export default function PageHeader({ title, subtitle, extra }: PageHeaderProps) {
  return (
    <header className={styles.head}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle !== undefined && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {extra !== undefined && <div className={styles.extra}>{extra}</div>}
    </header>
  );
}
