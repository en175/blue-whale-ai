import { VOCAL_SPLIT_SCENE_OPTIONS } from '@/custom/enums';
import { useRef, useState } from 'react';
import { ArrowUp, ChevronDown, X } from 'lucide-react';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
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
  const sceneWrapRef = useRef<HTMLDivElement>(null);
  const formatWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside([
    { open: sceneMenuOpen, ref: sceneWrapRef, dismiss: () => setSceneMenuOpen(false) },
    { open: formatMenuOpen, ref: formatWrapRef, dismiss: () => setFormatMenuOpen(false) },
  ]);

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
      <div className={styles.formatWrap} ref={sceneWrapRef}>
        <button
          type="button"
          className={styles.formatTrigger}
          data-testid="vocal-split-scene-trigger"
          aria-haspopup="menu"
          aria-expanded={sceneMenuOpen || undefined}
          disabled={readOnly}
          title="选择分离场景（决定产出音轨）"
          onClick={guarded(readOnly, () => {
            setFormatMenuOpen(false);
            setSceneMenuOpen((open) => !open);
          })}
        >
          <span>{vocalSplitSceneLabel(scene)}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
        {sceneMenuOpen && (
          <div
            className={styles.formatMenu}
            role="menu"
            data-testid="vocal-split-scene-menu"
          >
            {VOCAL_SPLIT_SCENE_OPTIONS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === scene}
                title={vocalSplitSceneHint(item)}
                className={`${styles.formatMenuItem} ${item === scene ? styles.formatMenuItemActive : ''}`}
                data-testid={`vocal-split-scene-item-${item}`}
                onClick={() => {
                  onSceneChange(item);
                  setSceneMenuOpen(false);
                }}
              >
                {vocalSplitSceneLabel(item)}
              </button>
            ))}
          </div>
        )}
      </div>
      {}
      <div className={styles.formatWrap} ref={formatWrapRef}>
        <button
          type="button"
          className={styles.formatTrigger}
          data-testid="vocal-split-format-trigger"
          aria-haspopup="menu"
          aria-expanded={formatMenuOpen || undefined}
          disabled={readOnly}
          title="选择音频输出格式"
          onClick={guarded(readOnly, () => {
            setSceneMenuOpen(false);
            setFormatMenuOpen((open) => !open);
          })}
        >
          <span>{format.toUpperCase()}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
        {formatMenuOpen && (
          <div
            className={styles.formatMenu}
            role="menu"
            data-testid="vocal-split-format-menu"
          >
            {VOCAL_SPLIT_FORMATS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === format}
                className={`${styles.formatMenuItem} ${item === format ? styles.formatMenuItemActive : ''}`}
                data-testid={`vocal-split-format-item-${item}`}
                onClick={() => {
                  onFormatChange(item);
                  setFormatMenuOpen(false);
                }}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
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
