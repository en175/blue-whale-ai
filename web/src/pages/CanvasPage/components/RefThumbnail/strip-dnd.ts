/* ============================================
 * 参考栏拖拽排序（IKFCKT）：统一序列换位的共享交互层（轻量 HTML5 DnD，零新依赖）。
 * 面板把参考栏构造为统一序列（媒体项 + 文本项拼接），itemProps(index) 逐项透传到
 * RefThumbnail 根节点；drop 落点按目标项水平前/后半决定插入位，换位回调交回面板，
 * 面板按类型提取新相对顺序分别落到顺序权威源（连入边序 / 草稿 material 序 / 本地 state）。
 * 编号（角标与正文 chip）全部派生显示，重排后经既有 reconcile 链路自动同步。
 * ============================================ */
import { useRef, useState } from 'react';

/** 统一序列换位：from/to 为目标槽位（to = 移除被拖项后的最终下标）；越界或原地不动返回原序副本 */
export function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) {
    return [...list];
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** 统一序列（媒体段 + 文本段拼接）换位后按类型提取子序：返回两段新相对序与各自是否变化；
 *  跨类型拖拽只改变类型内相对顺序（编号按类型独立），子序未变时对应回调不应触发 */
export function splitReorder(
  mediaKeys: readonly string[],
  textKeys: readonly string[],
  from: number,
  to: number,
): { nextMedia: string[]; nextText: string[]; mediaChanged: boolean; textChanged: boolean } {
  const mediaSet = new Set(mediaKeys);
  const next = arrayMove([...mediaKeys, ...textKeys], from, to);
  const nextMedia = next.filter((k) => mediaSet.has(k));
  const nextText = next.filter((k) => !mediaSet.has(k));
  return {
    nextMedia,
    nextText,
    mediaChanged: nextMedia.join(',') !== mediaKeys.join(','),
    textChanged: nextText.join(',') !== textKeys.join(','),
  };
}

/** 逐项透传到缩略图根节点的拖拽属性（RefThumbnail.dragProps） */
export interface StripDragItemProps {
  draggable: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  'data-strip-dragging': true | undefined;
  'data-strip-over': 'before' | 'after' | undefined;
}

/** 参考栏拖拽状态机：dragStart 记录起点（不依赖 dataTransfer 读取，jsdom/浏览器行为一致），
 *  dragOver 按目标项前/后半更新落点指示，drop 计算目标槽位并回调 onReorder，dragEnd 兜底复位 */
export function useRefStripDrag({ disabled = false, onReorder }: {
  /** 只读态（生成中）禁拖：draggable=false 且忽略拖拽事件 */
  disabled?: boolean;
  onReorder: (from: number, to: number) => void;
}) {
  const fromRef = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [over, setOver] = useState<{ index: number; before: boolean } | null>(null);

  const reset = () => {
    fromRef.current = null;
    setDraggingIndex(null);
    setOver(null);
  };

  const itemProps = (index: number): StripDragItemProps => ({
    draggable: !disabled,
    onDragStart: (event) => {
      if (disabled) return;
      fromRef.current = index;
      setDraggingIndex(index);
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData('text/plain', String(index));
      } catch {
        // 个别环境（Safari 隐私模式）拒绝写入 dataTransfer；起点已记在内部状态，不影响换位
      }
    },
    onDragOver: (event) => {
      if (fromRef.current == null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const rect = event.currentTarget.getBoundingClientRect();
      const before = event.clientX - rect.left < rect.width / 2;
      setOver((prev) => (prev && prev.index === index && prev.before === before ? prev : { index, before }));
    },
    onDrop: (event) => {
      event.preventDefault();
      const from = fromRef.current;
      const rect = event.currentTarget.getBoundingClientRect();
      const before = event.clientX - rect.left < rect.width / 2;
      reset();
      if (from == null) return;
      const insertAt = before ? index : index + 1;
      const to = from < insertAt ? insertAt - 1 : insertAt;
      if (to !== from) onReorder(from, to);
    },
    onDragEnd: reset,
    'data-strip-dragging': draggingIndex === index ? true : undefined,
    'data-strip-over': over?.index === index ? (over.before ? 'before' : 'after') : undefined,
  });

  return { itemProps };
}
