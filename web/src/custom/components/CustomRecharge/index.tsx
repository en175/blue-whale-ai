import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import DragSlider from '@/custom/components/DragSlider';
import type { SliderScale } from '@/custom/components/DragSlider/dragSliderModel';
import { fetchRechargeCustomConfig, type RechargeCustomConfig } from '@/custom/api/recharge';
import {
  customPriceFen,
  formatCredits,
  formatPriceYuan,
  snapCredits,
  validateCredits,
} from '@/shared/utils/customRecharge';
import styles from './index.module.css';

export function createCreditsScale(config: RechargeCustomConfig): SliderScale {
  const min = Math.max(1, config.min_credits);
  const max = Math.max(min + 1, config.max_credits);
  const logSpan = Math.log(max / min);
  return {
    ratioFromValue: (value) =>
      Math.min(1, Math.max(0, Math.log(Math.max(min, value) / min) / logSpan)),
    valueFromRatio: (ratio) =>
      Math.round(min * Math.exp(logSpan * Math.min(1, Math.max(0, ratio)))),
    stepValue: (value) => snapCredits(value, config),
  };
}

export interface CustomRechargeProps {
  onConfirm: (credits: number) => void;
  onRequireLogin?: () => void;
  submitting?: boolean;
  locked?: boolean;
  error?: string;
  config?: RechargeCustomConfig;
}

export default function CustomRecharge({
  onConfirm,
  onRequireLogin,
  submitting = false,
  locked = false,
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
  const interactionLocked = locked || paying || denied;

  const preview = draft === null ? credits : snapCredits(Number(draft), config);
  const previewFen = customPriceFen(preview, config.credits_per_yuan);
  const sliderScale = createCreditsScale(config);

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
    if (denied || paying || locked) return;
    if (validateCredits(final, config) !== null) return;
    onConfirm(final);
  };

  const buyLabel = tourist
    ? '登录后购买'
    : denied
      ? '暂不可购买'
      : paying
        ? '下单中…'
        : `¥${formatPriceYuan(previewFen)} 购买`;
  const validity =
    config.credits_valid_months > 0 && config.credits_valid_months % 12 === 0
      ? `${config.credits_valid_months / 12} 年长期有效`
      : config.credits_valid_months > 0
        ? `${config.credits_valid_months} 个月长期有效`
        : '';

  return (
    <section className={styles.section} aria-label="自定义充值">
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>自定义充值</h3>
      </div>
      <article className={styles.card}>
        <div className={styles.summary}>
          <h4 className={styles.title}>自定义充值</h4>
          <div className={styles.pointsLine}>
            <Zap size={22} strokeWidth={2.4} className={styles.bolt} />
            <strong className={styles.pointsValue}>{formatCredits(preview)}</strong>
          </div>
        </div>

        <div className={styles.controls}>
          <div className={styles.controlRow}>
            <DragSlider
              className={styles.slider}
              min={config.min_credits}
              max={config.max_credits}
              step={config.step_credits}
              value={preview}
              scale={sliderScale}
              disabled={interactionLocked}
              ariaLabel="积分数量"
              onChange={(next) => {
                setCorrection('');
                setDraft(null);
                setCredits(next);
              }}
            />
            <div className={styles.inputWrap}>
              <input
                className={styles.input}
                type="text"
                inputMode="numeric"
                aria-label="手动输入积分数量"
                disabled={interactionLocked}
                value={draft ?? String(credits)}
                onChange={(e) => {
                  setCorrection('');
                  setDraft(e.target.value);
                }}
                onBlur={commitDraft}
              />
            </div>
          </div>
          <div className={styles.rangeLabels}>
            <span>{formatCredits(config.min_credits)} 积分</span>
            <span>
              {formatCredits(config.max_credits)} 积分 · 步长 {formatCredits(config.step_credits)}
            </span>
          </div>
          {correction && <span className={styles.correction}>{correction}</span>}
          {denied && <span className={styles.denied}>{config.denied_hint}</span>}
          {error && <span className={styles.error}>{error}</span>}
        </div>

        <div className={styles.side}>
          {tourist && (
            <span className={styles.livePrice} aria-label="应付金额">
              ¥{formatPriceYuan(previewFen)}
            </span>
          )}
          <button
            className={styles.buyBtn}
            type="button"
            onClick={handleBuy}
            disabled={interactionLocked}
          >
            {buyLabel}
          </button>
          <span className={styles.hint}>
            全模型可用{validity ? ` · ${validity}` : ''}
          </span>
        </div>
      </article>
    </section>
  );
}
