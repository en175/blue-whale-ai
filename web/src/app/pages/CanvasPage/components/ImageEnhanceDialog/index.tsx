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
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import ProviderModelSelect from './ProviderModelSelect';
import styles from './index.module.css';

interface ImageEnhanceDialogProps {
  onClose: () => void;
  onSend: (params: ImageEnhancePanelParams) => boolean | Promise<boolean>;
  sourceDims?: { width?: number; height?: number } | null;
  initialParams?: ImageEnhancePanelParams | null;
  generating?: boolean;
  submitting?: boolean;
  followAnchor?: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

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
  followAnchor, dragHidden,
}: ImageEnhanceDialogProps) {
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

  const tierAvailability = imageEnhanceTierAvailability(sourceDims?.width, sourceDims?.height).map(
    (t) => ({ ...t, value: t.tier }),
  );
  const allTiersDisabled = tierAvailability.every((t) => t.disabledReason);
  const allDisabledReason = '源图尺寸不满足任何版本档门槛，请更换源图后再试';

  const capability = IMAGE_ENHANCE_TIER_CAPABILITY[versionTier];
  const modeUnsupportedReason = capability.enhanceMode ? null : 'Lite 版本不支持增强策略';
  const colorUnsupportedReason = capability.correctColor ? null : '仅 Max 版本支持色彩校正';
  const displayMode = capability.enhanceMode ? generativeMode : IMAGE_ENHANCE_DEFAULTS.generativeEnhanceMode;
  const displayColor = capability.correctColor ? correctColor : false;

  const canSend = !readOnly && !allTiersDisabled;

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

  const guarded = (disabled: boolean, dispatch: () => void) => () => {
    if (disabled) return;
    dispatch();
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
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

        {}
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

        {}
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
