/* ============================================
 * CropFrame 裁切框覆盖层（IKGW1N，IKGV2J 整包第三票）：屏幕空间覆盖层，
 * 作为 ReactFlow children 渲染拿 viewport context（同 GroupOverlay / OutpaintFrame 先例）；
 * 手柄尺寸恒为屏幕像素，渲染期从 flow 坐标换算跟随内容区（编辑期间画布缩放平移照常）。
 * 4 暗 + 框内平移区 + 4 边 + 4 角手柄，只许向内收、始终完整钳制在源图内容区内；
 * 自由模式拖边单边、拖角自由、按住 Shift 临时锁开始那一刻的比例；锁定比例（面板预设）
 * 下边手柄禁用并视觉弱化、角手柄以对角为锚等比缩放。拖拽换算全部走 imageCrop 纯函数。
 * 拖拽骨架照抄扩图 OutpaintFrame 74d39d83e 修复版：latestRef 动态依赖稳定引用 +
 * detachRef 会话拆除 + 空 deps 卸载兜底 + 会话期拦原生 dragstart。
 * ============================================ */
import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { findFlowRenderer, forwardWheelToRenderer } from '../Canvas/canvasWheelPassthrough';
import {
  cropPresetRatio,
  dragCropCorner,
  dragCropEdge,
  moveCropRect,
  type CropCorner,
  type CropEdge,
  type CropPresetKey,
  type CropRect,
} from '../../imageCrop';
import styles from './index.module.css';

export interface CropFrameProps {
  /** 源图内容区矩形（flow 坐标：节点左上角 + 22.5 标题偏移 + mediaContentBox 尺寸） */
  bounds: CropRect;
  /** 当前裁切框（与 bounds 同坐标系，CanvasPage 状态提升持有） */
  rect: CropRect;
  /** 比例模式：free=自由；预设=锁比例（边手柄禁用、角手柄等比缩放） */
  preset: CropPresetKey;
  /** 显示系短边下限（64 自然像素经 minCropSideDisplay 换算；0=无下限，源图分辨率缺失兜底） */
  minSide: number;
  onRectChange: (rect: CropRect) => void;
  /** IKJR9J 拖拽隐藏：锚定卡被拖时 visibility 级隐藏（不卸载） */
  dragHidden?: boolean;
  /** 点框外暗区退出（四退出之一，CanvasPage 绑 exitCropMode） */
  onDarkAreaClick: () => void;
}

/** 拖拽目标：kind 与手柄捆绑的判别联合——move 无手柄、edge/corner 各带合法手柄值，
 *  编译期挡住 kind 与 handle 乱配，消除拖拽换算处的强转。 */
type DragTarget =
  | { kind: 'move' }
  | { kind: 'edge'; handle: CropEdge }
  | { kind: 'corner'; handle: CropCorner };

/** 拖拽会话：拖拽目标 + 按下那一刻的框快照与指针 flow 坐标（Shift 锁比例 / 平移基准） */
type DragSession = DragTarget & {
  start: CropRect;
  startPointer: { x: number; y: number };
};

