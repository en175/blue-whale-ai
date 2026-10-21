import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X, ArrowUp, ChevronDown, Scan, User, Package, CircleDot, Crop } from 'lucide-react';
import DragSlider from '@/custom/components/DragSlider';
import DropdownMenu from '@/custom/components/DropdownMenu';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../agent/followDialog';
import {
  IMAGE_CUTOUT_CONTOUR_SIZE_MIN,
  IMAGE_CUTOUT_CONTOUR_SLIDER_MAX,
  type ImageCutoutScene,
} from '../../tools/image/imageCutout';
import MediaToolQuoteBadge from '../MediaToolQuoteBadge';
import styles from './index.module.css';

interface CutoutToolbarProps {
  onClose: () => void;
  scene: ImageCutoutScene;
  onSceneChange: (scene: ImageCutoutScene) => void;
  needContour: boolean;
  onNeedContourChange: (enabled: boolean) => void;
  contourSize: number;
  onContourSizeChange: (size: number) => void;
  needCropBackground: boolean;
  onNeedCropBackgroundChange: (enabled: boolean) => void;
  sendDisabledReason: string | null;
  submitting: boolean;
  onSend: () => boolean;
  followAnchor?: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

const SCENE_OPTIONS: Array<{
  key: ImageCutoutScene;
  label: string;
  hint: string;
  Icon: typeof Scan;
}> = [
  { key: 'general', label: '通用', hint: '自动识别画面主体并保留', Icon: Scan },
  { key: 'human', label: '人像', hint: '只保留图像中的人物主体', Icon: User },
  { key: 'product', label: '商品', hint: '只保留图像中的商品主体', Icon: Package },
];

export default function CutoutToolbar({
  onClose,
  scene,
  onSceneChange,
  needContour,
  onNeedContourChange,
  contourSize,
  onContourSizeChange,
  needCropBackground,
  onNeedCropBackgroundChange,
  sendDisabledReason,
  submitting,
  onSend,
  followAnchor, dragHidden,
}: CutoutToolbarProps) {
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [contourMenuOpen, setContourMenuOpen] = useState(false);

  const subjectScene = scene !== 'general';
  const sceneLabel = SCENE_OPTIONS.find((option) => option.key === scene)?.label ?? '通用';

  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  const onContourSliderKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
      data-gen-panel-territory
    >
      <div className={styles.toolbar} data-testid="cutout-toolbar">
        <button type="button" className={styles.iconBtn} onClick={onClose} title="退出抠图" data-testid="cutout-close">
          <X size={14} strokeWidth={2} />
        </button>
        <span className={styles.divider} aria-hidden />

        <DropdownMenu
          modal={false}
          open={sceneMenuOpen}
          onOpenChange={(open) => {
            setSceneMenuOpen(open);
            if (open) setContourMenuOpen(false);
          }}
          wrapClassName={styles.menuAnchor}
          contentClassName={styles.menuPopup}
          contentTestId="cutout-scene-menu"
          trigger={
            <button
              type="button"
              className={styles.triggerBtn}
              aria-haspopup="menu"
              title="选择抠图场景"
              data-testid="cutout-scene-trigger"
            >
              <span>{sceneLabel}</span>
              <ChevronDown size={12} strokeWidth={2} />
            </button>
          }
          items={SCENE_OPTIONS.map(({ key, label, hint, Icon }) => ({
            key,
            label: (
              <>
                <Icon size={14} strokeWidth={2} />
                <span>{label}</span>
              </>
            ),
            title: hint,
            testId: `cutout-scene-${key}`,
            onSelect: () => onSceneChange(key),
          }))}
        />

        {subjectScene && (
          <>
            <DropdownMenu
              modal={false}
              open={contourMenuOpen}
              onOpenChange={(open) => {
                setContourMenuOpen(open);
                if (open) setSceneMenuOpen(false);
              }}
              wrapClassName={styles.menuAnchor}
              contentClassName={styles.contourPopup}
              contentTestId="cutout-contour-menu"
              trigger={
                <button
                  type="button"
                  className={`${styles.triggerBtn} ${needContour ? styles.triggerBtnActive : ''}`}
                  aria-haspopup="menu"
                  title="主体描边（白色，仅人像/商品）"
                  data-testid="cutout-contour-trigger"
                >
                  <CircleDot size={14} strokeWidth={2} />
                  <span>描边</span>
                  <ChevronDown size={12} strokeWidth={2} />
                </button>
              }
              panel={
                <>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={needContour}
                    className={`${styles.toggleBtn} ${needContour ? styles.toggleBtnOn : ''}`}
                    data-testid="cutout-contour-toggle"
                    onClick={() => onNeedContourChange(!needContour)}
                  >
                    <span>{needContour ? '描边已开启' : '开启描边'}</span>
                    <span className={styles.togglePill} aria-hidden>
                      <span className={styles.toggleKnob} />
                    </span>
                  </button>
                  <div className={styles.contourRow} title="描边宽度（px），颜色固定白色">
                    <span className={styles.contourLabel}>宽度</span>
                    <DragSlider
                      className={styles.contourRange}
                      min={IMAGE_CUTOUT_CONTOUR_SIZE_MIN}
                      max={IMAGE_CUTOUT_CONTOUR_SLIDER_MAX}
                      step={1}
                      value={contourSize}
                      disabled={!needContour}
                      ariaLabel="描边宽度"
                      ariaValueText={`${contourSize}px`}
                      testId="cutout-contour-size"
                      onChange={onContourSizeChange}
                      onKeyDown={onContourSliderKeyDown}
                    />
                    <span className={styles.contourValue}>{contourSize}px</span>
                  </div>
                </>
              }
            />

            <button
              type="button"
              role="switch"
              aria-checked={needCropBackground}
              className={`${styles.iconToggle} ${needCropBackground ? styles.iconToggleOn : ''}`}
              title="透明背景裁剪到刚好包裹主体"
              data-testid="cutout-crop-toggle"
              onClick={() => onNeedCropBackgroundChange(!needCropBackground)}
            >
              <Crop size={14} strokeWidth={2} />
            </button>
          </>
        )}

        <MediaToolQuoteBadge
          toolType="image_cutout"
          input={{}}
          variant="hint"
          testId="image-cutout-quote"
        />

        <button
          type="button"
          className={`${styles.sendBtn} ${!sendDisabledReason && !submitting ? styles.sendBtnActive : ''}`}
          onClick={guarded(!!sendDisabledReason || submitting, onSend)}
          disabled={!!sendDisabledReason || submitting}
          title={sendDisabledReason ?? (submitting ? '正在发送…' : '发送抠图')}
          data-testid="cutout-send-btn"
        >
          <ArrowUp size={14} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}
