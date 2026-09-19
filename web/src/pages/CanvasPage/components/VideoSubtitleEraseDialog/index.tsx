/* ============================================
 * VideoSubtitleEraseDialog 去字幕会话单条（IKGZ83 双条形态 → IKH3OU 单条化，ADR-0104）：
 * 源视频卡下方浮出唯一一条，形态随 mode 变化——
 *  - smart（智能擦除）：X | 智能擦除 | ⚡0 | ↑，零框选工具，点发送即提交（无框直发）；
 *  - box（框选擦除）：X | 框选擦除 | 框选 / 撤销 / 重做 | ⚡0 | ↑。
 * 模式由入口下拉菜单决定、会话内不互切（换模式 = X 退出后重选），「全画面文字」开关与
 * 上方工具条一并退役；发送参数由 videoSubtitleErase.buildVideoSubtitleEraseInput 推导
 * （detect_mode 两模式恒 subtitle_smart，erase_boxes 由框集合推导）。
 * 「输出最高 1080P」挪到发送钮 title；「本期免费」文字改 ⚡0 积分徽标（title 保留免费语义）。
 * data-gen-panel-territory 豁免点外关闭误杀；Esc/X/点其他卡/点空白退出由 CanvasPage 承载。
 * 容器视觉 = 浮层容器三令牌 + 24px 胶囊圆角（对齐 OutpaintDialog 统一后形态，
 * overlayContainer.test.ts 白名单锁定）。
 * ============================================ */
import { ArrowUp, Redo2, Square, Undo2, X, Zap } from 'lucide-react';
import type { FollowDialogAnchor } from '../../followDialog';
import type { VideoSubtitleEraseMode } from '../../videoSubtitleErase';
import styles from './index.module.css';

interface VideoSubtitleEraseDialogProps {
  /** 会话模式（入口下拉菜单定死，会话内不互切）：smart=零框选工具、box=拉框指定区域 */
  mode: VideoSubtitleEraseMode;
  /** X 关闭（四退出之一，未发送的框状态由父级丢弃） */
  onClose: () => void;
  /** 发送：由父级按框集合推导参数（detect_mode 两模式恒 subtitle_smart） */
  onSend: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 检测框已达 20 个上限（框选钮置灰提示；拉新框由 CanvasPage toast 提示） */
  boxLimitReached: boolean;
  /** 发送中（创建请求飞行期防重复提交） */
  submitting?: boolean;
  sendBarAnchor: FollowDialogAnchor | null;
}

export default function VideoSubtitleEraseDialog({
  mode,
  onClose,
  onSend,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  boxLimitReached,
  submitting,
  sendBarAnchor,
}: VideoSubtitleEraseDialogProps) {
  const readOnly = submitting === true;
  const boxMode = mode === 'box';

  /** 置灰守卫（口径同 ImageEraseDialog：aria-disabled + 点击守卫，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  const anchorStyle = (anchor: FollowDialogAnchor | null) =>
    anchor ? { left: anchor.left, top: anchor.top } : undefined;

  const sendTitle = readOnly
    ? '正在发送，请稍候'
    : boxMode
      ? '发送去字幕任务：擦除所拉检测框内的字幕（输出最高 1080P）'
      : '发送去字幕任务：自动擦除画面下半字幕（输出最高 1080P）';

  return (
    /* 源视频卡下方单条（跟随锚定时 inline left/top 生效，需解除默认 bottom 定位）。
       两模式共用同一容器：智能模式只留 X/标题/徽标/发送四元素，其余控件的位置
       由后票 IKH3OV 在框选模式补齐（？帮助、重置等）。 */
    <div
      className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
      style={anchorStyle(sendBarAnchor)}
      data-gen-panel-territory
      data-testid="subtitle-erase-send-bar"
    >
      <button
        type="button"
        className={styles.toolBtn}
        data-testid="subtitle-erase-close"
        title="退出去字幕（未发送的检测框将被丢弃）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.barTitle} data-testid="subtitle-erase-title">
        {boxMode ? '框选擦除' : '智能擦除'}
      </span>
      {boxMode && (
        <>
          <span className={styles.divider} />
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
        </>
      )}
      <span className={styles.divider} />
      <span className={styles.freeBadge} title="本期免费" data-testid="subtitle-erase-free-badge">
        <Zap size={12} strokeWidth={2} />
        <span>0</span>
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="subtitle-erase-send-btn"
        disabled={readOnly}
        title={sendTitle}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
