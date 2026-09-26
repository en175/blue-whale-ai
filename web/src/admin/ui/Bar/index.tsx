/* ============================================
 * Bar —— 横向比例条（一行：名称 / 数值 / 占比 + 一根条）
 *
 * 用在「按类别分组，看谁多谁少」的地方（例如仪表盘的任务类型占比）。
 * 一行的四件东西是一个整体：名字和数字分开写、条单独排版，各页的对齐会各不相同。
 *
 * ⚠️ **不是图表库的替代品**。它的定位是「一行数字配一根条」——没有坐标轴、没有图例、
 *    没有多序列对比。需要那些的时候该引入的是图表方案，而不是往这里加 prop。
 *
 * ⚠️ `ratio` 传入 NaN 或越界值一律**钳成 0/1**，不是直接画出去：占比来自
 *    `count / total`，`total` 为 0 时它就是 NaN，而 `width: NaN%` 在浏览器里
 *    是一条不显示的条——看起来像「这类任务一个都没有」，实际是分母缺失。
 *    分母为 0 时整块不该渲染（调用方给空态），本条只是最后一道兜底。
 * ============================================ */
import type { ReactNode } from 'react';
import styles from './index.module.css';

interface BarProps {
  /** 类别名（已本地化，如「视频」） */
  label: ReactNode;
  /** 数值。已经是给人看的字符串（含千分位），与 Stat 同理：组件不做业务格式化 */
  value: ReactNode;
  /** 占比，0–1。只用于条长；百分比文本由本组件按一位小数渲染 */
  ratio: number;
}

/** 占比的小数位。一位足够读；多给几位是在假装这个数比它实际的更精确。 */
const PERCENT_DIGITS = 1;

export default function Bar({ label, value, ratio }: BarProps) {
  // NaN / 越界 → 钳回 [0, 1]。Number.isFinite 先挡掉 NaN 与 Infinity
  const safeRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.meta}>
          <span className={styles.value}>{value}</span>
          {/*
            ⚠️ 各条占比四舍五入后<b>之和不一定是 100%</b>（三条 33.3% 加起来 99.9%）。
               这是四舍五入的常态，不要去凑数——把某一条 +0.1 让它凑成 100 是伪造，
               它会让那一条的数<b>多于</b>真实值，而读者无从分辨哪一条被动过。
          */}
          <span className={styles.percent}>{(safeRatio * 100).toFixed(PERCENT_DIGITS)}%</span>
        </span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${safeRatio * 100}%` }} />
      </div>
    </div>
  );
}
