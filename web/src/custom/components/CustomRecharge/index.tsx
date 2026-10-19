import { useEffect, useState } from 'react';
import DragSlider from '@/custom/components/DragSlider';
import { fetchRechargeCustomConfig, type RechargeCustomConfig } from '@/custom/api/recharge';
import {
  customPriceFen,
  formatCredits,
  formatPriceYuan,
  snapCredits,
  validateCredits,
} from '@/shared/utils/customRecharge';
import styles from './index.module.css';

export interface CustomRechargeProps {
  onConfirm: (credits: number) => void;
  onRequireLogin?: () => void;
  submitting?: boolean;
  error?: string;
  config?: RechargeCustomConfig;
}

export default function CustomRecharge({
  onConfirm,
  onRequireLogin,
  submitting = false,
  error = '',
  config: injected,
}: CustomRechargeProps) {
  const [fetched, setFetched] = useState<RechargeCustomConfig | null>(null);
  const config = injected ?? fetched;
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(injected === undefined);
  const [credits, setCredits] = useState(() =>
    injected ? snapCredits(injected.default_credits, injected) : 0,
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [correction, setCorrection] = useState('');

  useEffect(() => {
    if (injected !== undefined) return;
    let alive = true;
    fetchRechargeCustomConfig()
      .then((data) => {
        if (!alive) return;
        setFetched(data);
        setCredits(snapCredits(data.default_credits, data));
      })
      .catch((e) => {
        if (alive) setLoadError(e instanceof Error ? e.message : '自定义充值加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [injected]);

  if (loading) return <div className={styles.loading}>自定义充值加载中…</div>;
  if (!config || loadError) return null;
  if (!config.enabled) return null;

  const tourist = config.can_purchase === null;
  const denied = config.can_purchase === false;
  const paying = submitting;
  const locked = paying || denied;

  const preview = draft === null ? credits : snapCredits(Number(draft), config);
  const previewFen = customPriceFen(preview, config.credits_per_yuan);

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = draft.trim() === '' ? null : Number(draft);
    const snapped = snapCredits(parsed, config);
    setCredits(snapped);
    setDraft(null);
    const unchanged = parsed !== null && Number.isFinite(parsed) && parsed === snapped;
    setCorrection(unchanged ? '' : `已修正为 ${formatCredits(snapped)} 积分`);
  };

  const handleBuy = () => {
    const final = draft === null ? credits : snapCredits(Number(draft), config);
    setCorrection('');
    setDraft(null);
    setCredits(final);

    if (tourist) {
      onRequireLogin?.();
      return;
    }
    if (denied || paying) return;
    if (validateCredits(final, config) !== null) return;
    onConfirm(final);
  };

  const invalid = draft !== null && validateCredits(Number(draft), config) !== null;
  const buyLabel = tourist
    ? '登录后购买'
    : denied
      ? '暂不可购买'
      : paying
        ? '下单中…'
        : `¥${formatPriceYuan(previewFen)} 购买`;

  return (
    <section className={styles.section} aria-label="自定义充值">
      <div className={styles.header}>
        <h3 className={styles.title}>自定义充值</h3>
        {}
        <span className={styles.rangeHint}>
          {formatCredits(config.min_credits)} – {formatCredits(config.max_credits)} 积分
        </span>
      </div>

      <div className={styles.controlRow}>
        {}
        <DragSlider
          className={styles.slider}
          min={config.min_credits}
          max={config.max_credits}
          step={config.step_credits}
          value={credits}
          disabled={locked}
          ariaLabel="积分数量"
          onChange={(next) => {
            setCorrection('');
            setDraft(null);
            setCredits(next);
          }}
        />
        <div className={`${styles.inputWrap} ${invalid ? styles.inputWrapInvalid : ''}`}>
          <input
            className={styles.input}
            type="text"
            inputMode="numeric"
            aria-label="手动输入积分数量"
            disabled={locked}
            value={draft ?? String(credits)}
            onChange={(e) => {
              setCorrection('');
              setDraft(e.target.value);
            }}
            onBlur={commitDraft}
          />
          <span className={styles.inputSuffix}>积分</span>
        </div>
      </div>

      {correction && <span className={styles.correction}>{correction}</span>}
      {denied && <span className={styles.denied}>{config.denied_hint}</span>}
      {error && <span className={styles.error}>{error}</span>}

      <div className={styles.footer}>
        {}
        <span className={styles.price} aria-label="应付金额">
          ¥{formatPriceYuan(previewFen)}
          <span className={styles.priceUnit}>{formatCredits(preview)} 积分</span>
        </span>
        {}
        <button
          className={styles.buyBtn}
          type="button"
          onClick={handleBuy}
          disabled={paying || denied}
        >
          {buyLabel}
        </button>
      </div>
    </section>
  );
}
