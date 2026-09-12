/* ============================================
 * MentionMenu：@ 菜单（IKFA1M）
 * 顶部「已引用」列出当前目标的有效图片参考（缩略图/名称/当前编号，可搜索）；
 * 下方保留素材分类入口（从资产中选择 / 到节点选择）——选择新素材添加成功后插入标签。
 * 纯展示组件：过滤由调用方完成，键盘导航下标扁平（refs + 添加入口）。
 * ============================================ */
import { FolderOpen, Image as ImageIcon, MousePointerClick } from 'lucide-react';
import styles from './index.module.css';

export interface MentionRefItem {
  assetId: string;
  url: string;
  name: string;
  /** 当前展示编号（图片N 的 N） */
  number: number;
}

/** 已引用项选项行（缩略图/名称/编号徽标）：@ 菜单与失效替换菜单共用（IKFA1N 去重） */
export function MentionRefRow({ item, active, onPick, onHover, testId }: {
  item: MentionRefItem;
  active?: boolean;
  onPick: (assetId: string) => void;
  onHover?: () => void;
  testId?: string;
}) {
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
      {item.url ? (
        <img className={styles.mentionThumb} src={item.url} alt="" />
      ) : (
        <ImageIcon size={20} strokeWidth={1.5} />
      )}
      <span className={styles.mentionName} title={item.name}>{item.name}</span>
      <span className={styles.mentionBadge}>图片{item.number}</span>
    </button>
  );
}

interface MentionMenuProps {
  /** 已按查询过滤的已引用项 */
  items: MentionRefItem[];
  /** 扁平导航下标：0..items-1 为已引用，之后依次为「从资产中选择」「到节点选择」 */
  activeIndex: number;
  /** 是否展示「添加新参考」入口（参考达上限或只读时为 false） */
  canAddNew: boolean;
  onPick: (assetId: string) => void;
  onPickNew: (source: 'assets' | 'canvas') => void;
  onHoverIndex: (index: number) => void;
}

export default function MentionMenu({ items, activeIndex, canAddNew, onPick, onPickNew, onHoverIndex }: MentionMenuProps) {
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
      {canAddNew && (
        <>
          <div className={styles.mentionSection}>添加新参考</div>
          <button
            type="button"
            className={`${styles.mentionItem} ${activeIndex === items.length ? styles.mentionItemActive : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPickNew('assets')}
            onMouseEnter={() => onHoverIndex(items.length)}
          >
            <FolderOpen size={16} strokeWidth={2} />
            <span className={styles.mentionName}>从资产中选择</span>
          </button>
          <button
            type="button"
            className={`${styles.mentionItem} ${activeIndex === items.length + 1 ? styles.mentionItemActive : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPickNew('canvas')}
            onMouseEnter={() => onHoverIndex(items.length + 1)}
          >
            <MousePointerClick size={16} strokeWidth={2} />
            <span className={styles.mentionName}>到节点选择</span>
          </button>
        </>
      )}
    </div>
  );
}
