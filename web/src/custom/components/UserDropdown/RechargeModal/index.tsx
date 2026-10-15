import { useEffect, useState } from 'react';
import { Check, CreditCard, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from '@/custom/components/Toast';
import Modal from '@/custom/components/Modal';
import CustomRecharge from '@/custom/components/CustomRecharge';
import styles from './index.module.css';
import { fetchCredits } from '@/custom/api/auth';
import {
  createCustomRechargeOrder,
  createRechargeOrder,
  fetchRechargeCustomConfig,
  fetchRechargeOrderStatus,
  fetchRechargeTierCatalog,
  type RechargeCustomConfig,
  type RechargeOrder,
  type RechargeTierCatalog,
} from '@/custom/api/recharge';
import { customPriceFen } from '@/shared/utils/customRecharge';
import { useAuthStore } from '@/shared/stores/auth';

interface RechargeModalProps {
  onClose: () => void;
}

const PERKS = ['积分即时到账', '支持全部模型调用'];

const GRANT_FAILED_HINT = '积分发放异常，请联系客服';

type Phase = 'idle' | 'creating' | 'waiting' | 'paid' | 'expired' | 'failed';

type Mode = 'tier' | 'custom';

const RECHARGE_AGREEMENT_HREF =
  'https://static-bluewhale.yunjizi.cn/agreement/recharge-agreement.html';

const fmtPrice = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function fmtDiscount(discount?: number | null) {
  if (!discount || discount >= 1) return '';
  const pct = Math.round(discount * 100);
  return `现价 ${pct}%`;
}

function fmtExpiry(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} 后过期`;
}

function fmtValidMonths(months: number) {
  if (!Number.isFinite(months) || months <= 0) return '';
  return months % 12 === 0 ? `${months / 12} 年` : `${months} 个月`;
}

const toFen = (yuan: number) => Math.round(yuan * 100);

async function refreshCredits() {
  try {
    const d = await fetchCredits({ fresh: true });
    useAuthStore.getState().setUsage(d);
  } catch {
  }
}

export default function RechargeModal({ onClose }: RechargeModalProps) {
  const [catalog, setCatalog] = useState<RechargeTierCatalog | null>(null);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [tiersError, setTiersError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<RechargeOrder | null>(null);
  const [orderError, setOrderError] = useState('');
  const [mode, setMode] = useState<Mode>('tier');
  const [customConfig, setCustomConfig] = useState<RechargeCustomConfig | null>(null);
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const [customError, setCustomError] = useState('');
  const [creditsPending, setCreditsPending] = useState(false);
  const [grantFailed, setGrantFailed] = useState(false);
  const [priceChanged, setPriceChanged] = useState(false);

  const credits = useAuthStore((s) => s.credits);

  const tiers = catalog?.tiers ?? [];
  const selected = tiers.find((t) => t.id === selectedId) ?? null;
  const paying = phase === 'creating' || phase === 'waiting';
  const selectedDenied = selected?.can_purchase === false;
  const showQrPanel =
    phase === 'waiting' || phase === 'paid' || phase === 'expired' || phase === 'failed';
  const locked = paying;
  const customAvailable = customConfig?.enabled === true;
  const showCustomPanel = mode === 'custom' && customConfig !== null;

  useEffect(() => {
    let alive = true;
    fetchRechargeTierCatalog()
      .then((data) => {
        if (!alive) return;
        setCatalog({
          credits_per_yuan: data.credits_per_yuan,
          tiers: [...data.tiers].sort((a, b) => a.sort_order - b.sort_order),
        });
      })
      .catch((e) => {
        if (alive) setTiersError(e instanceof Error ? e.message : '档位加载失败');
      })
      .finally(() => {
        if (alive) setTiersLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchRechargeCustomConfig()
      .then((data) => {
        if (alive) setCustomConfig(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'waiting' || !order) return;
    let alive = true;
    const tick = () => {
      fetchRechargeOrderStatus(order.trade_no)
        .then((st) => {
          if (!alive) return;
          if (st.status === 'paid') {
            setPhase('paid');
            setGrantFailed(false);
            toast.success('支付成功，积分已到账');
            void refreshCredits();
          } else if (st.status === 'expired' || st.status === 'failed') {
            setPhase(st.status);
          } else if (st.status === 'paid_pending') {
            setCreditsPending(true);
            setGrantFailed(false);
          } else if (st.status === 'grant_failed') {
            setCreditsPending(true);
            setGrantFailed(true);
          }
        })
        .catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, order]);

  const handleConfirm = () => {
    if (!selected || paying || phase === 'paid' || selectedDenied) return;
    setOrderError('');
    setPriceChanged(false);
    setCreditsPending(false);
    setGrantFailed(false);
    setPhase('creating');
    const shownFen = toFen(selected.price);
    createRechargeOrder(selected.id)
      .then((o) => {
        setOrder(o);
        setPriceChanged(toFen(o.amount) !== shownFen);
        setPhase('waiting');
      })
      .catch((e) => {
        setOrderError(e instanceof Error ? e.message : '创建订单失败');
        setPhase('idle');
      });
  };

  const handleCustomConfirm = (customCredits: number) => {
    if (paying) return;
    setCustomError('');
    setOrderError('');
    setPriceChanged(false);
    setCreditsPending(false);
    setGrantFailed(false);
    setCustomSubmitting(true);
    setPhase('creating');
    const shownFen = customConfig
      ? customPriceFen(customCredits, customConfig.credits_per_yuan)
      : null;
    createCustomRechargeOrder(customCredits)
      .then((o) => {
        setOrder(o);
        setPriceChanged(shownFen !== null && toFen(o.amount) !== shownFen);
        setPhase('waiting');
      })
      .catch((e) => {
        setCustomError(e instanceof Error ? e.message : '创建订单失败');
        setPhase('idle');
      })
      .finally(() => setCustomSubmitting(false));
  };

  const handleClose = () => {
    if (phase === 'waiting') void refreshCredits();
    onClose();
  };

  const confirmLabel = !selected
    ? '确认支付'
    : paying
      ? '支付中...'
      : phase === 'paid'
        ? '支付成功'
        : selectedDenied
          ? '暂不可购买'
          : phase === 'expired' || phase === 'failed'
            ? '重新支付'
            : `确认支付 ¥${fmtPrice(selected.price)}`;

  return (
    <Modal
      open
      footer={null}
      onCancel={handleClose}
      width={showQrPanel ? 'min(1600px, calc(100vw - 48px))' : 'min(1200px, calc(100vw - 48px))'}
      ariaLabel="积分充值"
      classNames={{
        container: styles.modal,
        body: styles.body,
      }}
    >
      <div className={styles.content}>
        {}
        <div className={styles.main}>
          <h2 className={styles.title}>积分充值</h2>
          <p className={styles.subtitle}>
            {customAvailable ? '请选择充值方式' : '请选择充值套餐'}
          </p>

          {}
          {customAvailable && (
            <div className={styles.modeTabs} role="tablist" aria-label="充值方式">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'tier'}
                disabled={locked}
                className={`${styles.modeTab} ${mode === 'tier' ? styles.modeTabActive : ''}`}
                onClick={() => setMode('tier')}
              >
                固定积分卡
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'custom'}
                disabled={locked}
                className={`${styles.modeTab} ${mode === 'custom' ? styles.modeTabActive : ''}`}
                onClick={() => setMode('custom')}
              >
                自定义充值
              </button>
            </div>
          )}

          {!showCustomPanel ? (
            <>
              {}
              <p className={styles.unitHint}>
                到账积分与有效期以各档位标注为准
              </p>

              {}
              {tiersLoading ? (
                <div className={styles.emptyHint}>档位加载中…</div>
              ) : tiersError ? (
                <div className={styles.emptyHint}>{tiersError}</div>
              ) : (
                <div className={`${styles.planRow} ${showQrPanel ? styles.planRowPaying : ''}`}>
                  {tiers.map((t) => {
                    const discount = fmtDiscount(t.discount);
                    const denied = t.can_purchase === false;
                    return (
                      <button
                        key={t.id}
                        className={`${styles.planCard} ${t.is_recommended ? styles.planRecommended : ''} ${t.id === selectedId ? styles.planSelected : ''} ${denied ? styles.planDisabled : ''}`}
                        disabled={denied}
                        aria-disabled={denied}
                        onClick={() => {
                          if (!paying && !denied) setSelectedId(t.id);
                        }}
                      >
                        {t.is_recommended && <span className={styles.recBadge}>推荐</span>}
                        {t.id === selectedId && (
                          <span className={styles.selectedBadge}>
                            <Check size={12} strokeWidth={3} />
                            已选
                          </span>
                        )}
                        <span className={styles.planTitle}>{t.amount.toLocaleString()} 积分</span>
                        <span className={styles.planPriceRow}>
                          <span className={styles.planPrice}>¥{fmtPrice(t.price)}</span>
                          {discount && <span className={styles.discountTag}>{discount}</span>}
                        </span>
                        {t.original_price != null && (
                          <span className={styles.planOriginal}>
                            原价 ¥{fmtPrice(t.original_price)}
                          </span>
                        )}
                        {denied ? (
                          <span className={styles.planDeniedHint}>{t.denied_hint}</span>
                        ) : (
                          <>
                            {}
                            <span className={styles.planValidity}>
                              有效期 {fmtValidMonths(t.credits_valid_months)}
                            </span>
                            <div className={styles.perkList}>
                              {PERKS.map((perk) => (
                                <span key={perk} className={styles.perkItem}>
                                  <Check size={14} strokeWidth={2.5} className={styles.perkCheck} />
                                  {perk}
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <CustomRecharge
              config={customConfig}
              onConfirm={handleCustomConfirm}
              submitting={customSubmitting}
              error={customError}
            />
          )}

          {}
          {!showCustomPanel && (
            <div className={styles.bottomBar}>
              {!selected ? (
                <div className={styles.barLeft}>
                  <CreditCard size={18} strokeWidth={2} className={styles.emptyIcon} />
                  <span className={styles.emptyHintText}>请先选择上方套餐</span>
                </div>
              ) : (
                <div className={styles.barLeft}>
                  <span className={styles.balance}>
                    {credits === null ? '--' : credits.toLocaleString()} 积分
                  </span>
                  <span className={styles.selectedInfo}>
                    {selected.amount.toLocaleString()} 积分&nbsp;&nbsp;¥
                    {fmtPrice(selected.price)}
                  </span>
                  {selected.original_price != null && (
                    <span className={styles.barOriginal}>
                      ¥{fmtPrice(selected.original_price)}
                    </span>
                  )}
                  {fmtDiscount(selected.discount) && (
                    <span className={styles.barDiscount}>{fmtDiscount(selected.discount)}</span>
                  )}
                  {orderError && <span className={styles.barError}>{orderError}</span>}
                </div>
              )}
              <div className={styles.barRight}>
                {}
                <button
                  className={`${styles.confirmBtn} ${!selected || paying || phase === 'paid' || selectedDenied ? styles.confirmBtnDisabled : ''}`}
                  onClick={handleConfirm}
                  disabled={!selected || paying || phase === 'paid' || selectedDenied}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          )}
        </div>

        {}
        {showQrPanel && (
          <div className={styles.qrPanel}>
            {order && phase === 'waiting' && (
              <>
                <div className={styles.qrBox}>
                  {order.qr_code_url ? (
                    <QRCodeSVG value={order.qr_code_url} size={192} />
                  ) : (
                    <span className={styles.qrPlaceholder}>二维码不可用</span>
                  )}
                </div>
                <span className={styles.qrExpiry}>{fmtExpiry(order.expire_time)}</span>
                {}
                <span className={styles.qrHint}>请用微信 / 支付宝 / 云闪付 扫码支付</span>
                {}
                {priceChanged && (
                  <span className={styles.qrPriceChanged}>
                    价格已更新为 ¥{fmtPrice(order.amount)}，请确认后再支付
                  </span>
                )}
                <span className={styles.qrAmount}>¥{fmtPrice(order.amount)}</span>
                <span className={styles.qrPoints}>
                  获得 {order.points.toLocaleString()} 积分
                </span>
                <div className={styles.dots}>
                  <span />
                  <span />
                  <span />
                </div>
                <span className={grantFailed ? styles.waitingBad : styles.waiting}>
                  {grantFailed
                    ? GRANT_FAILED_HINT
                    : creditsPending
                      ? '已收到付款，积分发放中…'
                      : '等待支付结果...'}
                </span>
              </>
            )}

            {phase === 'paid' && order && (
              <div className={styles.payState}>
                <CheckCircle2 size={56} strokeWidth={2} className={styles.payStateOk} />
                <span className={styles.payStateTitle}>支付成功</span>
                <span className={styles.qrPoints}>
                  +{order.points.toLocaleString()} 积分已到账
                </span>
              </div>
            )}

            {(phase === 'expired' || phase === 'failed') && (
              <div className={styles.payState}>
                {phase === 'expired' ? (
                  <Clock size={56} strokeWidth={2} className={styles.payStateBad} />
                ) : (
                  <XCircle size={56} strokeWidth={2} className={styles.payStateBad} />
                )}
                <span className={styles.payStateTitle}>
                  {phase === 'expired' ? '二维码已过期' : '支付失败'}
                </span>
                <span className={styles.qrHint}>请点击「重新支付」创建新订单</span>
              </div>
            )}
          </div>
        )}
      </div>

      {}
      <div className={styles.agreement}>
        <span>充值即视为同意</span>
        <a
          className={styles.agreementLink}
          href={RECHARGE_AGREEMENT_HREF}
          target="_blank"
          rel="noopener noreferrer"
        >
          《充值协议》
        </a>
      </div>
    </Modal>
  );
}
