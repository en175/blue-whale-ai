/* ============================================
 * AudioSpeedBar 调速编辑态发送条（IKHW5S，父单 IKHVYO）：钉屏幕浮层 24px 胶囊
 * 家族单条（逐件对齐 AudioTrimBar 家族形态）。条内六要素：X 退出、「调速」标题、
 * 倍速滑杆（0.1x~4.0x 分段中点映射，1.0x 原速视觉中点带凹槽，刻度五行）、当前
 * 倍速值（纯文字 secondary 等宽数字，无底块）、⚡0「本期免费」徽标（免费口径同
 * 截取/分离家族：无幂等头、无积分预估）、ArrowUp 家族发送钮。无格式下拉（调速
 * API 无格式参数，父单决策）。发送按当前倍速建任务（发送闭环由父级承担）；
 * X/Esc/点其他卡/点画布空白四路退出未发送不建任务不建卡。
 * 位置↔倍速换算只引契约 posToSpeed/speedToPos（@lib/contracts/audio-speed 单源，
 * 父单实现决策 3——前端禁止各自实现换算）。滑杆键盘操作（IKI4M6）：方向键按契约
 * 0.05 步进改倍速（原生 step=1 位置步进经 0.05 量化后近失效，拦截改走倍速域步进），
 * Esc 组件内直接退出（公共 Esc 链对 INPUT 豁免会吞键，见 onSliderKeyDown 注释）。
 * ============================================ */
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowUp, X, Zap } from 'lucide-react';
import {
  AUDIO_SPEED_MAX_SPEED,
  AUDIO_SPEED_MIN_SPEED,
  AUDIO_SPEED_SLIDER_MAX_POS,
  AUDIO_SPEED_SLIDER_MIN_POS,
  AUDIO_SPEED_STEP,
  posToSpeed,
  roundAudioSpeed,
  speedToPos,
} from '@lib/contracts/audio-speed';
import type { FollowDialogAnchor } from '../../followDialog';
import { audioSpeedLabel } from '../../audioSpeed';
import styles from './index.module.css';

interface AudioSpeedBarProps {
  /** X 关闭（四退出之一，未发送退出不建任务不建卡由父级处理） */
  onClose: () => void;
  /** 当前所选倍速（受控：滑杆拖动即派发父级，播放中实时生效不断播） */
  speed: number;
  onSpeedChange: (speed: number) => void;
  /** 发送：父级按当前倍速建任务（发送即退编辑态再建卡） */
  onSend: () => void;
  /** 发送中（创建请求飞行期防重复提交；滑杆/发送一并只读） */
  submitting?: boolean;
  anchor: FollowDialogAnchor | null;
}

/** 刻度行（位置一律经契约 speedToPos 换算成 0~100% left，不硬编码百分比） */
const SPEED_TICKS: ReadonlyArray<{ label: string; speed: number; tone?: 'origin' | 'first' | 'last' }> = [
  { label: '0.1x', speed: 0.1, tone: 'first' },
  { label: '0.5x', speed: 0.5 },
  { label: '1.0x 原速', speed: 1, tone: 'origin' },
  { label: '2.0x', speed: 2 },
  { label: '4.0x', speed: 4, tone: 'last' },
];

export default function AudioSpeedBar({
  onClose,
  speed,
  onSpeedChange,
  onSend,
  submitting,
  anchor,
}: AudioSpeedBarProps) {
  const readOnly = submitting === true;

  /** 发送守卫：1.00x 原速位无意义任务置灰（滑离点亮、滑回重新置灰），submitting
   *  飞行期只读（口径同 AudioTrimBar：aria-disabled 由 disabled 承担，title 保留悬停原因） */
  const canSend = !readOnly && speed !== 1;
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  const pos = speedToPos(speed);

  /** 滑杆键盘操作（IKI4M6，在组件内自闭环，不改公共 helper）：
   *  - 方向键按契约 0.05 步进改倍速（原生 range 按 step=1 走位置，经 posToSpeed 0.05
   *    量化后右半段约 8 次按键才动一格，看起来失效——故 preventDefault 拦截原生行为，
   *    直接以倍速域步进派发）；两端钳制 [0.1, 4.0]，量化与范围常量全引契约单源。
   *  - Esc 退出编辑态：画布公共 Esc 链对任何 INPUT 豁免（isEditableKeyboardTarget，
   *    type=range 同被吞），故在此直接调 onClose；stopPropagation 阻断冒泡（React 18
   *    合成事件委托 root，先于 window 监听执行），公共链不会二次处理；未发送不建任务
   *    不建卡、倍速复位 1.0x 由父级 onClose 既有语义承担。
   *  - submitting（readOnly）时键盘操作无效（与 disabled 滑杆语义一致；disabled 本不
   *    聚焦，此守卫为防御）。 */
  const onSliderKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (readOnly) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? AUDIO_SPEED_STEP : -AUDIO_SPEED_STEP;
      const next = Math.min(
        AUDIO_SPEED_MAX_SPEED,
        Math.max(AUDIO_SPEED_MIN_SPEED, roundAudioSpeed(speed + delta)),
      );
      if (next !== speed) onSpeedChange(next);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className={`${styles.sendBar} ${anchor ? styles.sendBarFollow : ''}`}
      style={anchor ? { left: anchor.left, top: anchor.top } : undefined}
      data-gen-panel-territory
      data-testid="audio-speed-send-bar"
    >
      <button
        type="button"
        className={styles.closeBtn}
        data-testid="audio-speed-close"
        title="退出调速（未发送不建任务不建卡）"
        onClick={onClose}
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.title}>调速</span>
      {/* 倍速滑杆（位置 0~1000 整数，value/onchange 均经契约映射换算） */}
      <div className={styles.sliderBox}>
        <input
          type="range"
          className={styles.slider}
          min={AUDIO_SPEED_SLIDER_MIN_POS}
          max={AUDIO_SPEED_SLIDER_MAX_POS}
          step={1}
          value={pos}
          disabled={readOnly}
          style={{ '--fill': `${pos / 10}%` } as CSSProperties}
          data-testid="audio-speed-slider"
          aria-label="播放倍速"
          onChange={(e) => onSpeedChange(posToSpeed(parseInt(e.target.value, 10)))}
          onKeyDown={onSliderKeyDown}
        />
        {/* 1.0x 原速视觉中点凹槽 */}
        <span className={styles.notch} aria-hidden />
        <div className={styles.ticks} aria-hidden>
          {SPEED_TICKS.map((tick) => (
            <span
              key={tick.label}
              className={`${styles.tick} ${tick.tone ? styles[tick.tone] : ''}`}
              style={{ left: `${speedToPos(tick.speed) / 10}%` }}
              data-testid={`audio-speed-tick-${tick.tone ?? tick.speed}`}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      {/* 当前倍速值（纯文字只读参数，同 AudioTrimBar 时间范围样式口径） */}
      <span className={styles.value} data-testid="audio-speed-value">
        {audioSpeedLabel(speed)}
      </span>
      {/* ⚡0 本期免费徽标（对客免费口径，父单实现决策 9） */}
      <span className={styles.free} title="本期免费" data-testid="audio-speed-free">
        <Zap size={11} fill="currentColor" strokeWidth={0} />
        0
      </span>
      <button
        type="button"
        className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
        data-testid="audio-speed-send-btn"
        disabled={readOnly}
        title={
          readOnly
            ? '正在发送，请稍候'
            : canSend
              ? `生成 ${audioSpeedLabel(speed)} 调速音频`
              : '滑离原速位后可发送'
        }
        onClick={guarded(readOnly || speed === 1, onSend)}
      >
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
