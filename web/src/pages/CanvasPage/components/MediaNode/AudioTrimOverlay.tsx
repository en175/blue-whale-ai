/* ============================================
 * AudioTrimOverlay 截取遮罩层（IKHB7A，父单 IKHB08）：叠在源音频卡波形区上的编辑态
 * 四件套——白色圆角选区框 + 左右缘白竖条抓手（热区外扩）+ 选区外暗区（波形压暗、
 * 点击无行为）+ 中央黑底胶囊（实时选区秒数一位小数）；交互基准 = 验收原型
 * web/prototypes/audio-trim.prototype.html，规格 = ADR-0111。
 * - 注入形态对齐 splitEditing/subtitleEraseEditing 先例：CanvasPage 渲染期经
 *   data.trimEditing 注入，层内消化全部指针事件（nodrag/nopan + stopPropagation），
 *   不冒泡开音频面板；层存在即接管波形区（AudioPlayer 既有 seek 不再收到事件）。
 * - 换算：pointer 秒值 = (clientX-rect.left)/rect.width * duration（比例换算天然
 *   抵消画布 zoom）；抓手/定位条钳制走 audioTrimGeometry 纯函数，本层不持编辑状态。
 * - 定位条交互三段上抛（onSeekStart/onSeek/onSeekEnd）：按下暂停记 wasPlaying、
 *   拖动连续 seek、松手续播/停住的「播放中拖完续播」语义由父级 MediaNode 桥接
 *   AudioPlayer 命令式句柄承担，本层只报时点。
 * ============================================ */
import { useCallback, useRef } from 'react';
import {
  audioTrimDurationLabel,
  audioTrimTimePercent,
  clampAudioTrimPlayhead,
  dragAudioTrimHandleEnd,
  dragAudioTrimHandleStart,
  type AudioTrimSelection,
} from '../../audioTrimGeometry';
import styles from './AudioTrimOverlay.module.css';

export interface AudioTrimOverlayProps {
  /** 当前选区（秒，受控：状态提升在 CanvasPage，抓手拖拽实时上抛） */
  selection: AudioTrimSelection;
  /** 源音频全长（秒，权威值驱动遮罩；波形解码失败不阻塞） */
  duration: number;
  /** 抓手拖拽实时上抛（发送条时间范围/胶囊联动） */
  onSelectionChange: (selection: AudioTrimSelection) => void;
  /** 定位条按下（选区内）：父级先暂停播放并记录 wasPlaying */
  onSeekStart: () => void;
  /** 定位条移动/点按定位（秒，已按选区钳制） */
  onSeek: (time: number) => void;
  /** 定位条松手（秒）：父级按 wasPlaying 与终点判定续播/停住 */
  onSeekEnd: (time: number) => void;
}

/** 指针秒值换算与几何钳制（抓手侧别） */
type HandleSide = 'start' | 'end';

export default function AudioTrimOverlay({
  selection,
  duration,
  onSelectionChange,
  onSeekStart,
  onSeek,
  onSeekEnd,
}: AudioTrimOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** 抓手拖拽会话（side + 无需起始快照：钳制是绝对位置制，每帧由指针秒值直接换算） */
  const handleDragRef = useRef<HandleSide | null>(null);
  /** 定位条拖拽进行中（pointermove 是否上报 onSeek） */
  const seekingRef = useRef(false);

  /** clientX → 选区秒值（相对波形内区左上；jsdom/缩放下 rect 由调用环境给定） */
  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const el = rootRef.current;
      if (!el || !(duration > 0)) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      return Math.min(Math.max(ratio, 0), 1) * duration;
    },
    [duration],
  );

  /* ---- 抓手拖拽（白竖条，热区外扩由 CSS 承担） ---- */
  const onHandleDown = (side: HandleSide) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    // pointer capture 保证拖出热区仍收 move（jsdom 无该 API，optional call 防御）
    event.currentTarget.setPointerCapture?.(event.pointerId);
    handleDragRef.current = side;
  };

  const onRootPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const side = handleDragRef.current;
    if (side) {
      event.stopPropagation();
      const time = timeFromEvent(event.clientX);
      const next =
        side === 'start'
          ? dragAudioTrimHandleStart(time, selection)
          : dragAudioTrimHandleEnd(time, selection, duration);
      onSelectionChange(next);
      return;
    }
    if (seekingRef.current) {
      event.stopPropagation();
      onSeek(clampAudioTrimPlayhead(timeFromEvent(event.clientX), selection));
    }
  };

  const onRootPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (handleDragRef.current) {
      handleDragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
      return;
    }
    if (seekingRef.current) {
      seekingRef.current = false;
      onSeekEnd(clampAudioTrimPlayhead(timeFromEvent(event.clientX), selection));
    }
  };

  /* ---- 选区内定位条：可点定位、按住拖拽连续 seek（三段上抛，钳制见纯函数） ---- */
  const onSelectionDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSeekStart();
    seekingRef.current = true;
    onSeek(clampAudioTrimPlayhead(timeFromEvent(event.clientX), selection));
  };

  /* ---- 两侧暗区：点击无任何行为——只消化指针不冒泡（压暗波形由 CSS 渲染） ---- */
  const swallow = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
  };

  const leftPct = audioTrimTimePercent(selection.start, duration);
  const widthPct = audioTrimTimePercent(selection.end - selection.start, duration);

  return (
    <div
      ref={rootRef}
      className={`nodrag nopan ${styles.overlay}`}
      data-testid="audio-trim-overlay"
      data-gen-panel-territory
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={onRootPointerUp}
      /* 浏览器在 pointerup 后派发的 click 必须截在层内：冒泡命中 NodeWrapper onClick
         会对源音频卡触发 onNodeClick → 打开音频面板并退出编辑态（选区丢失），先例
         SubtitleEraseBoxesLayer 同款接管 */
      onClick={(event) => event.stopPropagation()}
    >
      {/* 选区外暗区：波形压暗、点击无行为 */}
      <div className={styles.dim} style={{ left: 0, width: `${leftPct}%` }} onPointerDown={swallow} />
      <div
        className={styles.dim}
        style={{ left: `${leftPct + widthPct}%`, right: 0 }}
        onPointerDown={swallow}
      />
      {/* 白色圆角选区框（定位条交互宿主） */}
      <div
        className={styles.selection}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        data-testid="audio-trim-selection"
        onPointerDown={onSelectionDown}
      >
        <span className={styles.pill} data-testid="audio-trim-pill">
          {audioTrimDurationLabel(selection)}
        </span>
      </div>
      {/* 左右缘白竖条抓手（视觉窄条 + 热区外扩） */}
      <div
        className={styles.handle}
        style={{ left: `${leftPct}%` }}
        data-testid="audio-trim-handle-start"
        onPointerDown={onHandleDown('start')}
      />
      <div
        className={styles.handle}
        style={{ left: `${leftPct + widthPct}%` }}
        data-testid="audio-trim-handle-end"
        onPointerDown={onHandleDown('end')}
      />
    </div>
  );
}
