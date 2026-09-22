/* ============================================
 * ImageEnhanceDialog 高清放大参数面板（IKGM9O）
 * 跟随锚定在高清卡下方的轻量面板：无提示词输入框、无参考栏。
 * 锚定/拖动跟随/点外关闭/Esc 关闭/发送后关闭/生成中只读冻结沿用既有面板约定
 * （关闭与领土豁免由 CanvasPage 的 dismissAllGenPanels / data-gen-panel-territory 承载）。
 * 本期免费（规格 Out of Scope）：不渲染积分预估、提交不走余额拦截门。
 * ============================================ */
import { useState } from 'react';
import { X, ArrowUp } from 'lucide-react';
import {
  IMAGE_ENHANCE_DEFAULTS,
  IMAGE_ENHANCE_MULTIPLES,
  IMAGE_ENHANCE_TIER_CAPABILITY,
  type ImageEnhanceVersionTier,
} from '@lib/contracts/image-enhance';
import {
  IMAGE_ENHANCE_MODE_LABELS,
  IMAGE_ENHANCE_TIER_LABELS,
  freezeImageEnhanceParams,
  imageEnhanceTierAvailability,
  pickImageEnhanceTier,
  type ImageEnhancePanelParams,
} from '../../imageEnhance';
import type { FollowDialogAnchor } from '../../followDialog';
import ProviderModelSelect from './ProviderModelSelect';
import styles from './index.module.css';

