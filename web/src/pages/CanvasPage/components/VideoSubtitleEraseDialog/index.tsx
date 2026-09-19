/* ============================================
 * VideoSubtitleEraseDialog 去字幕会话单条（IKGZ83 双条形态 → IKH3OU 单条化 → IKH3OV 补齐框选控件，ADR-0104）：
 * 源视频卡下方浮出唯一一条，形态随 mode 变化——
 *  - smart（智能擦除）：X | 智能擦除 | ⚡0 | ↑，零框选工具，点发送即提交（无框直发）；
 *  - box（框选擦除）：X | 框选擦除 ？ | 框选 / 撤销 / 重做 / 重置 | ⚡0 | ↑。
 * 框选模式的必框语义由父级经 sendBlockedReason 传入（非空即发送钮置灰并用它作 title）；
 * 重置=一键清空全部框且一步可撤销（纯逻辑 subtitleEraseBoxes.resetSubtitleBoxEdit）。
 * 模式由入口下拉菜单决定、会话内不互切（换模式 = X 退出后重选），「全画面文字」开关与
 * 上方工具条一并退役；发送参数由 videoSubtitleErase.buildVideoSubtitleEraseInput 推导
 * （detect_mode 两模式恒 subtitle_smart，erase_boxes 由框集合推导）。
 * 「输出最高 1080P」挪到发送钮 title；「本期免费」文字改 ⚡0 积分徽标（title 保留免费语义）。
 * data-gen-panel-territory 豁免点外关闭误杀；Esc/X/点其他卡/点空白退出由 CanvasPage 承载。
 * 容器视觉 = 浮层容器三令牌 + 24px 胶囊圆角（对齐 OutpaintDialog 统一后形态，
 * overlayContainer.test.ts 白名单锁定）。
 * ============================================ */
import { ArrowUp, HelpCircle, Redo2, RotateCcw, Square, Undo2, X, Zap } from 'lucide-react';
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
  /** 还有框可清空（重置钮置灰条件；显式传参——重置后 boxes 为空但仍有可撤销的 reset 步骤） */
  canReset: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 重置：一键清空全部检测框（一步可撤销，由父级压 undo 栈） */
  onReset: () => void;
  /** 检测框已达 20 个上限（框选钮置灰提示；拉新框由 CanvasPage toast 提示） */
  boxLimitReached: boolean;
  /** 发送中（创建请求飞行期防重复提交） */
  submitting?: boolean;
  /** 发送被拦原因（框选模式无框时非空）：非空即置灰发送钮并把原因作 title，不回落智能语义；
   *  智能模式恒 null（无框直发） */
  sendBlockedReason: string | null;
  sendBarAnchor: FollowDialogAnchor | null;
}

export default function VideoSubtitleEraseDialog({
  mode,
  onClose,
  onSend,
  canUndo,
  canRedo,
  canReset,
  onUndo,
  onRedo,
  onReset,
  boxLimitReached,
  submitting,
  sendBlockedReason,
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

  /** 发送置灰两个来源：请求飞行中或父级判定不可发（框选模式无框）；可发态 title 带输出规格 */
  const sendDisabled = readOnly || sendBlockedReason != null;
  const sendTitle = readOnly
    ? '正在发送，请稍候'
    : sendBlockedReason
      ?? (boxMode
        ? '发送去字幕任务：擦除所拉检测框内的字幕（输出最高 1080P）'
        : '发送去字幕任务：自动擦除画面下半字幕（输出最高 1080P）');

  return (
    /* 源视频卡下方单条（跟随锚定时 inline left/top 生效，需解除默认 bottom 定位）。
       两模式共用同一容器：智能模式只留 X/标题/徽标/发送四元素，框选模式在标题后补齐
       ？帮助与框选/撤销/重做/重置四控件（IKH3OV）。 */
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
          {/* ？帮助：紧跟标题之后的无交互元素，title 讲清框与擦除范围的关系（规格故事 19） */}
          <span
            className={styles.helpHint}
            data-testid="subtitle-erase-help"
            title="拉框圈出要擦除的字幕区域：框内文字被无痕擦除，检测框对全片生效，最多 20 个"
          >
            <HelpCircle size={14} strokeWidth={2} />
          </span>
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
            title={canUndo ? '撤销最近一步（落框或重置）' : '没有可撤销的操作'}
            onClick={guarded(!canUndo || readOnly, onUndo)}
          >
            <Undo2 size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            data-testid="subtitle-erase-redo"
            disabled={!canRedo || readOnly}
            title={canRedo ? '重做最近一步（落框或重置）' : '没有可重做的操作'}
            onClick={guarded(!canRedo || readOnly, onRedo)}
          >
            <Redo2 size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            data-testid="subtitle-erase-reset"
            disabled={!canReset || readOnly}
            title={canReset ? '清空全部检测框（可撤销）' : '没有可清空的检测框'}
            onClick={guarded(!canReset || readOnly, onReset)}
          >
            <RotateCcw size={14} strokeWidth={2} />
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
        className={`${styles.sendBtn} ${!sendDisabled ? styles.sendBtnActive : ''}`}
        data-testid="subtitle-erase-send-btn"
        disabled={sendDisabled}
        title={sendTitle}
        onClick={guarded(sendDisabled, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
