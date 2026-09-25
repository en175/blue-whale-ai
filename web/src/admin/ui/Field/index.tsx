import type { ReactNode } from 'react';
import styles from './index.module.css';

interface FieldProps {
  /** 字段名（一句话说清「这里填什么」） */
  label: ReactNode;
  /**
   * 字段下面的补充说明：单位、可行范围、以及这个值改大了会怎样。
   *
   * <p>定价这类表单，字段名本身不足以让人填对（`100000` 是什么单位？`4000` 是几倍？），
   * 所以说明是**字段的一部分**，不是可有可无的装饰。
   */
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * 表单字段：标签 + 控件 + 说明。
 *
 * <p>为什么要有这个基元：在此之前每个页面都手写
 * `<div><div style={{ marginBottom: 6 }}>标签</div><控件/></div>` ——
 * 间距、字号、说明文字的颜色各写各的，于是同一个管理端里「字段」长得不太一样。
 * 定价表单字段多（十几个），先有基元再写页面，比写完再统一改省事。
 *
 * <p>⚠️ 标签用 `div` 而不是 `<label for>`：本套件的控件自带 `aria-label`
 *    （与既有页面同一口径，控件的可访问名不依赖外层包裹），若这里再包一层 `<label>`，
 *    点标签会聚焦到第一个可聚焦子元素——对一个「标签 + 多个控件」的字段（比如键值对列表）
 *    就会聚错地方。
 *
 * <p>⚠️ **不做栅格**：一行放几个字段是页面的事（`display: grid` 写在页面里），
 *    基元只负责「一个字段内部长什么样」。把栅格也收进来，就得为每种列数开一个 prop。
 */
export default function Field({ label, hint, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.label}>{label}</div>
      {children}
      {hint !== undefined && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
