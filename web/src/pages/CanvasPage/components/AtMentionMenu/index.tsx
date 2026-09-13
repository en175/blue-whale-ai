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

export interface ReferencedMentionItem extends AtMentionItem {
  badge: string;
}

interface AtMentionMenuProps {
  /** 定位锚点（输入框容器） */
  anchorRef: React.RefObject<HTMLElement | null>;
  items: AtMentionItem[];
  renderInline?: boolean;
  referencedItems?: ReferencedMentionItem[];
  onSelectReferenced?: (item: ReferencedMentionItem) => void;
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
  renderInline = false,
  referencedItems = [],
  onSelectReferenced,
  disabledKinds,
  onSelect,
  onClose,
}: AtMentionMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(editorQuery);
  const [hovered, setHovered] = useState<AtMentionKind | null>(null);
  const [availableHeight, setAvailableHeight] = useState(480);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const disabled = new Set(disabledKinds ?? []);
  const searching = query.trim().length > 0;
  const matched = filterAtMentionItems(items, query);
  const normalizedQuery = query.trim().toLowerCase();
  // 两个分区独立过滤，不跨分区去重。
  const matchedRefs = referencedItems.filter(item => !normalizedQuery
    || item.name.toLowerCase().includes(normalizedQuery)
    || item.badge.toLowerCase().includes(normalizedQuery));

  useEffect(() => {
    setQuery(editorQuery);
  }, [editorQuery]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (renderInline) {
      setAvailableHeight(Math.max(100, rect.bottom - 8));
      return;
    }
    const width = 228;
    const estHeight = Math.min(rootRef.current?.offsetHeight || 300, window.innerHeight - 16);
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    if (top + estHeight > window.innerHeight - 8) top = Math.max(8, rect.top - estHeight - 6);
    setPos({ top, left });
  }, [anchorRef, renderInline, searching, matched.length, matchedRefs.length]);

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

  const menu = (
    <div
      ref={rootRef}
      className={`${styles.portal} ${renderInline ? styles.inline : ''}`}
      data-testid="mention-menu"
      data-canvas-keyboard-scope="mention"
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        const target = e.target as HTMLElement;
        const button = target.closest<HTMLButtonElement>('button');
        const kind = button?.dataset.mentionKind;
        const flyout = rootRef.current?.querySelector<HTMLElement>('[data-mention-flyout]');
        const inFlyout = !!flyout?.contains(target);
        if ((e.key === 'Enter' || e.key === 'ArrowRight') && kind) {
          e.preventDefault();
          e.stopPropagation();
          flyout?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
          return;
        }
        if (e.key === 'ArrowLeft' && inFlyout) {
          e.preventDefault();
          e.stopPropagation();
          rootRef.current?.querySelector<HTMLButtonElement>(`[data-mention-kind="${hovered}"]`)?.focus();
          return;
        }
        if (e.key === 'Enter' && button) {
          e.preventDefault();
          e.stopPropagation();
          button.click();
          return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const scope = inFlyout ? flyout : rootRef.current?.querySelector('[data-mention-main]');
        const buttons = [...(scope?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (!buttons.length) return;
        e.preventDefault();
        e.stopPropagation();
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = current < 0
          ? (e.key === 'ArrowDown' ? 0 : buttons.length - 1)
          : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }}
      style={renderInline ? { maxHeight: availableHeight } : { top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseLeave={() => setHovered(null)}
    >
      <div className={styles.panel} data-mention-main>
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

        <div className={styles.results}>
        {matchedRefs.length > 0 && (
          <section aria-label="已引用">
            <div className={styles.sectionLabel}>已引用</div>
            {matchedRefs.map(item => (
              <button key={item.id} type="button" className={styles.itemRow}
                data-testid="mention-ref-item"
                onMouseDown={e => e.preventDefault()}
                onClick={() => onSelectReferenced?.(item)}>
                <ItemThumb item={item} />
                <span className={styles.itemName} title={item.name}>{item.name}</span>
                <span className={styles.badge}>{item.badge}</span>
              </button>
            ))}
          </section>
        )}
        {searching ? (
          matched.length === 0 && matchedRefs.length === 0 ? (
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
                  disabled={off}
                  data-mention-kind={kind}
                  onFocus={() => setHovered(off ? null : kind)}
                  onClick={() => setHovered(off ? null : kind)}
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
      </div>

      {!searching && hovered && (
        <div className={styles.flyoutWrap} onMouseEnter={() => setHovered(hovered)}>
        <div className={styles.flyout} data-mention-flyout>
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
    </div>
  );
  return renderInline ? menu : createPortal(menu, document.body);
}
