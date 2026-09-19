/* ============================================
 * MentionMenu：@ 菜单（IKFA1M，IKFA1O 泛化多媒体，IKFA1P 文本附件）
 * 顶部「已引用」列出当前目标的有效参考（缩略图/类型图标/名称/标签徽标，可搜索）；
 * 下方保留素材分类入口（从资产中选择 / 到节点选择）——选择新素材添加成功后插入标签。
 * 纯展示组件：过滤由调用方完成，键盘导航下标扁平（refs + 添加入口）。
 * ============================================ */
import { FileText, FolderOpen, Image as ImageIcon, MousePointerClick, AudioLines } from 'lucide-react';
import styles from './index.module.css';

export interface MentionRefItem {
  assetId: string;
  url: string;
  name: string;
  /** 标签徽标文案（图片N/视频N/音频N/首帧/尾帧/文本N；IKFA1O 前为图片N 的 N） */
  badge: string;
  /** 素材媒体类型：缩略图渲染区分（图片/视频显示缩略图——视频经 <video preload="metadata">
   *  抓首帧，IKGABW 对齐 @ 菜单先例；音频/文本显示类型图标） */
  mediaType?: 'image' | 'video' | 'audio' | 'text';
}

/** 已引用项选项行（缩略图/名称/徽标）：失效替换菜单使用（IKFA1N 去重） */
export function MentionRefRow({ item, active, onPick, onHover, testId }: {
  item: MentionRefItem;
  active?: boolean;
  onPick: (assetId: string) => void;
  onHover?: () => void;
  testId?: string;
}) {
  const renderThumb = () => {
    if (item.mediaType === 'video') return <video className={styles.mentionThumb} src={item.url} muted preload="metadata" />;
    if (item.mediaType === 'audio') return <AudioLines size={20} strokeWidth={1.5} />;
    if (item.mediaType === 'text') return <FileText size={20} strokeWidth={1.5} />;
    if (item.url) return <img className={styles.mentionThumb} src={item.url} alt="" />;
    return <ImageIcon size={20} strokeWidth={1.5} />;
  };
  return (
    <button
      type="button"
      className={`${styles.mentionItem} ${active ? styles.mentionItemActive : ''}`}
      // 保持编辑器焦点与光标位置，点击不触发 blur
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

/** 添加新参考入口（IKFA1O 泛化）：按调用方给的细分入口渲染（图片面板=资产/节点；视频按模式+类型+角色） */
export interface MentionNewRefEntry {
  key: string;
  label: string;
  icon: 'folder' | 'pointer';
  onPick: () => void;
}

interface MentionMenuProps {
  /** 已按查询过滤的已引用项 */
  items: MentionRefItem[];
  /** 扁平导航下标：0..items-1 为已引用，之后依次为各添加入口 */
  activeIndex: number;
  /** 添加新参考细分入口（空数组不渲染该分区；参考达上限或只读时调用方传空） */
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
      {items.length === 0 && <div className={styles.mentionEmpty}>暂无已引用素材，可从下方添加新参考</div>}
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
