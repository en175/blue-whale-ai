import Select from '@/custom/components/Select';
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
  const currentGroup = groups.find((g) => g.models.some((m) => m.value === value)) ?? groups[0];
  const currentModel = currentGroup?.models.find((m) => m.value === value);

  const handlePickProvider = (providerId: string) => {
    const group = groups.find((g) => g.providerId === providerId);
    if (!group || group.providerId === currentGroup?.providerId) return;
    if (group.models.some((m) => m.value === value && !m.disabledReason)) return;
    const fallback = group.models.find((m) => !m.disabledReason) ?? group.models[0];
    if (fallback) onModelChange(fallback.value);
  };

  return (
    <div className={styles.providerModelRow}>
      <div className={styles.fieldWrap}>
        <span className={styles.fieldLabel}>模型选择</span>
        <Select
          value={currentGroup?.providerId ?? ''}
          onChange={handlePickProvider}
          disabled={readOnly}
          side="bottom"
          testId="enhance-provider-btn"
          ariaLabel="选择服务商"
          placeholder="选择服务商"
          options={groups.map((g) => ({
            value: g.providerId,
            label: g.providerLabel,
            testId: `enhance-provider-option-${g.providerId}`,
          }))}
        />
      </div>
      <div className={styles.fieldWrap}>
        <span className={styles.fieldLabel}>模型</span>
        <Select
          value={value}
          onChange={onModelChange}
          disabled={readOnly}
          side="bottom"
          testId="enhance-model-btn"
          ariaLabel="选择模型"
          placeholder={currentModel?.label ?? '选择模型'}
          options={(currentGroup?.models ?? []).map((m) => ({
            value: m.value,
            label: m.label,
            disabled: !!m.disabledReason,
            title: m.disabledReason ?? undefined,
            testId: `enhance-model-option-${m.value}`,
          }))}
        />
      </div>
    </div>
  );
}
