/* ============================================
 * VideoAudioSplitDialog 音视频分离编辑态工具条与占位发送条（IKH28U）：
 * 源视频卡上方浮出工具条（仅 X 退出——本工具无画布操作，无框选/开关/撤销重做），
 * 下方浮出发送条（本票为占位态：分离格式下拉、「本期免费」标注与发送按钮及发送闭环
 * 归 IKH28X，此条先立家族形态）。
 * 编辑会话状态提升在 CanvasPage，本组件受控；视频暂停在当前帧与播放控制锁定由
 * MediaNode 的 splitEditing 注入承担（透明锁定层接管指针）。data-gen-panel-territory
 * 豁免点外关闭误杀；Esc/X/点其他卡/点空白退出由 CanvasPage 承载，未发送退出
 * 不建任务不建卡。容器视觉 = 浮层容器三令牌 + 24px 胶囊圆角（对齐去字幕家族形态，
 * overlayContainer.test.ts 白名单锁定）。
 * ============================================ */
import { X } from 'lucide-react';
import type { FollowDialogAnchor } from '../../followDialog';
import styles from './index.module.css';

interface VideoAudioSplitDialogProps {
  /** X 关闭（四退出之一，未发送退出不建任务不建卡由父级处理） */
  onClose: () => void;
  toolbarAnchor: FollowDialogAnchor | null;
  sendBarAnchor: FollowDialogAnchor | null;
}

export default function VideoAudioSplitDialog({
  onClose,
  toolbarAnchor,
  sendBarAnchor,
}: VideoAudioSplitDialogProps) {
  const anchorStyle = (anchor: FollowDialogAnchor | null) =>
    anchor ? { left: anchor.left, top: anchor.top } : undefined;

  return (
    <>
      {/* 源视频卡上方工具条（跟随锚定时 inline left/top 覆盖默认位，translateX 保持以锚点居中） */}
      <div
        className={styles.toolbar}
        style={anchorStyle(toolbarAnchor)}
        data-gen-panel-territory
        data-testid="audio-video-split-toolbar"
      >
        <button
          type="button"
          className={styles.toolBtn}
          data-testid="audio-video-split-close"
          title="退出音视频分离（未发送不建任务不建卡）"
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      {/* 源视频卡下方发送条（占位态，IKH28U）：三要素（分离格式下拉/本期免费/发送）
          与发送闭环归 IKH28X，此条先立去字幕家族形态占位 */}
      <div
        className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
        style={anchorStyle(sendBarAnchor)}
        data-gen-panel-territory
        data-testid="audio-video-split-send-bar"
      >
        <span className={styles.placeholderHint}>发送功能即将可用</span>
      </div>
    </>
  );
}
