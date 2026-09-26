import type { ReactNode } from 'react';
import Hint from '../Hint';
import styles from './index.module.css';

interface FieldProps {
  /** 字段名（一句话说清「这里填什么」） */
  label: ReactNode;
  /**
   * **字段级微文案**：单位、可行范围、「留空 = 不封顶」这类一句话说明。
   *
   * <p>渲染在控件下方一行 12px 灰字 —— 这是表单的常规做法，一眼可见、不占版面。
   * 定价这类表单字段名本身不足以让人填对（`100000` 是什么单位？`4000` 是几倍？），
   * 所以说明是**字段的一部分**，不是可有可无的装饰。
   *
   * <p>⚠️ **别把段落塞进这里**：超过两行的说明会把控件往下顶，那时该用 {@link info}。
   * 判据不是字数，而是「它是不是一句话」——是就留这儿，不是就搬去 `info`。
   */
  hint?: ReactNode;
  /**
   * **段落级解释**：为什么这么设计、改了什么会怎样 —— 一两句说不完的那种。
   *
   * <p>渲染成标签旁的一个 **`?`**（悬停 / 聚焦才展开）。它与 {@link hint} 是**两层**，
   * 不是一个开关的两个档：微文案内联、段落收起，两种界面元素各有其位。
   *
   * <p>⛔ 一句话能说清的别放这儿：把「留空 = 不封顶」藏进 hover 只会让人多点一次。
   */
  info?: ReactNode;
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
export default function Field({ label, hint, info, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.label}>
        {label}
        {info !== undefined && <Hint>{info}</Hint>}
      </div>
      {children}
      {hint !== undefined && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
