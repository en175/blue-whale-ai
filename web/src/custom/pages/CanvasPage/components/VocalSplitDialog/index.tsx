import { VOCAL_SPLIT_SCENE_OPTIONS } from '@/custom/enums';
import { useState } from 'react';
import { ArrowUp, ChevronDown, X } from 'lucide-react';
import DropdownMenu from '@/custom/components/DropdownMenu';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import { VOCAL_SPLIT_FORMATS, vocalSplitSceneHint, vocalSplitSceneLabel, type VocalSplitFormat, type VocalSplitScene } from '../../vocalSplit';
import styles from './index.module.css';

interface VocalSplitDialogProps {
  onClose: () => void;
  scene: VocalSplitScene;
  onSceneChange: (scene: VocalSplitScene) => void;
  format: VocalSplitFormat;
  onFormatChange: (format: VocalSplitFormat) => void;
  onSend: () => void;
  submitting?: boolean;
  sendBarAnchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function VocalSplitDialog({
  onClose,
  scene,
  onSceneChange,
  format,
  onFormatChange,
  onSend,
  submitting,
  sendBarAnchor, dragHidden,
}: VocalSplitDialogProps) {
  const readOnly = submitting === true;
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);

  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    <div
      className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
      style={anchoredOverlayStyle(sendBarAnchor, dragHidden)}
      data-gen-panel-territory
      data-testid="vocal-split-send-bar"
    >
      <button
        type="button"
        className={styles.toolBtn}
        data-testid="vocal-split-close"
        title="退出人声背景分离（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.divider} aria-hidden />

      {}
      <DropdownMenu
        modal={false}
        side="top"
        open={sceneMenuOpen}
        onOpenChange={(open) => {
          setSceneMenuOpen(open);
          if (open) setFormatMenuOpen(false);
        }}
        wrapClassName={styles.formatWrap}
        contentClassName={styles.formatMenu}
        contentTestId="vocal-split-scene-menu"
        trigger={
          <button
            type="button"
            className={styles.formatTrigger}
            data-testid="vocal-split-scene-trigger"
            aria-haspopup="menu"
            disabled={readOnly}
            title="选择分离场景（决定产出音轨）"
          >
            <span>{vocalSplitSceneLabel(scene)}</span>
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        }
        items={VOCAL_SPLIT_SCENE_OPTIONS.map((item) => ({
          key: item,
          label: vocalSplitSceneLabel(item),
          title: vocalSplitSceneHint(item),
          checked: item === scene,
          testId: `vocal-split-scene-item-${item}`,
          onSelect: () => onSceneChange(item),
        }))}
      />
      {}
      <DropdownMenu
        modal={false}
        side="top"
        open={formatMenuOpen}
        onOpenChange={(open) => {
          setFormatMenuOpen(open);
          if (open) setSceneMenuOpen(false);
        }}
        wrapClassName={styles.formatWrap}
        contentClassName={styles.formatMenu}
        contentTestId="vocal-split-format-menu"
        trigger={
          <button
            type="button"
            className={styles.formatTrigger}
            data-testid="vocal-split-format-trigger"
            aria-haspopup="menu"
            disabled={readOnly}
            title="选择音频输出格式"
          >
            <span>{format.toUpperCase()}</span>
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        }
        items={VOCAL_SPLIT_FORMATS.map((item) => ({
          key: item,
          label: item.toUpperCase(),
          checked: item === format,
          testId: `vocal-split-format-item-${item}`,
          onSelect: () => onFormatChange(item),
        }))}
      />
      <span className={styles.freeHint}>本期免费</span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="vocal-split-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '发送人声背景分离任务'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
