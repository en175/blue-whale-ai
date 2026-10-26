import { useViewport, type NodeProps } from '@xyflow/react';
import styles from './index.module.css';

export default function GroupFrameNode({ width, height }: NodeProps) {
  const { zoom } = useViewport();
  const borderWidth = Math.max(1, 1.5 / zoom);
  return (
    <div
      className={styles.frame}
      style={{ width: width ?? 0, height: height ?? 0, borderWidth }}
    />
  );
}
