import { KIND_META } from '@/custom/enums';
import { useCallback } from 'react';
import { AtSign } from 'lucide-react';
import { assetCardKindOf, assetCardToolbarVisible } from './toolbarVisibility';
import type { AssetCardNodeData } from './index';
import styles from './index.module.css';

interface AssetCardToolbarProps {
  id: string;
  data: AssetCardNodeData;
  onToolbarPointerEnter?: () => void;
  onToolbarPointerLeave?: () => void;
}

export default function AssetCardToolbar({ id, data, onToolbarPointerEnter, onToolbarPointerLeave }: AssetCardToolbarProps) {
  const handleAddToChat = useCallback(() => data.onAddToChat?.(id), [data, id]);

  if (!assetCardToolbarVisible(data.kind)) return null;

  return (
    <div
      className={styles.topBar}
      onPointerEnter={onToolbarPointerEnter}
      onPointerLeave={onToolbarPointerLeave}
    >
      <span className={styles.topLabel}>
        <AtSign size={14} strokeWidth={2} />
        <span>{KIND_META[assetCardKindOf(data.kind)].title}</span>
      </span>
      <button className={styles.addToChatBtn} onClick={handleAddToChat}>
        <AtSign size={14} strokeWidth={2} />
        <span>添加到对话</span>
      </button>
    </div>
  );
}
