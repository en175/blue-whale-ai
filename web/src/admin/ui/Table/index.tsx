/* ============================================
 * Table —— 表格容器
 *
 * 只做两件事：① 提供卡片外壳（描边 + 圆角 + 横向滚动）② 统一定义 th/td 的样式。
 *
 * **刻意不做列定义驱动**（不抽 DataTable<Row>）：十个页面的列差异很大，
 * 过早抽象出来的泛型组件最后会被一堆 `render: (row) => ...` 占满，
 * 而调用处比直接写 <td> 还长。等真出现「三处以上一模一样的列」再抽。
 * ============================================ */
import type { ReactNode } from 'react';
import styles from './index.module.css';

interface TableProps {
  children: ReactNode;
}

export default function Table({ children }: TableProps) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>{children}</table>
    </div>
  );
}
