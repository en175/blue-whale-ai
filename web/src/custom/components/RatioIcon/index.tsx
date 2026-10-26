import styles from './index.module.css';

export default function RatioIcon({ ratio, size = 16 }: { ratio: string; size?: number }) {
  const parts = ratio.split(':').map(Number);
  const [w, h] = parts;
  const valid = parts.length === 2 && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const width = !valid || w >= h ? size : Math.round((w / h) * size);
  const height = !valid || h >= w ? size : Math.round((h / w) * size);
  return <span className={styles.ratioIcon} style={{ width, height }} />;
}
