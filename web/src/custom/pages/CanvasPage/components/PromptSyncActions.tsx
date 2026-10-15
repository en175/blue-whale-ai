import styles from './PromptSyncActions.module.css';

export default function PromptSyncActions({ plans, disabled, onSync }: {
  plans?: Array<{ nodeId: string; title: string }>;
  disabled?: boolean;
  onSync?: (nodeId: string) => void;
}) {
  return plans?.map(plan => <div className={styles.row} key={plan.nodeId}>
    <span className={styles.title}>{plan.title} · 素材待同步</span>
    <button type="button" disabled={disabled} onClick={() => onSync?.(plan.nodeId)}>同步素材到目标</button>
  </div>);
}
