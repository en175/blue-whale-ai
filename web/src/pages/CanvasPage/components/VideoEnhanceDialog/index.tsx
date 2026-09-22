/* ============================================
 * VideoEnhanceDialog 视频 HD 高清参数面板（IKH3VG）
 * 极简骨架（ADR-0105）：标题 + 目标分辨率三档分段（1080P 默认/2K/4K）+ 本期免费与发送钮；
 * 无供应商/模型两级下拉、无高级参数（那是图片高清面板骨架，视频侧已裁撤）。
 * 跟随锚定在 HD 卡下方；锚定/拖动跟随/点外关闭/Esc 关闭沿用既有面板约定
 * （关闭与领土豁免由 CanvasPage 的 dismissAllGenPanels / data-gen-panel-territory 承载）。
 * 分辨率切换即时生效（经 onParamsChange 写卡持久化 lastParams）；发送经 onSend 调创建端点
 * （IKH3VH：创建成功父级关面板、失败面板保留，submitting 飞行期只读防重复提交）。
 * ============================================ */
import { useState } from 'react';
import { X, ArrowUp } from 'lucide-react';
import { VIDEO_ENHANCE_RESOLUTIONS, type VideoEnhanceResolution } from '@lib/contracts/video-enhance';
import { VIDEO_ENHANCE_RESOLUTION_LABELS } from '../../videoEnhance';
import type { FollowDialogAnchor } from '../../followDialog';
import styles from './index.module.css';

interface VideoEnhanceDialogProps {
  onClose: () => void;
  /** 发送：携带目标分辨率；创建请求发出后父级关面板，失败面板保留（返回值仅供类型兼容） */
  onSend: (resolution: VideoEnhanceResolution) => boolean | Promise<boolean>;
  /** 分辨率切换即时生效：父级写卡持久化 lastParams（关闭/重开/重新编辑恢复同源） */
  onParamsChange: (resolution: VideoEnhanceResolution) => void;
  /** 回填上次参数（node.data.videoEnhance.lastParams 恢复；缺省用契约默认档 1080P） */
  initialResolution?: VideoEnhanceResolution | null;
  /** 生成中：参数只读冻结（保留查看；工具卡不开放取消） */
  generating?: boolean;
  /** 提交中（保存/提交期间只读，同图片面板 submitting 口径） */
  submitting?: boolean;
  /** 绑定 HD 卡时悬浮跟随其下方；缺省锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
}

export default function VideoEnhanceDialog({
  onClose,
  onSend,
  onParamsChange,
  initialResolution,
  generating,
  submitting,
  followAnchor,
}: VideoEnhanceDialogProps) {
  const [resolution, setResolution] = useState<VideoEnhanceResolution>(
    () => initialResolution ?? VIDEO_ENHANCE_RESOLUTIONS[0],
  );

  const readOnly = generating === true || submitting === true;
  const readOnlyReason = generating
    ? '生成中，参数只读'
    : '正在保存并提交，参数只读';

  /** 可用态悬停为效果边界一句（「最高可至 4K」，词条口径），只读态为只读原因（同一 title 通道） */
  const sendTitle = readOnly ? readOnlyReason : '最高可至 4K';
  const canSend = !readOnly;

  /** 切换分辨率：即时生效（本地态 + 父级写卡持久化 lastParams），只读态冻结 */
  const handleResolutionChange = (next: VideoEnhanceResolution) => {
    if (readOnly || next === resolution) return;
    setResolution(next);
    onParamsChange(next);
  };

  /** 发送：父级按创建结果关面板/保留重发；发送钮悬停见 sendTitle */
  const handleSend = () => {
    if (!canSend) return;
    void Promise.resolve(onSend(resolution));
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
      data-gen-panel-territory
      data-testid="video-enhance-dialog"
    >
      <div className={styles.dialog}>
        <div className={styles.headerRow}>
          <span className={styles.title}>HD 高清</span>
          <button type="button" className={styles.iconBtn} onClick={onClose} title="关闭" data-testid="video-enhance-close-btn">
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {readOnly && <div className={styles.readOnlyHint}>{readOnlyReason}</div>}

        {/* 目标分辨率三档分段（1080P 默认/2K/4K；契约枚举 1080p/2k/4k，720p 已裁撤 ADR-0105） */}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>目标分辨率</span>
          <div className={styles.resolutionGroup}>
            {VIDEO_ENHANCE_RESOLUTIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`${styles.resolutionBtn} ${value === resolution ? styles.resolutionBtnActive : ''}`}
                data-testid={`video-enhance-resolution-${value}`}
                onClick={() => handleResolutionChange(value)}
                disabled={readOnly}
              >
                {VIDEO_ENHANCE_RESOLUTION_LABELS[value]}
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
            data-testid="video-enhance-send-btn"
          >
            <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
