/* 组框节点：与素材同一套 React Flow zIndex，上层组压住下层组与其素材 */
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
