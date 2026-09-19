/* ============================================
 * ProviderModelSelect 两级「供应商 → 模型」下拉（IKGM9O 新组件）
 * 全站此前只有平铺单级下拉；高清放大按规格需要呈现两级关系：
 * 「模型选择」= 供应商级（本票静态仅 MediaKit 一项，不进模型能力目录），
 * 「模型」= 模型级（Lite / Pro / Max，选项随供应商联动）。
 * UI 形态沿用全站既有下拉（selectBtn/selectDropdown/selectOption 视觉模式）。
 * ============================================ */
import { useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

/** 模型级选项：disabledReason 非空时常显置灰并悬停说明原因（口径同附件操作条，aria-disabled 保留 tooltip） */
export interface ProviderModelOption<M extends string> {
  value: M;
  label: string;
  disabledReason?: string | null;
}

/** 供应商级分组：每个供应商持有自己的模型清单（两级关系的联动来源） */
export interface ProviderModelGroup<M extends string> {
  providerId: string;
  providerLabel: string;
  models: Array<ProviderModelOption<M>>;
}

interface ProviderModelSelectProps<M extends string> {
  /** 静态两级配置（本票仅 MediaKit；后续接第二供应商时只改配置不改组件） */
  groups: Array<ProviderModelGroup<M>>;
  /** 当前选中模型（模型级值） */
  value: M;
  onModelChange: (model: M) => void;
  /** 只读冻结（生成中/提交中） */
  readOnly?: boolean;
}

export default function ProviderModelSelect<M extends string>({
  groups,
  value,
  onModelChange,
  readOnly = false,
}: ProviderModelSelectProps<M>) {
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const providerWrapRef = useRef<HTMLDivElement>(null);
  const modelWrapRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: providerOpen, ref: providerWrapRef, dismiss: () => setProviderOpen(false) },
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
  ]);

  /** 当前值所在的供应商组（值与组配置失配时回落首组，保证恒有可选模型） */
  const currentGroup = groups.find((g) => g.models.some((m) => m.value === value)) ?? groups[0];
  const currentModel = currentGroup?.models.find((m) => m.value === value);
  const currentLabel = currentModel?.label ?? '选择模型';

  /** 供应商切换联动：新供应商不含当前模型时自动落到其第一个可用模型 */
  const handlePickProvider = (group: ProviderModelGroup<M>) => {
    setProviderOpen(false);
    if (group.providerId === currentGroup?.providerId) return;
    if (group.models.some((m) => m.value === value && !m.disabledReason)) return;
    const fallback = group.models.find((m) => !m.disabledReason) ?? group.models[0];
    if (fallback) onModelChange(fallback.value);
  };

  return (
    <div className={styles.providerModelRow}>
      <div className={styles.fieldWrap} ref={providerWrapRef}>
        <span className={styles.fieldLabel}>模型选择</span>
        <button
          type="button"
          className={styles.selectBtn}
          data-testid="enhance-provider-btn"
          onClick={() => { setProviderOpen(!providerOpen); setModelOpen(false); }}
          disabled={readOnly}
        >
          <span>{currentGroup?.providerLabel ?? '选择服务商'}</span>
          <ChevronDown size={14} strokeWidth={2} className={`${styles.selectArrow} ${providerOpen ? styles.selectArrowUp : ''}`} />
        </button>
        {providerOpen && (
          <div className={styles.selectDropdown}>
            {groups.map((g) => (
              <button
                key={g.providerId}
                type="button"
                className={`${styles.selectOption} ${g.providerId === currentGroup?.providerId ? styles.selectOptionActive : ''}`}
                onClick={() => handlePickProvider(g)}
              >
                {g.providerLabel}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.fieldWrap} ref={modelWrapRef}>
        <span className={styles.fieldLabel}>模型</span>
        <button
          type="button"
          className={styles.selectBtn}
          data-testid="enhance-model-btn"
          onClick={() => { setModelOpen(!modelOpen); setProviderOpen(false); }}
          disabled={readOnly}
        >
          <span>{currentLabel}</span>
          <ChevronDown size={14} strokeWidth={2} className={`${styles.selectArrow} ${modelOpen ? styles.selectArrowUp : ''}`} />
        </button>
        {modelOpen && (
          <div className={styles.selectDropdown}>
            {currentGroup?.models.map((m) => {
              const disabled = !!m.disabledReason;
              return (
                <button
                  key={m.value}
                  type="button"
                  aria-disabled={disabled || undefined}
                  title={m.disabledReason ?? undefined}
                  className={`${styles.selectOption} ${m.value === value ? styles.selectOptionActive : ''}`}
                  data-testid={`enhance-model-option-${m.value}`}
                  onClick={() => {
                    if (disabled) return; // 置灰守卫：不可用档不可选（原因悬停可见）
                    onModelChange(m.value);
                    setModelOpen(false);
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
