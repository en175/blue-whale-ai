/* ============================================
 * FrameInterpolationDialog 视频插帧参数面板（IKHLKR）
 * 极简骨架（ADR-0113 复用 ADR-0105 口径）：标题 + 目标帧率三档分段（60fps 默认/30fps/120fps）
 * + 本期免费与发送钮；无供应商/模型两级下拉、无高级参数。
 * 跟随锚定在插帧卡下方；锚定/拖动跟随/点外关闭/Esc 关闭沿用既有面板约定
 * （关闭与领土豁免由 CanvasPage 的 dismissAllGenPanels / data-gen-panel-territory 承载）。
 * 帧率切换即时生效（经 onParamsChange 写卡持久化 lastParams 并同步草稿卡名）；发送经 onSend
 *  （IKHLKX 接线点：本票页面传入空实现，不建任务、不改卡态）；submitting/generating 飞行期
 * 只读防重复提交。
 * ============================================ */
import { useState } from 'react';
import { X, ArrowUp } from 'lucide-react';
import type { FollowDialogAnchor } from '../../followDialog';
import {
  FRAME_INTERPOLATION_DEFAULT_FPS,
  FRAME_INTERPOLATION_FPS_VALUES,
  FRAME_INTERPOLATION_SEND_HINT,
  frameInterpolationFpsLabel,
  type FrameInterpolationFps,
} from '../../frameInterpolation';
import styles from './index.module.css';

interface FrameInterpolationDialogProps {
  onClose: () => void;
  /** 发送（IKHLKX 接线点）：携带目标帧率；创建请求发出后父级关面板，失败面板保留 */
  onSend: (fps: FrameInterpolationFps) => boolean | Promise<boolean>;
  /** 帧率切换即时生效：父级写卡持久化 lastParams 与草稿卡名（关闭/重开/刷新恢复同源） */
  onParamsChange: (fps: FrameInterpolationFps) => void;
  /** 回填上次参数（node.data.frameInterpolation.lastParams 恢复；缺省用契约默认档 60fps） */
  initialFps?: FrameInterpolationFps | null;
  /** 生成中：参数只读冻结（保留查看；工具卡不开放取消） */
  generating?: boolean;
  /** 提交中（提交往返期间只读，同 HD 面板 submitting 口径） */
  submitting?: boolean;
  /** 绑定插帧卡时悬浮跟随其下方；缺省锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
}

export default function FrameInterpolationDialog({
  onClose,
  onSend,
  onParamsChange,
  initialFps,
  generating,
  submitting,
  followAnchor,
}: FrameInterpolationDialogProps) {
  const [fps, setFps] = useState<FrameInterpolationFps>(
    () => initialFps ?? FRAME_INTERPOLATION_DEFAULT_FPS,
  );

  const readOnly = generating === true || submitting === true;
  const readOnlyReason = generating
    ? '生成中，参数只读'
    : '正在保存并提交，参数只读';

  /** 可用态悬停为效果边界一句（「智能补帧，最高可至 120fps」，父单文案），只读态为只读原因 */
  const sendTitle = readOnly ? readOnlyReason : FRAME_INTERPOLATION_SEND_HINT;
  const canSend = !readOnly;

  /** 切换帧率：即时生效（本地态 + 父级写卡持久化 lastParams 与卡名），只读态冻结 */
  const handleFpsChange = (next: FrameInterpolationFps) => {
    if (readOnly || next === fps) return;
    setFps(next);
    onParamsChange(next);
  };

  /** 发送：父级按创建结果关面板/保留重发（IKHLKX 接线前为空实现，仅保留面板） */
  const handleSend = () => {
    if (!canSend) return;
    void Promise.resolve(onSend(fps));
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
      data-gen-panel-territory
      data-testid="frame-interpolation-dialog"
    >
      <div className={styles.dialog}>
        <div className={styles.headerRow}>
          <span className={styles.title}>视频插帧</span>
          <button type="button" className={styles.iconBtn} onClick={onClose} title="关闭" data-testid="frame-interpolation-close-btn">
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {readOnly && <div className={styles.readOnlyHint}>{readOnlyReason}</div>}

        {/* 目标帧率三档分段（契约枚举 30/60/120，默认 60；档位数值直传契约整型 fps） */}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>目标帧率</span>
          <div className={styles.fpsGroup}>
            {FRAME_INTERPOLATION_FPS_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.fpsBtn} ${value === fps ? styles.fpsBtnActive : ''}`}
                data-testid={`frame-interpolation-fps-${value}`}
                onClick={() => handleFpsChange(value)}
                disabled={readOnly}
              >
                {frameInterpolationFpsLabel(value)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.bottomBar}>
          <span className={styles.freeHint}>本期免费</span>
          <button
            type="button"
            className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!canSend}
            title={sendTitle}
            data-testid="frame-interpolation-send-btn"
          >
            <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
