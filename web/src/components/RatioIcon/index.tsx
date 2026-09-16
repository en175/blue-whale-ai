import styles from './index.module.css';

/**
 * 比例示意图标（IKGBTV）：最长边固定为 size，另一条边按真实比例等比缩放；
 * 非法或缺失的比例值兜底渲染正方形。一处定义，画布弹层（16px）与首页下拉（22px）统一引用。
 */
export default function RatioIcon({ ratio, size = 16 }: { ratio: string; size?: number }) {
  const parts = ratio.split(':').map(Number);
  const [w, h] = parts;
  const valid = parts.length === 2 && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const width = !valid || w >= h ? size : Math.round((w / h) * size);
  const height = !valid || h >= w ? size : Math.round((h / w) * size);
  return <span className={styles.ratioIcon} style={{ width, height }} />;
}
