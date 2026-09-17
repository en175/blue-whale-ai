/* ============================================
 * ImageEraseDialog 擦除编辑态工具条与发送条（IKGOTB，IKGOSZ 波3）：
 * 源图卡上方浮出工具条（清除文字一键直发 / 画笔 / 框选 / 橡皮擦 / 笔刷大小 / 撤销重做 / X），
 * 下方浮出窄发送条（本期免费 + 发送）。
 * 编辑状态（工具/笔刷/遮罩 ops）提升在 CanvasPage（源图卡内的 EraseMaskLayer 共用），本组件受控。
 * 涂抹发送在组件内栅格化遮罩 PNG（rasterizeMaskToPngFile）后交父级上传建任务；
 * 「清除文字」不经遮罩直接上抛（规格：两条发送路径共用同一条任务链路）。
 * data-gen-panel-territory 豁免点外关闭误杀；Esc/X/点其他卡/点空白退出由 CanvasPage 承载。
 * ============================================ */
import { Brush, Eraser, Square, TypeOutline, Undo2, Redo2, X, ArrowUp } from 'lucide-react';
import type { FollowDialogAnchor } from '../../followDialog';
import type { MaskCoordinateSpace, MaskOp } from '../../eraseMask';
import { rasterizeMaskToPngFile } from '../../imageErase';
import styles from './index.module.css';

/** 擦除编辑工具（三选一互斥）：画笔涂抹 / 矩形框选 / 橡皮擦（从并集减去） */
export type EraseTool = 'brush' | 'rect' | 'eraser';

/** 笔刷半径范围（显示坐标像素）：滑杆可调 min~max，默认值 */
export const ERASE_BRUSH_RADIUS_MIN = 6;
export const ERASE_BRUSH_RADIUS_MAX = 64;
export const ERASE_BRUSH_RADIUS_DEFAULT = 20;

interface ImageEraseDialogProps {
  /** X 关闭（四退出之一，未发送丢弃遮罩由父级处理） */
  onClose: () => void;
  /** 「清除文字」一键直发：返回 true 表示创建请求已发出（父级据此退出编辑态） */
  onSendTextErase: () => boolean;
  /** 涂抹发送：组件栅格化 ops 成黑白遮罩 PNG 后上抛（File 为 null 表示栅格化失败）；
   *  resolve true 表示创建请求已发出（父级据此退出编辑态） */
  onSendMask: (file: File | null) => Promise<boolean>;
  tool: EraseTool;
  onToolChange: (tool: EraseTool) => void;
  brushRadius: number;
  onBrushRadiusChange: (radius: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 存在有效涂区（发送门） */
  hasPaint: boolean;
  /** 坐标空间（显示尺寸×源图自然分辨率）；null=源图自然分辨率缺失，涂抹发送禁用 */
  maskSpace: MaskCoordinateSpace | null;
  /** 已固化图元（栅格化输入；活笔不参与发送，pointerup 已并入） */
  ops: readonly MaskOp[];
  /** 发送中（遮罩上传/创建请求期间只读防重复提交） */
  submitting?: boolean;
  toolbarAnchor: FollowDialogAnchor | null;
  sendBarAnchor: FollowDialogAnchor | null;
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
  ops,
  submitting,
  toolbarAnchor,
  sendBarAnchor,
}: ImageEraseDialogProps) {
  const readOnly = submitting === true;
  const canSendMask = !readOnly && hasPaint && maskSpace !== null;
  const sendDisabledReason = readOnly
    ? '正在发送，请稍候'
    : !hasPaint
      ? '请先用画笔涂抹或框选要擦除的区域'
      : maskSpace === null
        ? '源图分辨率未知，暂不能发送'
        : null;

  /** 置灰守卫（口径同 ImageEnhanceDialog：aria-disabled + 点击守卫，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  const handleSendMask = async () => {
    if (!canSendMask || !maskSpace) return;
    const file = await rasterizeMaskToPngFile(ops, maskSpace);
    await onSendMask(file);
  };

  const anchorStyle = (anchor: FollowDialogAnchor | null) =>
    anchor ? { left: anchor.left, top: anchor.top } : undefined;

  return (
    <>
      {/* 源图卡上方工具条（跟随锚定时 inline left/top 覆盖默认位，translateX 保持以锚点居中） */}
      <div
        className={styles.toolbar}
        style={anchorStyle(toolbarAnchor)}
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
          <input
            type="range"
            data-testid="erase-brush-size"
            min={ERASE_BRUSH_RADIUS_MIN}
            max={ERASE_BRUSH_RADIUS_MAX}
            step={2}
            value={brushRadius}
            disabled={readOnly}
            onChange={(event) => onBrushRadiusChange(Number(event.target.value))}
          />
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

      {/* 源图卡下方发送条（跟随锚定时 inline left/top 生效，需解除默认 bottom 定位） */}
      <div
        className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
        style={anchorStyle(sendBarAnchor)}
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
