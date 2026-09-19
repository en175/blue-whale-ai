/* ============================================
 * VideoSubtitleEraseDialog 去字幕编辑态工具条与发送条（IKGZ83，IKGZ7V 波3）：
 * 源视频卡上方浮出工具条（框选 /「全画面文字」开关 / 撤销 / 重做 / X），
 * 下方浮出发送条（本期免费 + 输出最高 1080P + 发送）。
 * 编辑状态（框集合/开关/发送中）提升在 CanvasPage（源视频卡内的
 * SubtitleEraseBoxesLayer 共用），本组件受控。发送不设独立一键钮——无框发送=
 * 智能模式（自动擦下半字幕）、有框=按框擦，「全画面文字」开关决定检测模式，
 * 一个发送动作统一两种语义（发送参数由 videoSubtitleErase.buildVideoSubtitleEraseInput 推导）。
 * data-gen-panel-territory 豁免点外关闭误杀；Esc/X/点其他卡/点空白退出由 CanvasPage 承载。
 * 容器视觉 = 浮层容器三令牌 + 24px 胶囊圆角（对齐 OutpaintDialog 统一后形态，
 * overlayContainer.test.ts 白名单锁定）。
 * ============================================ */
import { ArrowUp, Redo2, Square, Undo2, X } from 'lucide-react';
import type { FollowDialogAnchor } from '../../followDialog';
import styles from './index.module.css';

interface VideoSubtitleEraseDialogProps {
  /** X 关闭（四退出之一，未发送丢弃框与开关状态由父级处理） */
  onClose: () => void;
  /** 发送：由父级按「开关 + 框集合」推导参数（一个发送钮统一两种语义） */
  onSend: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 「全画面文字」开关（默认关）：开=检测范围扩大到全画面文字（顶部字幕的途径） */
  fullText: boolean;
  onFullTextChange: (enabled: boolean) => void;
  /** 检测框已达 20 个上限（框选钮置灰提示；拉新框由 CanvasPage toast 提示） */
  boxLimitReached: boolean;
  /** 发送中（创建请求飞行期防重复提交） */
  submitting?: boolean;
  toolbarAnchor: FollowDialogAnchor | null;
  sendBarAnchor: FollowDialogAnchor | null;
}

export default function VideoSubtitleEraseDialog({
  onClose,
  onSend,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  fullText,
  onFullTextChange,
  boxLimitReached,
  submitting,
  toolbarAnchor,
  sendBarAnchor,
}: VideoSubtitleEraseDialogProps) {
  const readOnly = submitting === true;

  /** 置灰守卫（口径同 ImageEraseDialog：aria-disabled + 点击守卫，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  const anchorStyle = (anchor: FollowDialogAnchor | null) =>
    anchor ? { left: anchor.left, top: anchor.top } : undefined;

  return (
    <>
      {/* 源视频卡上方工具条（跟随锚定时 inline left/top 覆盖默认位，translateX 保持以锚点居中） */}
      <div
        className={styles.toolbar}
        style={anchorStyle(toolbarAnchor)}
        data-gen-panel-territory
        data-testid="subtitle-erase-toolbar"
      >
        <button
          type="button"
          className={`${styles.toolBtn} ${styles.toolBtnActive}`}
          data-testid="subtitle-erase-tool-box"
          aria-pressed="true"
          disabled={readOnly || boxLimitReached}
          title={boxLimitReached ? '检测框已达 20 个上限，撤销后可再拉' : '框选：在画面上拉矩形框指定检测区域（最多 20 个）'}
        >
          <Square size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={fullText}
          className={`${styles.fullTextToggle} ${fullText ? styles.fullTextToggleOn : ''}`}
          data-testid="subtitle-erase-full-text-toggle"
          disabled={readOnly}
          title="全画面文字：检测范围从字幕扩大到全画面文字（人名条、标注等），擦顶部字幕需开此开关"
          onClick={guarded(readOnly, () => onFullTextChange(!fullText))}
        >
          <span className={styles.fullTextLabel}>全画面文字</span>
          <span className={styles.togglePill} aria-hidden>
            <span className={styles.toggleKnob} />
          </span>
        </button>
        <span className={styles.divider} />
        <button
          type="button"
          className={styles.toolBtn}
          data-testid="subtitle-erase-undo"
          disabled={!canUndo || readOnly}
          title={canUndo ? '撤销最近一个框' : '没有可撤销的操作'}
          onClick={guarded(!canUndo || readOnly, onUndo)}
        >
          <Undo2 size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={styles.toolBtn}
          data-testid="subtitle-erase-redo"
          disabled={!canRedo || readOnly}
          title={canRedo ? '重做最近撤销的框' : '没有可重做的操作'}
          onClick={guarded(!canRedo || readOnly, onRedo)}
        >
          <Redo2 size={14} strokeWidth={2} />
        </button>
        <span className={styles.divider} />
        <button
          type="button"
          className={styles.toolBtn}
          data-testid="subtitle-erase-close"
          title="退出智能去字幕（未发送的框与开关状态将被丢弃）"
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* 源视频卡下方发送条（跟随锚定时 inline left/top 生效，需解除默认 bottom 定位） */}
      <div
        className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
        style={anchorStyle(sendBarAnchor)}
        data-gen-panel-territory
        data-testid="subtitle-erase-send-bar"
      >
        <span className={styles.freeHint}>本期免费</span>
        <span className={styles.sendHint}>输出最高 1080P</span>
        <button
          type="button"
          className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
          data-testid="subtitle-erase-send-btn"
          disabled={readOnly}
          title={readOnly ? '正在发送，请稍候' : '发送去字幕任务（未拉框=自动擦下半字幕，拉框=只擦框内区域）'}
          onClick={guarded(readOnly, onSend)}
        >
          <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </>
  );
}
