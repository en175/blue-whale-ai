/* 拖线落到空白/内容节点后的生成类型菜单 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectGenKind } from '../../connectAbility';
import styles from './index.module.css';

const ITEMS: Array<{ kind: ConnectGenKind; label: string }> = [
  { kind: 'image', label: '图片生成' },
  { kind: 'video', label: '视频生成' },
  { kind: 'audio', label: '音频生成' },
];

interface ConnectTypeMenuProps {
  x: number;
  y: number;
  enabled: Set<ConnectGenKind>;
  onSelect: (kind: ConnectGenKind) => void;
  onClose: () => void;
}

export default function ConnectTypeMenu({ x, y, enabled, onSelect, onClose }: ConnectTypeMenuProps) {
  // CanvasPage 高频重渲染下 onClose 引用常新，监听生命周期不能跟着抖：经 ref 消费最新回调，effect 只在挂载时跑一次
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const close = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(`.${styles.menu}`)) return;
      onCloseRef.current();
    };
    // 拖线松手（pointerup）弹菜单，当次交互里 pointerdown 早已过去、后续只有 click，
    // 无需延迟挂载；多等一个宏任务反而在高频重渲染页面上留下「点击落空」窗口（IKHHW8）
    document.addEventListener('pointerdown', close);
    document.addEventListener('contextmenu', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('contextmenu', close, true);
    };
  }, []);

  return createPortal(
    <div
      className={styles.menu}
      style={{ top: y, left: x }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {ITEMS.map((item) => {
        const ok = enabled.has(item.kind);
        return (
          <button
            key={item.kind}
            type="button"
            className={styles.item}
            disabled={!ok}
            onClick={() => {
              if (!ok) return;
              onSelect(item.kind);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
