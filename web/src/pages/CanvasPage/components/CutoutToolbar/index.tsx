/* ============================================
 * CutoutToolbar 抠图工具栏（IKGXMT）：跟随源图卡下方的一条横向工具栏，
 * 形态同构扩图 OutpaintDialog（ADR-0098 拍板：横条而非高清式竖向面板；
 * 规格 Out of Scope 明确两工具栏不收敛为共享组件——同构独立实现，不 import 扩图分支）：
 * X 关闭 + 场景上拉三选一（通用/人像/商品，触发钮显示当前场景，向上弹出、点外/再点关闭）
 * + 人像/商品下追加描边上拉（启用开关 + 宽度滑杆 1~50 默认 10 实时生效，颜色固定白色
 * 不暴露）与透明裁剪点亮开关 + 「本期免费」+ 发送钮（IKGZ5Q 起 Dock 主发送钮同款：
 * 灰底圆角方形 + 白 ↑ 图标；场景档精校置灰 + title 原因）；
 * 通用场景两组增强控件不渲染（规格故事 9「UI 隐藏而非置灰」）。无标题字。
 * 参数态全部受控提升在 CanvasPage（会话期持有，四路退出统一丢弃）；
 * 锚定与领土豁免沿用 OutpaintDialog 同构（followAnchor 中心点 + translateX(-50%) 真居中、
 * data-gen-panel-territory）。逻辑层（门槛/精校/组装）全在 imageCutout 纯函数。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X, ArrowUp, ChevronDown, Scan, User, Package, CircleDot, Crop } from 'lucide-react';
import type { FollowDialogAnchor } from '../../followDialog';
import {
  IMAGE_CUTOUT_CONTOUR_SIZE_MIN,
  IMAGE_CUTOUT_CONTOUR_SLIDER_MAX,
  type ImageCutoutScene,
} from '../../imageCutout';
import styles from './index.module.css';

interface CutoutToolbarProps {
  onClose: () => void;
  /** 当前场景（触发钮文案跟随；general 下增强控件不渲染） */
  scene: ImageCutoutScene;
  onSceneChange: (scene: ImageCutoutScene) => void;
  /** 主体描边开关（仅人像/商品场景生效） */
  needContour: boolean;
  onNeedContourChange: (enabled: boolean) => void;
  /** 描边宽度（px，1~50 默认 10；滑杆实时生效，出站钳制在纯函数层） */
  contourSize: number;
  onContourSizeChange: (size: number) => void;
  /** 透明背景裁剪开关（仅人像/商品场景生效） */
  needCropBackground: boolean;
  onNeedCropBackgroundChange: (enabled: boolean) => void;
  /** 发送置灰原因（父级按 imageCutoutSceneGateReason 按场景档精校；null=可发） */
  sendDisabledReason: string | null;
  /** 发送中（创建请求飞行期防重复提交，与擦除 eraseSubmitting 同口径） */
  submitting: boolean;
  /** 发送：返回 true 表示创建请求已发出（成功路径父级先退会话再建结果卡） */
  onSend: () => boolean;
  /** 绑定源图卡时悬浮跟随其下方（left=源卡中心 x，自身 translateX(-50%) 居中）；缺省锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
}

/** 场景选项（三选一 + 悬停说明，文案出处规格故事 7） */
const SCENE_OPTIONS: Array<{
  key: ImageCutoutScene;
  label: string;
  hint: string;
  Icon: typeof Scan;
}> = [
  { key: 'general', label: '通用', hint: '自动识别画面主体并保留', Icon: Scan },
  { key: 'human', label: '人像', hint: '只保留图像中的人物主体', Icon: User },
  { key: 'product', label: '商品', hint: '只保留图像中的商品主体', Icon: Package },
];

