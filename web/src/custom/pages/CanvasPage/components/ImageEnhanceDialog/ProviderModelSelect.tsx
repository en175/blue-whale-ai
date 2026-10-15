import { useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

export interface ProviderModelOption<M extends string> {
  value: M;
  label: string;
  disabledReason?: string | null;
}

export interface ProviderModelGroup<M extends string> {
  providerId: string;
  providerLabel: string;
  models: Array<ProviderModelOption<M>>;
}

interface ProviderModelSelectProps<M extends string> {
  groups: Array<ProviderModelGroup<M>>;
  value: M;
  onModelChange: (model: M) => void;
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

  const currentGroup = groups.find((g) => g.models.some((m) => m.value === value)) ?? groups[0];
  const currentModel = currentGroup?.models.find((m) => m.value === value);
  const currentLabel = currentModel?.label ?? '选择模型';

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
                    if (disabled) return;
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
