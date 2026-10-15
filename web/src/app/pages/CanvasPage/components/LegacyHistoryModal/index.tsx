import Modal from '@/app/components/Modal';
import type { LegacyCardHistoryItem } from '@/app/api/canvas';
import styles from './index.module.css';

interface LegacyHistoryModalProps {
  open: boolean;
  items: LegacyCardHistoryItem[];
  onClose: () => void;
}

function sourceLabel(item: LegacyCardHistoryItem): string | null {
  if (!item.source) return null;
  return `预览来源：会话 ${item.source.sessionId} · 修订 ${item.source.revisionId} · 镜头 ${item.source.shotNo}`;
}

export default function LegacyHistoryModal({ open, items, onClose }: LegacyHistoryModalProps) {
  return (
    <Modal open={open} title="旧生成卡迁移历史" onCancel={onClose} footer={null} width={560}>
      <div className={styles.list}>
        {items.map((item) => {
          const source = sourceLabel(item);
          return (
            <section key={item.historyId} className={styles.item} data-testid="legacy-history-item">
              <header className={styles.itemHeader}>
                <span className={styles.itemTitle}>{item.title || '（无标题）'}</span>
                <time className={styles.itemTime}>{new Date(item.migratedAt).toLocaleString()}</time>
              </header>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>画面描述</div>
                <p className={styles.fieldBody}>{item.visualText ?? '（无画面描述）'}</p>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>迁移时提示词</div>
                <p className={styles.fieldBody}>{item.promptText}</p>
              </div>
              {source && <div className={styles.sourceLine}>{source}</div>}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
