/* ============================================
 * Card —— 内容容器
 *
 * 浅色界面的分层靠**明度差**：白卡片浮在冷灰页面底上，再加一层极轻投影。
 * 少了这层投影，白卡片和页面底都是浅色，边界会糊在一起。
 * ============================================ */
import type { ReactNode } from 'react';
import styles from './index.module.css';

interface CardProps {
  /** 卡片标题；给了才渲染头部，避免空标题占位 */
  title?: ReactNode;
  /** 头部右侧（按钮、筛选器等） */
  extra?: ReactNode;
  /** 内容是否带内边距。表格卡片一般传 false —— 表格自己管单元格间距 */
  padded?: boolean;
  children: ReactNode;
}

export default function Card({ title, extra, padded = true, children }: CardProps) {
  const hasHead = title !== undefined || extra !== undefined;

  return (
    <div className={styles.card}>
      {hasHead && (
        <div className={styles.head}>
          {title !== undefined && <div className={styles.title}>{title}</div>}
          {extra !== undefined && <div className={styles.extra}>{extra}</div>}
        </div>
      )}
      <div className={padded ? styles.body : undefined}>{children}</div>
    </div>
  );
}
