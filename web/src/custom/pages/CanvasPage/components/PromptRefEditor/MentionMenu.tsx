import { FileText, FolderOpen, Image as ImageIcon, MousePointerClick, AudioLines } from 'lucide-react';
import Empty from '@/custom/components/Empty';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import styles from './index.module.css';

export interface MentionRefItem {
  assetId: string;
  url: string;
  name: string;
  badge: string;
  mediaType?: 'image' | 'video' | 'audio' | 'text';
}

export function MentionRefRow({ item, active, onPick, onHover, testId }: {
  item: MentionRefItem;
  active?: boolean;
  onPick: (assetId: string) => void;
  onHover?: () => void;
  testId?: string;
}) {
  const renderThumb = () => {
    if (item.mediaType === 'video') return <video className={styles.mentionThumb} src={resolveMediaSrc(item.url)} muted preload="metadata" />;
    if (item.mediaType === 'audio') return <AudioLines size={20} strokeWidth={1.5} />;
    if (item.mediaType === 'text') return <FileText size={20} strokeWidth={1.5} />;
    if (item.url) return <img className={styles.mentionThumb} src={resolveMediaSrc(item.url)} crossOrigin={remoteImageCrossOrigin(item.url)} alt="" />;
    return <ImageIcon size={20} strokeWidth={1.5} />;
  };
  return (
    <button
      type="button"
      className={`${styles.mentionItem} ${active ? styles.mentionItemActive : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(item.assetId)}
      onMouseEnter={onHover}
      data-testid={testId}
    >
      {renderThumb()}
      <span className={styles.mentionName} title={item.name}>{item.name}</span>
      <span className={styles.mentionBadge}>{item.badge}</span>
    </button>
  );
}

export interface MentionNewRefEntry {
  key: string;
  label: string;
  icon: 'folder' | 'pointer';
  onPick: () => void;
}

interface MentionMenuProps {
  items: MentionRefItem[];
  activeIndex: number;
  newRefEntries: MentionNewRefEntry[];
  onPick: (assetId: string) => void;
  onHoverIndex: (index: number) => void;
}

const NEW_REF_ICONS = {
  folder: FolderOpen,
  pointer: MousePointerClick,
} as const;

export default function MentionMenu({ items, activeIndex, newRefEntries, onPick, onHoverIndex }: MentionMenuProps) {
  return (
    <div className={styles.mentionMenu} data-testid="mention-menu">
      <div className={styles.mentionSection}>已引用</div>
      {items.length === 0 && <Empty className={styles.mentionEmpty} title="暂无已引用素材，可从下方添加新参考" />}
      {items.map((item, index) => (
        <MentionRefRow
          key={item.assetId}
          item={item}
          active={index === activeIndex}
          onPick={onPick}
          onHover={() => onHoverIndex(index)}
          testId="mention-ref-item"
        />
      ))}
      {newRefEntries.length > 0 && (
        <>
          <div className={styles.mentionSection}>添加新参考</div>
          {newRefEntries.map((entry, index) => {
            const Icon = NEW_REF_ICONS[entry.icon];
            return (
              <button
                type="button"
                key={entry.key}
                className={`${styles.mentionItem} ${activeIndex === items.length + index ? styles.mentionItemActive : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={entry.onPick}
                onMouseEnter={() => onHoverIndex(items.length + index)}
              >
                <Icon size={16} strokeWidth={2} />
                <span className={styles.mentionName}>{entry.label}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
