/* ============================================
 * OutpaintDialog 扩图工具栏（IKGOQX 骨架 / IKGOR6 补全字段 / 验收拍板改版横条）：
 * 跟随源图卡下方的一条横向工具栏（ADR-0095 修订，替代初版竖向参数面板）：
 * X 关闭 + 比例上拉菜单（六预设按图动态置灰 + 自定义被动项，触发按钮文案跟随命中，
 * 向上弹出、点外关闭）+ 张数固定「1张」禁用展示 + 「本期免费」文字 + 圆形发送钮
 * （框与原图重合零扩展时置灰）；无标题字，无分辨率、画质档位、提示词与参考栏、
 * 无积分预估。逻辑层（可达性 / 命中 / 换算）全在 imageOutpaint 纯函数，UI 形态
 * 改版不动逻辑。锚定与领土豁免沿用 ImageEnhanceDialog 同构（followAnchor、
 * data-gen-panel-territory）。比例选项用共享宽高比图标组件 RatioIcon（IKGBTV 口径）。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { X, ArrowUp, ChevronDown } from 'lucide-react';
import RatioIcon from '@/components/RatioIcon';
import type { FollowDialogAnchor } from '../../followDialog';
import {
  OUTPAINT_PRESET_LABELS,
  OUTPAINT_PRESET_ORDER,
  matchOutpaintPreset,
  maxExpandPerSide,
  outpaintPresetAvailability,
  type ExpandSides,
  type OutpaintPresetKey,
} from '../../imageOutpaint';
import styles from './index.module.css';

interface OutpaintDialogProps {
  onClose: () => void;
  /** 源图内容区尺寸（预设可达性与命中判定基准） */
  sourceSize: { width: number; height: number };
  /** 当前四方向扩展量（命中预设高亮 / 自定义被动状态 / 零扩展发送置灰的判定输入） */
  expands: ExpandSides;
  /** 点预设：父级以原图中心为锚外扩到该比例最小包含框（不可达预设已置灰不会触发） */
  onPresetSelect: (key: OutpaintPresetKey) => void;
  /** 发送：返回 true 表示创建请求已发出（父级据此退出扩图模式） */
  onSend: () => boolean;
  /** 绑定源图卡时悬浮跟随其下方；缺省锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
}

/** 菜单图标比例：命中预设用该预设（original 用源图比例），自定义用当前框实际比例 */
function triggerIconRatio(
  matched: OutpaintPresetKey | null,
  sourceSize: { width: number; height: number },
  expands: ExpandSides,
): string {
  if (matched === 'original' || matched === null) {
    if (matched === 'original') return `${sourceSize.width}:${sourceSize.height}`;
    const boxW = sourceSize.width + expands.left + expands.right;
    const boxH = sourceSize.height + expands.top + expands.bottom;
    return `${boxW}:${boxH}`;
  }
  return matched;
}

export default function OutpaintDialog({
  onClose,
  sourceSize,
  expands,
  onPresetSelect,
  onSend,
  followAnchor,
}: OutpaintDialogProps) {
  const availability = outpaintPresetAvailability(sourceSize, maxExpandPerSide(sourceSize));
  const matched = matchOutpaintPreset(expands, sourceSize);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLDivElement | null>(null);

  /** 点外关闭比例菜单（口径同 MediaNode 高清 ▾ 菜单：document pointerdown） */
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuAnchorRef.current && !menuAnchorRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  /** 零扩展（框与原图重合）发送置灰：零扩展无任务意义（契约 refine 同口径兜底） */
  const zeroExpand =
    expands.top <= 0 && expands.right <= 0 && expands.bottom <= 0 && expands.left <= 0;
  const canSend = !zeroExpand;
  const sendDisabledReason = '先拖动扩展框选择要扩展的范围';
  const triggerLabel = matched ? OUTPAINT_PRESET_LABELS[matched] : '自定义';

  /** 置灰守卫（口径同 ImageEnhanceDialog：aria-disabled + 点击守卫，title 保留悬停原因） */
  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
      data-gen-panel-territory
    >
      <div className={styles.toolbar} data-testid="outpaint-dialog">
        <button type="button" className={styles.iconBtn} onClick={onClose} title="退出扩图" data-testid="outpaint-close">
          <X size={14} strokeWidth={2} />
        </button>
        <span className={styles.divider} aria-hidden />

        <div className={styles.menuAnchor} ref={menuAnchorRef}>
          <button
            type="button"
            className={styles.triggerBtn}
            aria-haspopup="menu"
            aria-expanded={menuOpen || undefined}
            title="选择扩展后的画面比例"
            data-testid="outpaint-ratio-trigger"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <RatioIcon ratio={triggerIconRatio(matched, sourceSize, expands)} size={14} />
            <span>{triggerLabel}</span>
            <ChevronDown size={12} strokeWidth={2} />
          </button>
          {menuOpen && (
            <div className={styles.menuPopup} role="menu" data-testid="outpaint-ratio-menu">
              {/* 自定义：手动拖拽后的被动状态展示，不可主动点选（规格故事 32） */}
              <span
                className={`${styles.menuChip} ${matched === null ? styles.menuChipActive : ''}`}
                data-testid="outpaint-preset-custom"
                title={matched === null ? '当前为手动拖拽出的自定义比例' : undefined}
              >
                自定义
              </span>
              {OUTPAINT_PRESET_ORDER.map((key) => {
                const disabledReason = availability[key];
                const active = matched === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    aria-disabled={!!disabledReason || undefined}
                    title={disabledReason ?? undefined}
                    className={`${styles.menuItem} ${active ? styles.menuItemActive : ''}`}
                    data-testid={`outpaint-preset-${key.replace(':', '-')}`}
                    onClick={guarded(!!disabledReason, () => {
                      onPresetSelect(key);
                      setMenuOpen(false);
                    })}
                  >
                    <RatioIcon
                      ratio={key === 'original' ? `${sourceSize.width}:${sourceSize.height}` : key}
                      size={14}
                    />
                    <span>{OUTPAINT_PRESET_LABELS[key]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 张数：固定「1张」禁用展示（多张生成未开放，规格故事 33 / Out of Scope） */}
        <button type="button" className={styles.countBtn} disabled title="多张生成暂未开放，本期固定生成 1 张" data-testid="outpaint-count">
          <span>1张</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>

        <span className={styles.freeHint}>本期免费</span>

        <button
          type="button"
          className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
          onClick={guarded(!canSend, onSend)}
          disabled={!canSend}
          title={zeroExpand ? sendDisabledReason : '发送'}
          data-testid="outpaint-send-btn"
        >
          <ArrowUp size={14} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}
