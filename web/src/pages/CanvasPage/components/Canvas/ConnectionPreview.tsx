import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getBezierPath, type Position } from '@xyflow/react';
import styles from './connectionPreview.module.css';

interface ConnectionPreviewProps {
  fromX: number;
  fromY: number;
  fromPosition: Position;
  toX: number;
  toY: number;
  toPosition: Position;
  connectionStatus: 'valid' | 'invalid' | null;
  fromNode?: { id: string };
}

function handleUnderPoint(clientX: number, clientY: number, sourceId: string | undefined): boolean {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    const handle = el.closest?.('.react-flow__handle');
    if (!handle) continue;
    const nodeId = handle.getAttribute('data-nodeid') ?? handle.getAttribute('data-node-id');
    if (nodeId && nodeId !== sourceId) return true;
  }
  return false;
}

export default function ConnectionPreview({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
  connectionStatus,
  fromNode,
}: ConnectionPreviewProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [overOtherHandle, setOverOtherHandle] = useState(false);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      setCursor({ x: event.clientX, y: event.clientY });
      setOverOtherHandle(handleUnderPoint(event.clientX, event.clientY, fromNode?.id));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [fromNode?.id]);

  const blocked = overOtherHandle && connectionStatus !== 'valid';

  return (
    <>
      <path d={path} fill="none" className="react-flow__connection-path" />
      {blocked && cursor && createPortal(
        <div className={styles.hint} style={{ left: cursor.x, top: cursor.y }}>
          无法连接
        </div>,
        document.body,
      )}
    </>
  );
}