export default function CutoutToolbar({
  onClose,
  scene,
  onSceneChange,
  needContour,
  onNeedContourChange,
  contourSize,
  onContourSizeChange,
  needCropBackground,
  onNeedCropBackgroundChange,
  sendDisabledReason,
  submitting,
  onSend,
  followAnchor,
}: CutoutToolbarProps) {
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [contourMenuOpen, setContourMenuOpen] = useState(false);
  const sceneAnchorRef = useRef<HTMLDivElement | null>(null);
  const contourAnchorRef = useRef<HTMLDivElement | null>(null);

  /** 点外关闭上拉菜单（点外关闭口径同扩图工具栏 / MediaNode SubtitleEraseMenu 下拉；
   *  document pointerdown + contains；Esc 不单独关菜单——直接退整个会话，与扩图同构口径）。 */
  useEffect(() => {
    if (!sceneMenuOpen && !contourMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (sceneMenuOpen && sceneAnchorRef.current && !sceneAnchorRef.current.contains(target)) {
        setSceneMenuOpen(false);
      }
      if (contourMenuOpen && contourAnchorRef.current && !contourAnchorRef.current.contains(target)) {
        setContourMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [sceneMenuOpen, contourMenuOpen]);

  /** 人像/商品场景才有的两组增强控件（通用场景不渲染——规格故事 9「UI 隐藏而非置灰」） */
  const subjectScene = scene !== 'general';
  const sceneLabel = SCENE_OPTIONS.find((option) => option.key === scene)?.label ?? '通用';

  /** 置灰守卫（口径同扩图工具栏：aria-disabled + 点击守卫，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  /** 描边宽度滑杆键盘操作（IKI61N，组件内自闭环，不改公共 helper 与公共 Esc 链）：
   *  Esc 退出抠图会话——抠图专属 Esc handler 与画布公共链对任何 INPUT 豁免
   *  （isEditableKeyboardTarget，type=range 同被吞），故在此直调 onClose（X 同口径）；
   *  preventDefault + stopPropagation 阻断冒泡，两条链不会二次处理。
   *  方向键不拦截：step=1 与受控值同网格、无受控量化冲突，原生步进语义直接生效。 */
  const onContourSliderKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
      data-gen-panel-territory
    >
      <div className={styles.toolbar} data-testid="cutout-toolbar">
        <button type="button" className={styles.iconBtn} onClick={onClose} title="退出抠图" data-testid="cutout-close">
          <X size={14} strokeWidth={2} />
        </button>
        <span className={styles.divider} aria-hidden />

        <div className={styles.menuAnchor} ref={sceneAnchorRef}>
          <button
            type="button"
            className={styles.triggerBtn}
            aria-haspopup="menu"
            aria-expanded={sceneMenuOpen || undefined}
            title="选择抠图场景"
            data-testid="cutout-scene-trigger"
            onClick={() => {
              setContourMenuOpen(false);
              setSceneMenuOpen((open) => !open);
            }}
          >
            <span>{sceneLabel}</span>
            <ChevronDown size={12} strokeWidth={2} />
          </button>
          {sceneMenuOpen && (
            <div className={styles.menuPopup} role="menu" data-testid="cutout-scene-menu">
              {SCENE_OPTIONS.map(({ key, label, hint, Icon }) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  title={hint}
                  className={`${styles.menuItem} ${scene === key ? styles.menuItemActive : ''}`}
                  data-testid={`cutout-scene-${key}`}
                  onClick={guarded(false, () => {
                    onSceneChange(key);
                    setSceneMenuOpen(false);
                  })}
                >
                  <Icon size={14} strokeWidth={2} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {subjectScene && (
          <>
            <div className={styles.menuAnchor} ref={contourAnchorRef}>
              <button
                type="button"
                className={`${styles.triggerBtn} ${needContour ? styles.triggerBtnActive : ''}`}
                aria-haspopup="menu"
                aria-expanded={contourMenuOpen || undefined}
                title="主体描边（白色，仅人像/商品）"
                data-testid="cutout-contour-trigger"
                onClick={() => {
                  setSceneMenuOpen(false);
                  setContourMenuOpen((open) => !open);
                }}
              >
                <CircleDot size={14} strokeWidth={2} />
                <span>描边</span>
                <ChevronDown size={12} strokeWidth={2} />
              </button>
              {contourMenuOpen && (
                <div className={styles.contourPopup} data-testid="cutout-contour-menu">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={needContour}
                    className={`${styles.toggleBtn} ${needContour ? styles.toggleBtnOn : ''}`}
                    data-testid="cutout-contour-toggle"
                    onClick={() => onNeedContourChange(!needContour)}
                  >
                    <span>{needContour ? '描边已开启' : '开启描边'}</span>
                    <span className={styles.togglePill} aria-hidden>
                      <span className={styles.toggleKnob} />
                    </span>
                  </button>
                  <div className={styles.contourRow} title="描边宽度（px），颜色固定白色">
                    <span className={styles.contourLabel}>宽度</span>
                    <input
                      type="range"
                      className={styles.contourRange}
                      min={IMAGE_CUTOUT_CONTOUR_SIZE_MIN}
                      max={IMAGE_CUTOUT_CONTOUR_SLIDER_MAX}
                      step={1}
                      value={contourSize}
                      disabled={!needContour}
                      aria-label="描边宽度"
                      data-testid="cutout-contour-size"
                      onChange={(event) => onContourSizeChange(Number(event.target.value))}
                      onKeyDown={onContourSliderKeyDown}
                    />
                    <span className={styles.contourValue}>{contourSize}px</span>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={needCropBackground}
              className={`${styles.iconToggle} ${needCropBackground ? styles.iconToggleOn : ''}`}
              title="透明背景裁剪到刚好包裹主体"
              data-testid="cutout-crop-toggle"
              onClick={() => onNeedCropBackgroundChange(!needCropBackground)}
            >
              <Crop size={14} strokeWidth={2} />
            </button>
          </>
        )}

        <span className={styles.freeHint}>本期免费</span>

        <button
          type="button"
          className={`${styles.sendBtn} ${!sendDisabledReason && !submitting ? styles.sendBtnActive : ''}`}
          onClick={guarded(!!sendDisabledReason || submitting, onSend)}
          disabled={!!sendDisabledReason || submitting}
          title={sendDisabledReason ?? (submitting ? '正在发送…' : '发送抠图')}
          data-testid="cutout-send-btn"
        >
          <ArrowUp size={14} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}
