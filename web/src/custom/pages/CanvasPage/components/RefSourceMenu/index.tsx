import { useRef, useState } from 'react';
import { FolderOpen, MousePointerClick, Plus } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/shared/useDismissOnOutside';
import styles from './index.module.css';

interface RefSourceMenuProps {
  onPickFromAssets: () => void;
  onPickFromCanvas: () => void;
  pickMode?: boolean;
  label?: string;
  entryTitle?: string;
}

export const REF_SOURCE_ENTRY_TITLE = '从资产中选择 / 从节点添加素材';

export default function RefSourceMenu({ onPickFromAssets, onPickFromCanvas, pickMode, label, entryTitle }: RefSourceMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open, ref: wrapRef, dismiss: () => setOpen(false) },
  ]);

  return (
    <div className={styles.sourceWrap} ref={wrapRef}>
      <button
        className={`${styles.trigger} ${label ? styles.triggerSlotted : ''} ${pickMode ? styles.picking : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={entryTitle ?? REF_SOURCE_ENTRY_TITLE}
      >
        {label ? (
          <>
            <Plus size={16} strokeWidth={2} />
            <span className={styles.triggerLabel}>{label}</span>
          </>
        ) : (
          <Plus size={18} strokeWidth={2} />
        )}
      </button>
      {open && (
        <>
          <div className={styles.menuOverlay} onClick={() => setOpen(false)} />
          <div className={styles.sourceMenu}>
            <button
              className={styles.sourceMenuItem}
              onClick={() => { setOpen(false); onPickFromAssets(); }}
            >
              <FolderOpen size={14} strokeWidth={2} />
              <span>从资产中选择</span>
            </button>
            <button
              className={styles.sourceMenuItem}
              onClick={() => { setOpen(false); onPickFromCanvas(); }}
            >
              <MousePointerClick size={14} strokeWidth={2} />
              <span>从节点添加素材</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
