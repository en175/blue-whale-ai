import { MentionRefRow, type MentionRefItem } from './MentionMenu';
import styles from './index.module.css';

export default function ReplaceRefMenu({ items, onPick }: {
  items: MentionRefItem[];
  onPick: (assetId: string) => void;
}) {
  return (
    <div className={styles.mentionMenu} data-testid="replace-ref-menu">
      <div className={styles.mentionSection}>替换为已引用素材</div>
      {items.length === 0 && <div className={styles.mentionEmpty}>暂无可替换的已引用素材，可删除该标签</div>}
      {items.map((item) => (
        <MentionRefRow key={item.assetId} item={item} onPick={onPick} testId="replace-ref-item" />
      ))}
    </div>
  );
}
