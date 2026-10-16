import { useRef } from 'react';
import { Brush, Eraser, Square, TypeOutline, Undo2, Redo2, X, ArrowUp } from 'lucide-react';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import type { MaskCoordinateSpace } from '../../tools/image/eraseMask';
import styles from './index.module.css';
import { type EraseTool } from '@/custom/enums';

export const ERASE_BRUSH_RADIUS_MIN = 6;
export const ERASE_BRUSH_RADIUS_MAX = 64;
export const ERASE_BRUSH_RADIUS_DEFAULT = 20;
const ERASE_BRUSH_RADIUS_STEP = 2;
const BRUSH_SLIDER_THUMB_SIZE = 12;

function snapBrushRadius(raw: number): number {
  const clamped = Math.min(ERASE_BRUSH_RADIUS_MAX, Math.max(ERASE_BRUSH_RADIUS_MIN, raw));
  const snapped =
    ERASE_BRUSH_RADIUS_MIN +
    Math.round((clamped - ERASE_BRUSH_RADIUS_MIN) / ERASE_BRUSH_RADIUS_STEP) * ERASE_BRUSH_RADIUS_STEP;
  return Math.min(ERASE_BRUSH_RADIUS_MAX, Math.max(ERASE_BRUSH_RADIUS_MIN, snapped));
}

function brushRadiusFromPointer(clientX: number, trackLeft: number, trackWidth: number): number {
  const thumbRadius = BRUSH_SLIDER_THUMB_SIZE / 2;
  const usableWidth = Math.max(trackWidth - BRUSH_SLIDER_THUMB_SIZE, 0);
  if (usableWidth <= 0) return ERASE_BRUSH_RADIUS_MIN;
  const ratio = Math.min(1, Math.max(0, (clientX - trackLeft - thumbRadius) / usableWidth));
  return snapBrushRadius(
    ERASE_BRUSH_RADIUS_MIN + ratio * (ERASE_BRUSH_RADIUS_MAX - ERASE_BRUSH_RADIUS_MIN),
  );
}

