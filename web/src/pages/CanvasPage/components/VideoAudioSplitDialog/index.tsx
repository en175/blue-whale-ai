/* ============================================
 * VideoAudioSplitDialog 音视频分离编辑态单条（IKH28U 骨架 / IKH28X 三要素）：
 * 源视频卡下方浮出唯一一条，X 关闭在最左（先例同抠图 CutoutToolbar 与去字幕
 * IKH3OU 单条化——上方仅 X 退出的独立工具条随单条化退役；本工具无画布操作，
 * 无框选/开关/撤销重做）：X | 分隔线 | 分离格式下拉 + 「本期免费」标注 + 发送
 * 按钮（音频无分辨率降级概念，不带去字幕的「输出最高 1080P」后缀）。格式下拉
 * 触发钮显示当前所选格式（受控，状态提升在 CanvasPage；m4a 默认、格式不跨会话
 * 记忆——进入编辑态重置、退出复位）。
 * 编辑会话状态提升在 CanvasPage，本组件受控；发送按当前所选格式建任务（发送闭环由
 * 父级承担）。视频暂停在当前帧与播放控制锁定由 MediaNode 的 splitEditing 注入承担
 * （透明锁定层接管指针）。data-gen-panel-territory 豁免点外关闭误杀；Esc/X/点其他卡/
 * 点空白退出由 CanvasPage 承载，未发送退出不建任务不建卡。容器视觉 = 浮层容器三令牌
 * + 24px 胶囊圆角（对齐去字幕家族形态，overlayContainer.test.ts 白名单锁定；格式菜单
 * 浮层入 IKGZ8C 浮层菜单家族 12px 档）。
 * ============================================ */
import { useRef, useState } from 'react';
import { ArrowUp, ChevronDown, X } from 'lucide-react';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { AUDIO_VIDEO_SPLIT_FORMATS, type AudioVideoSplitFormat } from '../../audioVideoSplit';
import styles from './index.module.css';

interface VideoAudioSplitDialogProps {
  /** X 关闭（四退出之一，未发送退出不建任务不建卡由父级处理） */
  onClose: () => void;
  /** 当前所选分离格式（受控：m4a 默认，切换即派发父级；展示用大写） */
  format: AudioVideoSplitFormat;
  onFormatChange: (format: AudioVideoSplitFormat) => void;
  /** 发送：父级按当前所选格式建任务（发送即退编辑态再建卡） */
  onSend: () => void;
  /** 发送中（创建请求飞行期防重复提交） */
  submitting?: boolean;
  /** 源视频卡下方单条跟随锚（IKH25A 中心点锚：left=源卡中心 x，缺省锚定底部） */
  sendBarAnchor: FollowDialogAnchor | null;
  /** IKJR9J 拖拽隐藏：锚定卡被拖时 visibility 级隐藏（不卸载） */
  dragHidden?: boolean;
}

export default function VideoAudioSplitDialog({
  onClose,
  format,
  onFormatChange,
  onSend,
  submitting,
  sendBarAnchor, dragHidden,
}: VideoAudioSplitDialogProps) {
  const readOnly = submitting === true;

  /** 格式下拉展开态（本地 UI 态：选择/点外关闭即收起，随浮条卸载丢弃） */
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const formatWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside([
    { open: formatMenuOpen, ref: formatWrapRef, dismiss: () => setFormatMenuOpen(false) },
  ]);

  /** 置灰守卫（口径同 VideoSubtitleEraseDialog：aria-disabled 由 disabled 承担，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    /* 源视频卡下方单条（跟随锚定时 inline left/top 生效，需解除默认 bottom 定位）。
       X 关闭在最左（对齐抠图/去字幕单条先例），后接分隔线与格式下拉三要素。 */
    <div
      className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
      style={anchoredOverlayStyle(sendBarAnchor, dragHidden)}
      data-gen-panel-territory
      data-testid="audio-video-split-send-bar"
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
      <span className={styles.divider} aria-hidden />

      {/* 分离格式下拉（触发钮显当前格式；发送条在卡下方，菜单向上弹出） */}
      <div className={styles.formatWrap} ref={formatWrapRef}>
        <button
          type="button"
          className={styles.formatTrigger}
          data-testid="audio-video-split-format-trigger"
          aria-haspopup="menu"
          aria-expanded={formatMenuOpen || undefined}
          disabled={readOnly}
          title="选择音频输出格式（产物文件名后缀跟随所选格式）"
          onClick={guarded(readOnly, () => setFormatMenuOpen((open) => !open))}
        >
          <span>{format.toUpperCase()}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
        {formatMenuOpen && (
          <div
            className={styles.formatMenu}
            role="menu"
            data-testid="audio-video-split-format-menu"
          >
            {AUDIO_VIDEO_SPLIT_FORMATS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === format}
                className={`${styles.formatMenuItem} ${item === format ? styles.formatMenuItemActive : ''}`}
                data-testid={`audio-video-split-format-item-${item}`}
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
        data-testid="audio-video-split-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '发送音视频分离任务'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
