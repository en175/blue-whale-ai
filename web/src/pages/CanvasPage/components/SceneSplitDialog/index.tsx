/* ============================================
 * SceneSplitDialog 场景切分会话单条（IKH8BR）：
 * 源视频卡下方浮出唯一一条，形态对齐去字幕单条家族（24px 胶囊，控件次序自左至右）：
 *   X | 场景切分 | 粒度三档分段控件（细 / 标准 / 粗） | ⚡0 | ↑发送。
 * 粒度受控（状态提升在 CanvasPage；standard 默认、不跨会话记忆——进入编辑态重置、
 * 退出复位）；发送按当前所选粒度建任务（发送即先退会话再建占位卡，闭环由父级承担）。
 * 源视频暂停在当前帧与播放控制锁定由 MediaNode 的 splitEditing 注入承担（透明锁定层
 * 接管指针）。data-gen-panel-territory 豁免点外关闭误杀；Esc/X/点其他卡/点空白退出由
 * CanvasPage 承载，未发送退出不建任务不建卡。容器视觉 = 浮层容器三令牌 + 24px 胶囊
 * 圆角（对齐去字幕家族形态，overlayContainer.test.ts 白名单锁定）。
 * ============================================ */
import { ArrowUp, X, Zap } from 'lucide-react';
import type { FollowDialogAnchor } from '../../followDialog';
import {
  SCENE_SPLIT_GRANULARITIES,
  SCENE_SPLIT_GRANULARITY_LABELS,
  type SceneSplitGranularity,
} from '../../sceneSplit';
import styles from './index.module.css';

interface SceneSplitDialogProps {
  /** X 关闭（四退出之一，未发送退出不建任务不建卡由父级处理） */
  onClose: () => void;
  /** 当前所选切分粒度（受控：standard 默认，切换即派发父级） */
  granularity: SceneSplitGranularity;
  onGranularityChange: (granularity: SceneSplitGranularity) => void;
  /** 发送：父级按当前所选粒度建任务（发送即退会话再建占位卡） */
  onSend: () => void;
  /** 发送中（创建请求飞行期防重复提交） */
  submitting?: boolean;
  sendBarAnchor: FollowDialogAnchor | null;
}

export default function SceneSplitDialog({
  onClose,
  granularity,
  onGranularityChange,
  onSend,
  submitting,
  sendBarAnchor,
}: SceneSplitDialogProps) {
  const readOnly = submitting === true;

  /** 置灰守卫（口径同 VideoSubtitleEraseDialog：disabled 承担 aria，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  const anchorStyle = (anchor: FollowDialogAnchor | null) =>
    anchor ? { left: anchor.left, top: anchor.top } : undefined;

  return (
    /* 源视频卡下方单条（跟随锚定时 inline left/top 生效，需解除默认 bottom 定位） */
    <div
      className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
      style={anchorStyle(sendBarAnchor)}
      data-gen-panel-territory
      data-testid="scene-split-send-bar"
    >
      <button
        type="button"
        className={styles.toolBtn}
        data-testid="scene-split-close"
        title="退出场景切分（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.barTitle} data-testid="scene-split-title">
        场景切分
      </span>
      {/* 粒度三档分段控件（细 / 标准 / 粗，细=切得更碎、粗=切得更粗略；title 讲清档位语义） */}
      <div className={styles.segmentGroup} role="radiogroup" aria-label="切分粒度" data-testid="scene-split-granularity">
        {SCENE_SPLIT_GRANULARITIES.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={item === granularity}
            className={`${styles.segmentBtn} ${item === granularity ? styles.segmentBtnActive : ''}`}
            data-testid={`scene-split-granularity-${item}`}
            disabled={readOnly}
            title={
              item === 'fine'
                ? '细：切得更碎，片段更多'
                : item === 'coarse'
                  ? '粗：忽略不显著的场景变化，片段更少'
                  : '标准：官方推荐粒度'
            }
            onClick={guarded(readOnly, () => onGranularityChange(item))}
          >
            {SCENE_SPLIT_GRANULARITY_LABELS[item]}
          </button>
        ))}
      </div>
      <span className={styles.freeBadge} title="本期免费" data-testid="scene-split-free-badge">
        <Zap size={12} strokeWidth={2} />
        <span>0</span>
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="scene-split-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '发送场景切分任务'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
