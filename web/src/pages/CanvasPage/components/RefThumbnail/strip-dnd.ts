/* ============================================
 * 参考栏拖拽排序（IKFCKT）：统一序列换位的共享交互层（轻量 HTML5 DnD，零新依赖）。
 * 面板按稳定身份顺序构造真实混排参考栏，itemProps(index) 逐项透传到
 * RefThumbnail 根节点；drop 落点按目标项水平前/后半决定插入位，换位回调交回面板，
 * 面板按类型提取新相对顺序分别落到顺序权威源（连入边序 / 草稿 material 序 / 本地 state）。
 * 编号（角标与正文 chip）全部派生显示，重排后经既有 reconcile 链路自动同步。
 * ============================================ */
import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react';

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

/** Serializable, target-local presentation order. Media IDs include their source namespace. */
export interface RefStripOrderProps {
  stripOrder?: string[];
  onStripOrderChange?: (orderedKeys: string[]) => void;
}

/** Keep cross-kind slots while reconciling source additions, removals and external within-kind order. */
export function reconcileStripOrder(order: readonly string[], media: readonly string[], text: readonly string[]): string[] {
  const keys = [...media.map(id => `media:${id}`), ...text.map(id => `text:${id}`)];
  const live = new Set(keys);
  const next = [...new Set(order)].filter(key => live.has(key));
  next.push(...keys.filter(key => !next.includes(key)));
  return next;
}

/** Project live items into the same stable order used by the DOM and outgoing references. */
export function orderRefStripItems<T>(items: readonly T[], keyOf: (item: T) => string, order: readonly string[]): T[] {
  const positions = new Map(order.map((key, index) => [key, index]));
  return [...items].sort((a, b) => (positions.get(keyOf(a)) ?? order.length) - (positions.get(keyOf(b)) ?? order.length));
}

export const videoRefStripKey = (ref: { nodeId: string; materialId?: string }): string =>
  ref.materialId != null ? `media:material:${ref.materialId}` : `media:node:${ref.nodeId}`;

export function useMixedRefStrip(media: string[], text: string[], { stripOrder, onStripOrderChange }: RefStripOrderProps) {
  const source = [...media.map(id => `media:${id}`), ...text.map(id => `text:${id}`)];
  const signature = JSON.stringify([media, text, stripOrder]);
  const [state, setState] = useState(() => ({ ordered: Boolean(stripOrder), signature, media, text, saved: stripOrder, order: reconcileStripOrder(stripOrder ?? [], media, text) }));
  let order = state.order;
  if (state.signature !== signature) {
    order = reconcileStripOrder(JSON.stringify(state.saved) !== JSON.stringify(stripOrder) ? stripOrder ?? [] : state.ordered ? order : [], media, text);
    // Edge and material authorities report their own sub-orders. Preserve other source slots.
    const mediaNamespace = (id: string) => id.includes(':') ? id.slice(0, id.indexOf(':')) : '';
    const commonMedia = media.filter(id => state.media.includes(id));
    const previousCommonMedia = state.media.filter(id => media.includes(id));
    const namespacesMoved = JSON.stringify(commonMedia.map(mediaNamespace)) !== JSON.stringify(previousCommonMedia.map(mediaNamespace));
    const groups: Array<[string, string[], string[]]> = namespacesMoved
      ? [['media:', media, state.media]]
      : [...new Set([...media, ...state.media].map(mediaNamespace))].map(namespace => [
          `media:${namespace ? `${namespace}:` : ''}`,
          media.filter(id => mediaNamespace(id) === namespace),
          state.media.filter(id => mediaNamespace(id) === namespace),
        ]);
    groups.push(['text:', text, state.text]);
    for (const [prefix, ids, previous] of groups) {
      const retained = ids.filter(id => previous.includes(id));
      const oldRetained = previous.filter(id => ids.includes(id));
      if (JSON.stringify(retained) !== JSON.stringify(oldRetained)) {
        const queue = ids.map(id => `${prefix.startsWith('media:') ? 'media:' : 'text:'}${id}`);
        order = order.map(key => key.startsWith(prefix) ? queue.shift()! : key);
      }
    }
    setState({ ordered: state.ordered || Boolean(stripOrder), signature, media, text, saved: stripOrder, order });
  }
  const serializedOrder = JSON.stringify(order);
  const savedOrder = JSON.stringify(stripOrder);
  const publishedOrder = useRef(savedOrder);
  useEffect(() => {
    if (!state.ordered || !onStripOrderChange || serializedOrder === savedOrder || serializedOrder === publishedOrder.current) return;
    publishedOrder.current = serializedOrder;
    onStripOrderChange(order);
  }, [state.ordered, onStripOrderChange, serializedOrder, savedOrder, order]);
  return {
    order,
    index: (sourceIndex: number) => order.indexOf(source[sourceIndex]!),
    render: (mediaElements: ReactElement[], textElements: ReactElement[]) => {
      const elements = [...mediaElements, ...textElements];
      return order.map(key => cloneElement(elements[source.indexOf(key)]!, { key }));
    },
    reorder: (from: number, to: number) => {
      const next = arrayMove(order, from, to);
      setState({ ordered: true, signature, media, text, saved: stripOrder, order: next });
      const nextMedia = next.filter(key => key.startsWith('media:')).map(key => key.slice(6));
      const nextText = next.filter(key => key.startsWith('text:')).map(key => key.slice(5));
      return { nextMedia, nextText, mediaChanged: JSON.stringify(nextMedia) !== JSON.stringify(media), textChanged: JSON.stringify(nextText) !== JSON.stringify(text) };
    },
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
