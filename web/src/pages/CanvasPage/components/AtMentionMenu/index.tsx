/* 输入 @ 后的素材引用菜单：搜索 + 类型分组，悬停右侧展开当前画布节点 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlignJustify, AudioLines, ChevronRight, Image as ImageIcon, Search, Video } from 'lucide-react';
import {
  filterAtMentionItems,
  type AtMentionItem,
  type AtMentionKind,
} from '../../atMention';
import styles from './index.module.css';

const KIND_META: Array<{ kind: AtMentionKind; label: string }> = [
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
  { kind: 'audio', label: '音频' },
  { kind: 'text', label: '文本' },
];

function KindGlyph({ kind }: { kind: AtMentionKind }) {
  if (kind === 'video') return <Video size={15} strokeWidth={2} />;
  if (kind === 'audio') return <AudioLines size={15} strokeWidth={2} />;
  if (kind === 'text') return <AlignJustify size={15} strokeWidth={2} />;
  return <ImageIcon size={15} strokeWidth={2} />;
}

function ItemThumb({ item }: { item: AtMentionItem }) {
  if (item.kind === 'image' && item.thumbUrl) {
    return <img className={styles.thumb} src={item.thumbUrl} alt="" />;
  }
  if (item.kind === 'video' && item.thumbUrl) {
    return <video className={styles.thumb} src={item.thumbUrl} muted preload="metadata" />;
  }
  return (
    <span className={styles.itemFallback}>
      <KindGlyph kind={item.kind} />
    </span>
  );
}

interface AtMentionMenuProps {
  /** 定位锚点（输入框容器） */
  anchorRef: React.RefObject<HTMLElement | null>;
  items: AtMentionItem[];
  /** 编辑器 @ 后已输入的检索词 */
  editorQuery: string;
  disabledKinds?: AtMentionKind[];
  onSelect: (item: AtMentionItem) => void;
  onClose: () => void;
}

export default function AtMentionMenu({
  anchorRef,
  items,
  editorQuery,
  disabledKinds,
  onSelect,
  onClose,
}: AtMentionMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(editorQuery);
  const [hovered, setHovered] = useState<AtMentionKind | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const disabled = new Set(disabledKinds ?? []);
  const searching = query.trim().length > 0;
  const matched = filterAtMentionItems(items, query);

  useEffect(() => {
    setQuery(editorQuery);
  }, [editorQuery]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = 228;
    const estHeight = searching ? 220 : 250;
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    if (top + estHeight > window.innerHeight - 8) top = Math.max(8, rect.top - estHeight - 6);
    setPos({ top, left });
  }, [anchorRef, searching, matched.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [onClose]);

  const flyoutItems = hovered ? items.filter((item) => item.kind === hovered) : [];

  return createPortal(
    <div
      ref={rootRef}
      className={styles.portal}
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseLeave={() => setHovered(null)}
    >
      <div className={styles.panel}>
        <label className={styles.search}>
          <Search size={15} strokeWidth={2} />
          <input
            className={styles.searchInput}
            value={query}
            placeholder="搜索"
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {searching ? (
          matched.length === 0 ? (
            <div className={styles.empty}>未找到匹配素材</div>
          ) : (
            <div>
              {KIND_META.map(({ kind, label }) => {
                const group = matched.filter((item) => item.kind === kind);
                if (group.length === 0) return null;
                const off = disabled.has(kind);
                return (
                  <div key={kind}>
                    <div className={styles.groupLabel}>{label}</div>
                    {group.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={styles.itemRow}
                        disabled={off}
                        onClick={() => {
                          if (off) return;
                          onSelect(item);
                        }}
                      >
                        <ItemThumb item={item} />
                        <span className={styles.itemName}>{item.name}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <>
            <div className={styles.sectionLabel}>素材引用</div>
            {KIND_META.map(({ kind, label }) => {
              const off = disabled.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  className={`${styles.kindRow} ${hovered === kind && !off ? styles.kindRowActive : ''} ${off ? styles.kindRowDisabled : ''}`}
                  onMouseEnter={() => setHovered(off ? null : kind)}
                >
                  <span className={styles.kindIcon}>
                    <KindGlyph kind={kind} />
                  </span>
                  <span className={styles.kindLabel}>{label}</span>
                  <ChevronRight size={14} strokeWidth={2} className={styles.chevron} />
                </button>
              );
            })}
          </>
        )}
      </div>

      {!searching && hovered && (
        <div className={styles.flyoutWrap} onMouseEnter={() => setHovered(hovered)}>
        <div className={styles.flyout}>
          {flyoutItems.length === 0 ? (
            <div className={styles.empty}>画布暂无该类型素材</div>
          ) : (
            flyoutItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.itemRow}
                onClick={() => onSelect(item)}
              >
                <ItemThumb item={item} />
                <span className={styles.itemName}>{item.name}</span>
              </button>
            ))
          )}
        </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
