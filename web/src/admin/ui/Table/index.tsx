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
  /**
   * 按 `<th>` 上写的宽度**固定**列宽，而不是让内容决定。
   *
   * <p>什么时候需要它：某一列的内容**没有断点**（长 ID、无空格的 JSON、URL），
   * 它的「最小内容宽度」会很大，于是 `table-layout: auto` 会把宽度全让给它 ——
   * 别的列被压成一列一个词、行高暴涨，甚至被挤出视口（外壳是 `overflow-x: auto`）。
   * 操作日志页就踩过：详情列里是 `{"quantity_max":2}`，把目标列压到 76px，
   * 模型 ID 折成四行，IP 与操作人被推到滚动条外面。
   *
   * <p>开了之后**每一列都要给宽度**（缺省的那列拿剩余空间）；内容超出会在列内折行，
   * 所以给内容加 `overflow-wrap: anywhere` 才不会被长 token 撑破。
   */
  fixed?: boolean;
}

export default function Table({ children, fixed = false }: TableProps) {
  return (
    <div className={styles.wrap}>
      <table className={fixed ? `${styles.table} ${styles.fixed}` : styles.table}>{children}</table>
    </div>
  );
}
