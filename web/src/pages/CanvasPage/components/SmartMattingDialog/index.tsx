/* ============================================
 * SmartMattingDialog 智能抠像编辑态单条（IKHK9N，ADR-0112）：
 * 源视频卡下方浮出唯一一条，形态对齐场景切分/去字幕单条家族（24px 胶囊，控件次序
 * 自左至右）：X | 模式标题（人像抠像/绿幕抠像，跟随入口下拉所选模式——单条内无模式
 * 切换控件，换模式 = 退出后从入口菜单重选）| 输出格式下拉（WEBM 透明默认 / MP4 纯色，
 * 点击展开向上弹、激活项主色蓝底白字，同构音视频分离格式菜单）| 背景色分段控件
 * （白色默认/黑色/绿色，同构场景切分粒度分段；仅 MP4 显示——WEBM 透明无背景色）|
 * ⚡0 徽标 | ↑发送。
 * 格式与背景色受控（状态提升在 CanvasPage；每次进入编辑态重置 WEBM+白色、不跨会话
 * 记忆）；发送按当前参数建任务（发送即先退会话再建占位卡，闭环由父级承担）。源视频
 * 暂停在当前帧与播放控制锁定由 MediaNode 的 splitEditing 注入承担（透明锁定层接管
 * 指针）。data-gen-panel-territory 豁免点外关闭误杀；Esc/X/点其他卡/点空白退出由
 * CanvasPage 承载，未发送退出不建任务不建卡。容器视觉 = 浮层容器三令牌 + 24px 胶囊
 * 圆角（对齐去字幕家族形态，overlayContainer.test.ts 白名单锁定；格式菜单浮层入
 * IKGZ8C 浮层菜单家族 12px 档）。
 * ============================================ */
import { useRef, useState } from 'react';
import { ArrowUp, ChevronDown, X, Zap } from 'lucide-react';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import {
  SMART_MATTING_BACKGROUND_COLORS,
  SMART_MATTING_BACKGROUND_COLOR_LABELS,
  SMART_MATTING_FORMATS,
  SMART_MATTING_FORMAT_LABELS,
  SMART_MATTING_MODE_LABELS,
  type SmartMattingBackgroundColor,
  type SmartMattingFormat,
  type SmartMattingMode,
} from '../../smartMatting';
import styles from './index.module.css';

interface SmartMattingDialogProps {
  /** X 关闭（四退出之一，未发送退出不建任务不建卡由父级处理） */
  onClose: () => void;
  /** 抠像模式（入口下拉直选传入，决定单条标题；会话内不可切换） */
  mode: SmartMattingMode;
  /** 当前所选输出格式（受控：WEBM 默认，切换即派发父级） */
  format: SmartMattingFormat;
  onFormatChange: (format: SmartMattingFormat) => void;
  /** 当前所选背景色（受控：白色默认；仅 format=MP4 时有意义/显示） */
  backgroundColor: SmartMattingBackgroundColor;
  onBackgroundColorChange: (color: SmartMattingBackgroundColor) => void;
  /** 发送：父级按当前参数建任务（发送即退会话再建占位卡） */
  onSend: () => void;
  /** 发送中（创建请求飞行期防重复提交） */
  submitting?: boolean;
  sendBarAnchor: FollowDialogAnchor | null;
  /** IKJR9J 拖拽隐藏：锚定卡被拖时 visibility 级隐藏（不卸载） */
  dragHidden?: boolean;
}

export default function SmartMattingDialog({
  onClose,
  mode,
  format,
  onFormatChange,
  backgroundColor,
  onBackgroundColorChange,
  onSend,
  submitting,
  sendBarAnchor, dragHidden,
}: SmartMattingDialogProps) {
  const readOnly = submitting === true;

  /** 格式下拉展开态（本地 UI 态：选择/点外关闭即收起，随浮条卸载丢弃） */
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const formatWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside([
    { open: formatMenuOpen, ref: formatWrapRef, dismiss: () => setFormatMenuOpen(false) },
  ]);

  /** 置灰守卫（口径同 SceneSplitDialog：disabled 承担 aria，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    /* 源视频卡下方单条（跟随锚定时 inline left/top 生效，需解除默认 bottom 定位） */
    <div
      className={`${styles.sendBar} ${sendBarAnchor ? styles.sendBarFollow : ''}`}
      style={anchoredOverlayStyle(sendBarAnchor, dragHidden)}
      data-gen-panel-territory
      data-testid="smart-matting-send-bar"
    >
      <button
        type="button"
        className={styles.toolBtn}
        data-testid="smart-matting-close"
        title="退出智能抠像（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.barTitle} data-testid="smart-matting-title">
        {SMART_MATTING_MODE_LABELS[mode]}
      </span>
      {/* 输出格式下拉（两档无 MOV：透明 MOV 为 ProRes 4444 编码 Chrome 无法预览，
          ADR-0112 否决项；触发钮显当前格式，单条在卡下方菜单向上弹出） */}
      <div className={styles.formatWrap} ref={formatWrapRef}>
        <button
          type="button"
          className={styles.formatTrigger}
          data-testid="smart-matting-format-trigger"
          aria-haspopup="menu"
          aria-expanded={formatMenuOpen || undefined}
          disabled={readOnly}
          title="选择输出格式（WEBM 透明背景 / MP4 纯色背景）"
          onClick={guarded(readOnly, () => setFormatMenuOpen((open) => !open))}
        >
          <span>{SMART_MATTING_FORMAT_LABELS[format]}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
        {formatMenuOpen && (
          <div
            className={styles.formatMenu}
            role="menu"
            data-testid="smart-matting-format-menu"
          >
            {SMART_MATTING_FORMATS.map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                aria-checked={item === format}
                className={`${styles.formatMenuItem} ${item === format ? styles.formatMenuItemActive : ''}`}
                data-testid={`smart-matting-format-item-${item}`}
                title={item === 'WEBM' ? '透明背景，兼容性好、体积小' : '纯色背景，可配背景色'}
                onClick={() => {
                  onFormatChange(item);
                  setFormatMenuOpen(false);
                }}
              >
                {SMART_MATTING_FORMAT_LABELS[item]}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* 背景色分段控件（仅 MP4 纯色显示：白色默认/黑色/绿色——不采用官方绿幕合成
          场景各异默认，电商白底主流诉求，ADR-0112；WEBM 透明无背景色不渲染本控件） */}
      {format === 'MP4' && (
        <div
          className={styles.segmentGroup}
          role="radiogroup"
          aria-label="背景色"
          data-testid="smart-matting-background"
        >
          {SMART_MATTING_BACKGROUND_COLORS.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={item === backgroundColor}
              className={`${styles.segmentBtn} ${item === backgroundColor ? styles.segmentBtnActive : ''}`}
              data-testid={`smart-matting-background-${item}`}
              disabled={readOnly}
              title={`MP4 纯色背景：${SMART_MATTING_BACKGROUND_COLOR_LABELS[item]}`}
              onClick={guarded(readOnly, () => onBackgroundColorChange(item))}
            >
              {SMART_MATTING_BACKGROUND_COLOR_LABELS[item]}
            </button>
          ))}
        </div>
      )}
      <span className={styles.freeBadge} title="本期免费" data-testid="smart-matting-free-badge">
        <Zap size={12} strokeWidth={2} />
        <span>0</span>
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${!readOnly ? styles.sendBtnActive : ''}`}
        data-testid="smart-matting-send-btn"
        disabled={readOnly}
        title={readOnly ? '正在发送，请稍候' : '发送智能抠像任务'}
        onClick={guarded(readOnly, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
