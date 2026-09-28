/* ============================================
 * Toolbar —— 横向工具栏（筛选栏 / 批量操作栏）
 *
 * 管理端每页都有一两条这样的横排：左边几个筛选控件、右边几个动作。
 * 抽出来是因为「间距、对齐、换行」这三件小事各页都写、又都写得不一样，
 * 表现是每页的筛选栏高度和间隙都差几像素——说不出哪里不对，就是乱。
 * ============================================ */
import type { ReactNode } from 'react';
import styles from './index.module.css';

interface ToolbarProps {
  children: ReactNode;
  /** 右对齐区（动作按钮）。给了才渲染，并自动把中间撑开 */
  actions?: ReactNode;
}

export default function Toolbar({ children, actions }: ToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>{children}</div>
      {actions !== undefined && (
        <>
          <div className={styles.spacer} />
          <div className={styles.actions}>{actions}</div>
        </>
      )}
    </div>
  );
}
