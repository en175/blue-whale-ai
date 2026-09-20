/* ============================================
 * AudioTrimBar 截取编辑态发送条（IKHB7A，父单 IKHB08）：钉屏幕浮层 24px 胶囊家族
 * 单条（仿 VideoAudioSplitDialog 家族形态）。条内五要素：X 退出、「截取」标题、
 * 时间范围只读实时刷新（mm:ss）、格式下拉五档（默认跟随源格式、源格式不在枚举
 * 回退 m4a、进入编辑态重置不跨会话记忆——推导在契约 defaultAudioTrimOutputFormat，
 * 受控状态提升在 CanvasPage；触发钮显当前格式，菜单向上弹）、⚡0「本期免费」徽标
 * （免费口径同分离/高清家族：无幂等头、无积分预估）、ArrowUp 家族发送钮。
 * 无格式说明文字（ADR-0111 走查拍板已删）。发送按当前所选格式与选区建任务（发送
 * 闭环由父级承担）；X/Esc/点其他卡/点画布空白四路退出未发送不建任务不建卡。
 * ============================================ */
import { useRef, useState } from 'react';
import { ArrowUp, ChevronDown, X, Zap } from 'lucide-react';
import type { FollowDialogAnchor } from '../../followDialog';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { AUDIO_TRIM_FORMATS, type AudioTrimFormat } from '../../audioTrim';
import { audioTrimRangeLabel } from '../../audioTrimGeometry';
import styles from './index.module.css';

interface AudioTrimBarProps {
  /** X 关闭（四退出之一，未发送退出不建任务不建卡由父级处理） */
  onClose: () => void;
  /** 选区起止（秒，受控实时刷新：抓手拖拽联动时间范围显示） */
  start: number;
  end: number;
  /** 当前所选输出格式（受控：默认跟随源格式，切换即派发父级；展示用小写对齐原型） */
  format: AudioTrimFormat;
  onFormatChange: (format: AudioTrimFormat) => void;
  /** 发送：父级按当前选区与格式建任务（发送即退编辑态再建卡） */
  onSend: () => void;
  /** 发送中（创建请求飞行期防重复提交） */
  submitting?: boolean;
  anchor: FollowDialogAnchor | null;
}

export default function AudioTrimBar({
  onClose,
  start,
  end,
  format,
  onFormatChange,
  onSend,
  submitting,
  anchor,
}: AudioTrimBarProps) {
  const readOnly = submitting === true;

  /** 格式下拉展开态（本地 UI 态：选择/点外关闭即收起，随浮条卸载丢弃） */
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const formatWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside([
    { open: formatMenuOpen, ref: formatWrapRef, dismiss: () => setFormatMenuOpen(false) },
  ]);

  /** 置灰守卫（口径同 VideoAudioSplitDialog：aria-disabled 由 disabled 承担，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    <div
      className={`${styles.sendBar} ${anchor ? styles.sendBarFollow : ''}`}
      style={anchor ? { left: anchor.left, top: anchor.top } : undefined}
      data-gen-panel-territory
      data-testid="audio-trim-send-bar"
    >
      <button
        type="button"
        className={styles.closeBtn}
        data-testid="audio-trim-close"
        title="退出截取（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.title}>截取</span>
      <span className={styles.range} data-testid="audio-trim-range">
        {audioTrimRangeLabel({ start, end })}
      </span>
      {/* 格式下拉（触发钮显当前格式；发送条在卡下方，菜单向上弹出） */}
      <div className={styles.formatWrap} ref={formatWrapRef}>
        <button
          type="button"
          className={styles.formatTrigger}
          data-testid="audio-trim-format-trigger"
          aria-haspopup="menu"
          aria-expanded={formatMenuOpen || undefined}
          disabled={readOnly}
          title="选择输出格式（默认跟随源音频格式）"
          onClick={guarded(readOnly, () => setFormatMenuOpen((open) => !open))}
        >
          <span>{format}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
        {formatMenuOpen && (
          <div className={styles.formatMenu} role="menu" data-testid="audio-trim-format-menu">
            {AUDIO_TRIM_FORMATS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === format}
                className={`${styles.formatMenuItem} ${item === format ? styles.formatMenuItemActive : ''}`}
                data-testid={`audio-trim-format-item-${item}`}
                onClick={() => {
                  onFormatChange(item);
                  setFormatMenuOpen(false);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* ⚡0 本期免费徽标（对客免费口径，ADR-0111） */}
      <span className={styles.free} title="本期免费" data-testid="audio-trim-free">
        <Zap size={11} fill="currentColor" strokeWidth={0} />
        0
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="audio-trim-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '生成截取音频'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