interface ImageEraseDialogProps {
  onClose: () => void;
  onSendTextErase: () => boolean;
  onSendMask: () => boolean;
  tool: EraseTool;
  onToolChange: (tool: EraseTool) => void;
  brushRadius: number;
  onBrushRadiusChange: (radius: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasPaint: boolean;
  maskSpace: MaskCoordinateSpace | null;
  submitting?: boolean;
  toolbarAnchor: FollowDialogAnchor | null;
  sendBarAnchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

const TOOL_ITEMS: Array<{ id: EraseTool; label: string; icon: typeof Brush; testId: string }> = [
  { id: 'brush', label: '画笔', icon: Brush, testId: 'erase-tool-brush' },
  { id: 'rect', label: '框选', icon: Square, testId: 'erase-tool-rect' },
  { id: 'eraser', label: '橡皮擦', icon: Eraser, testId: 'erase-tool-eraser' },
];

export default function ImageEraseDialog({
  onClose,
  onSendTextErase,
  onSendMask,
  tool,
  onToolChange,
  brushRadius,
  onBrushRadiusChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasPaint,
  maskSpace,
  submitting,
  toolbarAnchor,
  sendBarAnchor, dragHidden,
}: ImageEraseDialogProps) {
  const readOnly = submitting === true;
  const canSendMask = !readOnly && hasPaint && maskSpace !== null;
  const brushTrackRef = useRef<HTMLDivElement>(null);
  const brushRatio =
    (brushRadius - ERASE_BRUSH_RADIUS_MIN) / (ERASE_BRUSH_RADIUS_MAX - ERASE_BRUSH_RADIUS_MIN);
  const brushThumbOffset = `calc(${brushRatio} * (100% - ${BRUSH_SLIDER_THUMB_SIZE}px))`;
  const brushFillWidth = `calc(${brushRatio} * (100% - ${BRUSH_SLIDER_THUMB_SIZE}px) + ${BRUSH_SLIDER_THUMB_SIZE / 2}px)`;

  const applyBrushPointer = (clientX: number) => {
    const track = brushTrackRef.current;
    if (!track || readOnly) return;
    const rect = track.getBoundingClientRect();
    onBrushRadiusChange(brushRadiusFromPointer(clientX, rect.left, rect.width));
  };
  const sendDisabledReason = readOnly
    ? '正在发送，请稍候'
    : !hasPaint
      ? '请先用画笔涂抹或框选要擦除的区域'
      : maskSpace === null
        ? '源图分辨率未知，暂不能发送'
        : null;

  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  const handleSendMask = () => {
    if (!canSendMask || !maskSpace) return;
    onSendMask();
  };

  return (
    <>
      {}
      <div
        className={styles.toolbar}
        style={anchoredOverlayStyle(toolbarAnchor, dragHidden)}
        data-gen-panel-territory
        data-testid="erase-toolbar"
      >
        <span className={styles.title}>擦除</span>
        <button
          type="button"
          className={styles.clearTextBtn}
          data-testid="erase-clear-text"
          disabled={readOnly}
          title={readOnly ? '正在发送，请稍候' : '去掉图中所有文字，直接开始生成'}
          onClick={() => {
            if (readOnly) return;
            onSendTextErase();
          }}
        >
          <TypeOutline size={13} strokeWidth={2} />
          <span>清除文字</span>
        </button>
        <span className={styles.divider} />
        {TOOL_ITEMS.map(({ id, label, icon: Icon, testId }) => (
          <button
            key={id}
            type="button"
            className={`${styles.toolBtn} ${tool === id ? styles.toolBtnActive : ''}`}
            data-testid={testId}
            aria-pressed={tool === id}
            disabled={readOnly}
            title={label}
            onClick={guarded(readOnly, () => onToolChange(id))}
          >
            <Icon size={14} strokeWidth={2} />
          </button>
        ))}
        <label className={styles.brushRow} title="笔刷大小（画笔与橡皮共用）">
          <span className={styles.brushLabel}>笔刷</span>
          <div className={styles.brushSlider}>
            <input
              type="range"
              className={styles.brushRangeInput}
              data-testid="erase-brush-size"
              min={ERASE_BRUSH_RADIUS_MIN}
              max={ERASE_BRUSH_RADIUS_MAX}
              step={ERASE_BRUSH_RADIUS_STEP}
              value={brushRadius}
              disabled={readOnly}
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => onBrushRadiusChange(Number(event.target.value))}
            />
            <div
              ref={brushTrackRef}
              className={styles.brushHit}
              role="slider"
              tabIndex={readOnly ? -1 : 0}
              aria-label="笔刷大小"
              aria-valuemin={ERASE_BRUSH_RADIUS_MIN}
              aria-valuemax={ERASE_BRUSH_RADIUS_MAX}
              aria-valuenow={brushRadius}
              aria-disabled={readOnly}
              onPointerDown={(event) => {
                if (readOnly) return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                applyBrushPointer(event.clientX);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                applyBrushPointer(event.clientX);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onKeyDown={(event) => {
                if (readOnly) return;
                let next: number | null = null;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                  next = brushRadius - ERASE_BRUSH_RADIUS_STEP;
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
                  next = brushRadius + ERASE_BRUSH_RADIUS_STEP;
                } else if (event.key === 'Home') {
                  next = ERASE_BRUSH_RADIUS_MIN;
                } else if (event.key === 'End') {
                  next = ERASE_BRUSH_RADIUS_MAX;
                }
                if (next == null) return;
                event.preventDefault();
                onBrushRadiusChange(snapBrushRadius(next));
              }}
            >
              <div className={styles.brushTrack}>
                <div className={styles.brushFill} style={{ width: brushFillWidth }} />
                <div className={styles.brushThumb} style={{ left: brushThumbOffset }} />
              </div>
            </div>
          </div>
        </label>
        <span className={styles.divider} />
        <button
          type="button"
          className={styles.toolBtn}
          data-testid="erase-undo"
          disabled={!canUndo || readOnly}
          title={canUndo ? '撤销最近一笔' : '没有可撤销的操作'}
          onClick={guarded(!canUndo || readOnly, onUndo)}
        >
          <Undo2 size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          data-testid="erase-redo"
          disabled={!canRedo || readOnly}
          title={canRedo ? '重做最近撤销的一笔' : '没有可重做的操作'}
          onClick={guarded(!canRedo || readOnly, onRedo)}
        >
          <Redo2 size={14} strokeWidth={2} />
        </button>
        <span className={styles.divider} />
        <button
          type="button"
          className={styles.toolBtn}
          data-testid="erase-close"
          title="退出擦除（未发送的涂抹将被丢弃）"
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {}
      <div
        className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
        style={anchoredOverlayStyle(sendBarAnchor, dragHidden)}
        data-gen-panel-territory
        data-testid="erase-send-bar"
      >
        <span className={styles.freeHint}>本期免费</span>
        <span className={styles.sendHint}>涂抹或框选区域后发送{readOnly ? '…' : ''}</span>
        <button
          type="button"
          className={`${styles.sendBtn} ${canSendMask ? styles.sendBtnActive : ''}`}
          data-testid="erase-send-btn"
          disabled={!canSendMask}
          title={sendDisabledReason ?? '发送擦除任务'}
          onClick={() => {
            void handleSendMask();
          }}
        >
          <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </>
  );
}
