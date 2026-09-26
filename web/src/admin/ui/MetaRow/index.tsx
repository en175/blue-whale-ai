/* ============================================
 * MetaRow —— 只读的「标签 + 值」一行
 *
 * 它取代之前那些**浅蓝色 info 色块**：那种色块是模板最典型的痕迹 ——
 * 不管里面装的是「这一行的身份」「当前余额」还是「正在读取」，一律同一块浅蓝 + 同一圈圆角。
 * 色块是**装饰**，而这里要表达的是**状态**：读者只需要看清「是什么、值多少」。
 *
 * 所以它刻意安静：没有底色、没有边框、没有图标，只有标签与值的字号/颜色差。
 * 需要与上下文分隔时才给 `tone="sunken"`（极淡的凹陷底），而不是靠颜色喊。
 * ============================================ */
import type { ReactNode } from 'react';

import styles from './index.module.css';

export interface MetaItem {
  label: ReactNode;
  value: ReactNode;
}

interface MetaRowProps {
  items: MetaItem[];
  /** `plain`（默认）= 直接排在页面上；`sunken` = 极淡凹陷底，用于需要与上下文分隔的块。 */
  tone?: 'plain' | 'sunken';
}

export default function MetaRow({ items, tone = 'plain' }: MetaRowProps) {
  return (
    <dl className={tone === 'sunken' ? `${styles.row} ${styles.sunken}` : styles.row}>
      {items.map((item, index) => (
        // 只读展示，顺序稳定（不是可重排列表），用 index 作 key 是安全的
        <div key={index} className={styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