interface ImageEnhanceDialogProps {
  onClose: () => void;
  /** 发送：携带冻结后的四键面板参数；返回 true 表示创建请求已发出（父级据此自动关面板） */
  onSend: (params: ImageEnhancePanelParams) => boolean | Promise<boolean>;
  /** 源图尺寸（打开面板时的快照，预检口径）；缺省不拦（服务端同口径放行交供应商拒） */
  sourceDims?: { width?: number; height?: number } | null;
  /** 回填上次参数（node.data.imageEnhance.lastParams 恢复；缺省用契约默认值） */
  initialParams?: ImageEnhancePanelParams | null;
  /** 生成中：参数只读冻结（保留查看；工具卡不开放取消） */
  generating?: boolean;
  /** 提交中（保存/提交期间只读，同图片面板 submitting 口径） */
  submitting?: boolean;
  /** 绑定高清卡时悬浮跟随其下方；缺省锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
}

/** 两级下拉静态配置：供应商级当前仅 MediaKit（规格 Out of Scope：Topazlabs 等第二供应商后续接入） */
const PROVIDER_GROUPS = [
  {
    providerId: 'mediakit',
    providerLabel: 'MediaKit',
    models: (['lite', 'pro', 'max'] as ImageEnhanceVersionTier[]).map((tier) => ({
      value: tier,
      label: IMAGE_ENHANCE_TIER_LABELS[tier],
    })),
  },
];

export default function ImageEnhanceDialog({
  onClose,
  onSend,
  sourceDims,
  initialParams,
  generating,
  submitting,
  followAnchor,
}: ImageEnhanceDialogProps) {
  /** 打开面板时对源图尺寸预检一次（快照）；默认档不可用自动落到第一个可用档 */
  const [versionTier, setVersionTier] = useState<ImageEnhanceVersionTier>(() => {
    const preferred = initialParams?.version_tier ?? IMAGE_ENHANCE_DEFAULTS.versionTier;
    return pickImageEnhanceTier(preferred, sourceDims?.width, sourceDims?.height) ?? preferred;
  });
  const [multiple, setMultiple] = useState<ImageEnhancePanelParams['multiple']>(
    () => initialParams?.multiple ?? IMAGE_ENHANCE_DEFAULTS.multiple,
  );
  const [generativeMode, setGenerativeMode] =
    useState<ImageEnhancePanelParams['generative_enhance_mode']>(
      () => initialParams?.generative_enhance_mode ?? IMAGE_ENHANCE_DEFAULTS.generativeEnhanceMode,
    );
  const [correctColor, setCorrectColor] = useState<boolean>(
    () => initialParams?.enable_correct_color ?? IMAGE_ENHANCE_DEFAULTS.enableCorrectColor,
  );

  const readOnly = generating === true || submitting === true;
  const readOnlyReason = generating
    ? '生成中，参数只读'
    : '正在保存并提交，参数只读';

  /** 三档可用性（快照预检结果）：模型下拉选项置灰与发送门共用 */
  const tierAvailability = imageEnhanceTierAvailability(sourceDims?.width, sourceDims?.height).map(
    (t) => ({ ...t, value: t.tier }),
  );
  const allTiersDisabled = tierAvailability.every((t) => t.disabledReason);
  const allDisabledReason = '源图尺寸不满足任何版本档门槛，请更换源图后再试';

  /** 版本能力矩阵（契约）：增强策略仅 pro/max、色彩校正仅 max；不支持的控件常驻置灰并悬停说明 */
  const capability = IMAGE_ENHANCE_TIER_CAPABILITY[versionTier];
  const modeUnsupportedReason = capability.enhanceMode ? null : 'Lite 版本不支持增强策略';
  const colorUnsupportedReason = capability.correctColor ? null : '仅 Max 版本支持色彩校正';
  /** 置灰档展示冻结值（与服务端硬校验同口径）：Lite 显示生成度优先、非 Max 显示关 */
  const displayMode = capability.enhanceMode ? generativeMode : IMAGE_ENHANCE_DEFAULTS.generativeEnhanceMode;
  const displayColor = capability.correctColor ? correctColor : false;

  const canSend = !readOnly && !allTiersDisabled;

  /** 发送：冻结后四键交父级组六键调创建接口；创建请求发出由父级关面板 */
  const handleSend = () => {
    if (!canSend) return;
    const issued = onSend(
      freezeImageEnhanceParams({
        version_tier: versionTier,
        multiple,
        generative_enhance_mode: generativeMode,
        enable_correct_color: correctColor,
      }),
    );
    void Promise.resolve(issued);
  };

  /** 置灰守卫（口径同附件操作条：aria-disabled + 点击守卫，title 保留悬停原因） */
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
      <div className={styles.dialog}>
        <div className={styles.headerRow}>
          <span className={styles.title}>高清放大</span>
          <button type="button" className={styles.iconBtn} onClick={onClose} title="关闭">
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {readOnly && <div className={styles.readOnlyHint}>{readOnlyReason}</div>}

        <ProviderModelSelect
          groups={PROVIDER_GROUPS.map((g) => ({
            providerId: g.providerId,
            providerLabel: g.providerLabel,
            models: g.models.map((m) => ({
              ...m,
              disabledReason: tierAvailability.find((t) => t.value === m.value)?.disabledReason ?? null,
            })),
          }))}
          value={versionTier}
          onModelChange={setVersionTier}
          readOnly={readOnly}
        />

        {/* 放大倍数：复用宽高比分段按钮视觉模式 */}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>放大倍数</span>
          <div className={styles.multipleGroup}>
            {IMAGE_ENHANCE_MULTIPLES.map((m) => (
              <button
                key={m}
                type="button"
                className={`${styles.multipleBtn} ${m === multiple ? styles.multipleBtnActive : ''}`}
                data-testid={`enhance-multiple-${m}`}
                onClick={guarded(readOnly, () => setMultiple(m))}
                disabled={readOnly}
              >
                {m}x
              </button>
            ))}
          </div>
        </div>

        {/* 高级参数常驻：不支持时置灰并悬停说明（沿用附件操作条置灰口径） */}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>高级参数</span>
          <div className={styles.multipleGroup}>
            {(['generative_first', 'fidelity_first'] as const).map((mode) => {
              const disabled = !!modeUnsupportedReason || readOnly;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-disabled={disabled || undefined}
                  title={modeUnsupportedReason ?? undefined}
                  className={`${styles.multipleBtn} ${mode === displayMode ? styles.multipleBtnActive : ''}`}
                  data-testid={`enhance-mode-${mode}`}
                  onClick={guarded(disabled, () => setGenerativeMode(mode))}
                >
                  {IMAGE_ENHANCE_MODE_LABELS[mode]}
                </button>
              );
            })}
          </div>
          <label
            className={styles.switchRow}
            aria-disabled={!!colorUnsupportedReason || readOnly || undefined}
            title={colorUnsupportedReason ?? undefined}
            data-testid="enhance-color-row"
          >
            <input
              type="checkbox"
              checked={displayColor}
              data-testid="enhance-color-toggle"
              onChange={guarded(!!colorUnsupportedReason || readOnly, () => setCorrectColor(!correctColor))}
            />
            <span>色彩校正</span>
          </label>
        </div>

        {allTiersDisabled && <div role="alert" className={styles.allDisabledHint}>{allDisabledReason}</div>}

        <div className={styles.bottomBar}>
          <span className={styles.freeHint}>本期免费</span>
          <button
            type="button"
            className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!canSend}
            title={allTiersDisabled ? allDisabledReason : readOnly ? readOnlyReason : '发送'}
            data-testid="enhance-send-btn"
          >
            <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