export default function CropFrame({ bounds, rect, preset, minSide, onRectChange, onDarkAreaClick, dragHidden }: CropFrameProps) {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();

  const dragRef = useRef<DragSession | null>(null);
  /** 动态依赖进 ref：window 监听引用稳定，拖拽进行中的重渲染不再拆监听（74d39d83e） */
  const latestRef = useRef({ bounds, rect, preset, minSide, onRectChange, onDarkAreaClick, screenToFlowPosition });
  latestRef.current = { bounds, rect, preset, minSide, onRectChange, onDarkAreaClick, screenToFlowPosition };
  /** 会话 detach：startDrag 挂监听时赋值，up / 卸载兜底时调用 */
  const detachRef = useRef<() => void>(() => {});

  /** 屏幕点换 flow 坐标后走纯函数换算（每帧从拖动开始快照重算，无累积漂移） */
  const handleMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { bounds: b, rect: r, preset: p, minSide: ms, onRectChange: change, screenToFlowPosition: toFlow } = latestRef.current;
    const pointer = toFlow({ x: e.clientX, y: e.clientY });
    let next: CropRect;
    if (drag.kind === 'move') {
      next = moveCropRect(drag.start, pointer.x - drag.startPointer.x, pointer.y - drag.startPointer.y, b);
    } else if (drag.kind === 'edge') {
      next = dragCropEdge(drag.handle, r, b, pointer, ms);
    } else {
      // Shift 临时锁开始那一刻的框比例（同扩图手势）；面板锁定比例传预设值，同一算法两个入口
      const locked = e.shiftKey ? drag.start.width / drag.start.height : cropPresetRatio(p);
      next = dragCropCorner(drag.handle, drag.start, b, pointer, ms, locked);
    }
    change(next);
  }, []);

  const handleUp = useCallback(() => {
    dragRef.current = null;
    detachRef.current();
  }, []);

  const startDrag = useCallback(
    (target: DragTarget) => (e: React.PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      // 锁定比例：边手柄禁用（单边调整必然破坏比例），视觉弱化 + 逻辑守卫双保险
      if (target.kind === 'edge' && cropPresetRatio(latestRef.current.preset) != null) return;
      e.preventDefault();
      e.stopPropagation();
      const toFlow = latestRef.current.screenToFlowPosition;
      dragRef.current = {
        ...target,
        start: latestRef.current.rect,
        startPointer: toFlow({ x: e.clientX, y: e.clientY }),
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
      detachRef.current = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);
      };
    },
    [handleMove, handleUp],
  );

  /** 卸载时清理拖拽监听（不触发回调，避免卸载期写父级状态）；依赖 []：只做真正卸载兜底 */
  useEffect(
    () => () => {
      detachRef.current();
    },
    [],
  );

  /** 会话期间拦截原生 dragstart：pointerdown 落空到图片时浏览器会启动 HTML5 拖拽
   * （半透明重影跟手，扩图验收实测报障）；捕获阶段统一按住 */
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    document.addEventListener('dragstart', block, true);
    return () => document.removeEventListener('dragstart', block, true);
  }, []);

  /* ---- 暗区手势直通（编辑期间画布缩放平移照常，规格故事 16） ----
   * 本覆盖层渲染在 ReactFlow children 区（.react-flow__renderer 的兄弟节点），
   * 命中元素上的原生 wheel / pointer 事件到不了 renderer 上挂的 d3-zoom：
   * wheel 即时转发（IKIXDB 起走 Canvas/canvasWheelPassthrough 共享模块，同
   * NodeFollowToolbar / canvasWrapper Dock 直通）；暗区按下后位移超 4px 视为平移
   * 手势，转发 mousedown 启动 d3 拖拽平移（后续帧由真实 window 事件驱动），
   * 位移以内视为点击 → onDarkAreaClick 退出。 */
  const layerRef = useRef<HTMLDivElement | null>(null);
  const rendererEl = () => (layerRef.current ? findFlowRenderer(layerRef.current) : null);

  const forwardWheel = (e: React.WheelEvent) => {
    forwardWheelToRenderer(e.nativeEvent);
  };

  const forwardPanStart = (clientX: number, clientY: number) => {
    const target = rendererEl();
    if (!target) return;
    target.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: false,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 0,
        buttons: 1,
      }),
    );
  };

  /** 暗区手势会话：起点 + 是否已转交平移（4px 阈值内视为点击） */
  const darkRef = useRef<{ x: number; y: number; forwarded: boolean } | null>(null);
  const darkPannedRef = useRef(false);

  const onDarkPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    darkRef.current = { x: e.clientX, y: e.clientY, forwarded: false };
    darkPannedRef.current = false;
    // 指针捕获：按下期间指针移出暗区仍能收到 move/up（jsdom 无该 API，防御式调用）
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onDarkPointerMove = (e: React.PointerEvent) => {
    const session = darkRef.current;
    if (!session || session.forwarded) return;
    const dx = e.clientX - session.x;
    const dy = e.clientY - session.y;
    if (dx * dx + dy * dy <= 16) return; // 4px 内视为点击（口径同画布点外关闭）
    session.forwarded = true;
    darkPannedRef.current = true;
    forwardPanStart(e.clientX, e.clientY);
  };

  const onDarkPointerUp = () => {
    darkRef.current = null;
  };

  const onDarkClick = () => {
    if (darkPannedRef.current) {
      // 本次按下已转交平移手势：松手后的 click 是平移结束，不是退出
      darkPannedRef.current = false;
      return;
    }
    latestRef.current.onDarkAreaClick();
  };

  const darkBandProps = {
    onPointerDown: onDarkPointerDown,
    onPointerMove: onDarkPointerMove,
    onPointerUp: onDarkPointerUp,
    onClick: onDarkClick,
    onWheel: forwardWheel,
  } as const;

  // 屏幕空间框几何（flow × zoom + 平移）
  const tl = flowToScreenPosition({ x: rect.x, y: rect.y });
  const br = flowToScreenPosition({ x: rect.x + rect.width, y: rect.y + rect.height });
  const boxLeft = tl.x;
  const boxTop = tl.y;
  const boxW = br.x - tl.x;
  const boxH = br.y - tl.y;
  const locked = cropPresetRatio(preset) != null;
  const edgeHandleClass = (extra: string) =>
    `nodrag nopan ${styles.edgeHit} ${extra}${locked ? ` ${styles.edgeHandleDisabled}` : ''}`;

  return (
    <div className={styles.frameLayer} data-testid="crop-frame" data-crop-frame="" ref={layerRef} style={{ visibility: dragHidden ? 'hidden' : undefined }}>
      {/* 框外暗区 4 带：视觉遮罩 + 点击退出；手势（wheel/拖拽平移）经转发直通画布 */}
      <div
        {...darkBandProps}
        className={`${styles.darkBand} ${styles.darkBandTop}`}
        style={{ height: Math.max(0, boxTop) }}
        data-testid="crop-dark-top"
      />
      <div
        {...darkBandProps}
        className={`${styles.darkBand} ${styles.darkBandBottom}`}
        style={{ top: br.y }}
        data-testid="crop-dark-bottom"
      />
      <div
        {...darkBandProps}
        className={`${styles.darkBand} ${styles.darkBandLeft}`}
        style={{ top: boxTop, height: boxH, width: Math.max(0, boxLeft) }}
        data-testid="crop-dark-left"
      />
      <div
        {...darkBandProps}
        className={`${styles.darkBand} ${styles.darkBandRight}`}
        style={{ top: boxTop, height: boxH, left: br.x }}
        data-testid="crop-dark-right"
      />

      {/* 框内平移命中区：按住拖动整体平移（先于边/角渲染，交汇处边角优先） */}
      <div
        className={`nodrag nopan ${styles.moveZone}`}
        style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH }}
        data-testid="crop-move-zone"
        title="按住拖动移动裁切框"
        onPointerDown={startDrag({ kind: 'move' })}
        onWheel={forwardWheel}
      />

      {/* 框本体：纯视觉（边线），不拦截交互 */}
      <div
        className={styles.frameBox}
        style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH }}
        data-testid="crop-frame-box"
      />

      {/* 4 边手柄：命中带贯穿整条边（拖的是"边框线"本身，扩图验收报障同款结论）；
          锁定比例时禁用并视觉弱化（单边调整必然破坏比例，规格故事 9） */}
      <div
        className={edgeHandleClass(styles.edgeHitTop)}
        style={{ left: boxLeft, top: boxTop, width: boxW }}
        data-testid="crop-handle-top"
        title={locked ? '锁定比例下不可拖动单边' : '向内拖动收缩裁切范围'}
        onPointerDown={startDrag({ kind: 'edge', handle: 'top' })}
        onWheel={forwardWheel}
      />
      <div
        className={edgeHandleClass(styles.edgeHitBottom)}
        style={{ left: boxLeft, top: br.y, width: boxW }}
        data-testid="crop-handle-bottom"
        title={locked ? '锁定比例下不可拖动单边' : '向内拖动收缩裁切范围'}
        onPointerDown={startDrag({ kind: 'edge', handle: 'bottom' })}
        onWheel={forwardWheel}
      />
      <div
        className={edgeHandleClass(styles.edgeHitLeft)}
        style={{ left: boxLeft, top: boxTop, height: boxH }}
        data-testid="crop-handle-left"
        title={locked ? '锁定比例下不可拖动单边' : '向内拖动收缩裁切范围'}
        onPointerDown={startDrag({ kind: 'edge', handle: 'left' })}
        onWheel={forwardWheel}
      />
      <div
        className={edgeHandleClass(styles.edgeHitRight)}
        style={{ left: br.x, top: boxTop, height: boxH }}
        data-testid="crop-handle-right"
        title={locked ? '锁定比例下不可拖动单边' : '向内拖动收缩裁切范围'}
        onPointerDown={startDrag({ kind: 'edge', handle: 'right' })}
        onWheel={forwardWheel}
      />

      {/* 4 角手柄：20×20 透明命中区（角优先于边带），视觉点 10×10；
          自由改宽高 / Shift 临时锁比例 / 锁定比例下以对角为锚等比缩放 */}
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
        const cx = corner === 'nw' || corner === 'sw' ? boxLeft : br.x;
        const cy = corner === 'nw' || corner === 'ne' ? boxTop : br.y;
        const dirClass = corner === 'nw' || corner === 'se' ? styles.cornerNwse : styles.cornerNesw;
        return (
          <div
            key={corner}
            className={`nodrag nopan ${styles.cornerHit} ${dirClass}`}
            style={{ left: cx, top: cy }}
            data-testid={`crop-handle-${corner}`}
            title={locked ? '拖动等比缩放（以对角为锚）' : '拖动调整宽高；按住 Shift 等比缩放'}
            onPointerDown={startDrag({ kind: 'corner', handle: corner })}
            onWheel={forwardWheel}
          >
            <div className={styles.cornerVisual} />
          </div>
        );
      })}
    </div>
  );
}
