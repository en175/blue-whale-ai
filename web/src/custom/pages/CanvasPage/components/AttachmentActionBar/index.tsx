import { type VideoRefRole } from '@/custom/enums';
import type { ReactNode } from 'react';
import { FolderOpen, Plus } from 'lucide-react';

import styles from './index.module.css';

export const ATTACHMENT_ACTION_PICK_CANVAS_TITLE = '从节点添加素材';
export const ATTACHMENT_ACTION_PICK_ASSETS_TITLE = '从资产中选择';

export type AttachmentActionKind = 'image' | 'video' | 'audio';

interface AttachmentActionBarProps {
  onPickFromCanvas?: (kind: AttachmentActionKind, role?: VideoRefRole) => void;
  onPickFromAssets?: (kind: AttachmentActionKind, role?: VideoRefRole) => void;
  kind: AttachmentActionKind;
  role?: VideoRefRole;
  pickMode?: boolean;
  disabledReason?: string | null;
  trailing?: ReactNode;
}

export default function AttachmentActionBar({
  onPickFromCanvas,
  onPickFromAssets,
  kind,
  role,
  pickMode,
  disabledReason,
  trailing,
}: AttachmentActionBarProps) {
  const disabled = disabledReason != null && disabledReason !== '';
  const guard = (dispatch?: (kind: AttachmentActionKind, role?: VideoRefRole) => void) => () => {
    if (disabled) return;
    dispatch?.(kind, role);
  };
  return (
    <div className={styles.actionBar}>
      <div className={styles.actions}>
        <button
          className={`${styles.pill} ${pickMode ? styles.picking : ''}`}
          aria-disabled={disabled || undefined}
          title={disabled ? disabledReason : ATTACHMENT_ACTION_PICK_CANVAS_TITLE}
          onClick={guard(onPickFromCanvas)}
        >
          <Plus size={14} strokeWidth={2} />
          <span>参考</span>
        </button>
        <button
          className={styles.pill}
          aria-disabled={disabled || undefined}
          title={disabled ? disabledReason : ATTACHMENT_ACTION_PICK_ASSETS_TITLE}
          onClick={guard(onPickFromAssets)}
        >
          <FolderOpen size={14} strokeWidth={2} />
          <span>资产库</span>
        </button>
      </div>
      {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
    </div>
  );
}
