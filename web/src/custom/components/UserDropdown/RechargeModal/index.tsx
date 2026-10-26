import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Clock, ScanLine, XCircle, Zap } from 'lucide-react';
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

type PaySource = { kind: 'tier'; id: string; shownFen: number } | { kind: 'custom'; credits: number; shownFen: number | null };

const RECHARGE_AGREEMENT_HREF =
  'https://static-bluewhale.yunjizi.cn/agreement/recharge-agreement.html';

const fmtPrice = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

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
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<RechargeOrder | null>(null);
  const [orderError, setOrderError] = useState('');
  const [paySource, setPaySource] = useState<PaySource | null>(null);
  const [customConfig, setCustomConfig] = useState<RechargeCustomConfig | null>(null);
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const [customError, setCustomError] = useState('');
  const [creditsPending, setCreditsPending] = useState(false);
  const [grantFailed, setGrantFailed] = useState(false);
  const [priceChanged, setPriceChanged] = useState(false);

  const user = useAuthStore((s) => s.user);
  const tiers = catalog?.tiers ?? [];
  const paying = phase === 'creating' || phase === 'waiting';
  const showPayDialog = phase !== 'idle';
  const customAvailable = customConfig?.enabled === true;
  const guest = !user;

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

  const startPay = () => {
    setOrderError('');
    setCustomError('');
    setPriceChanged(false);
    setCreditsPending(false);
    setGrantFailed(false);
    setPhase('creating');
  };

  const handleBuyTier = (tierId: string, shownPrice: number) => {
    if (paying || phase === 'paid') return;
    const tier = tiers.find((item) => item.id === tierId);
    if (!tier || tier.can_purchase === false) return;
    startPay();
    setPaySource({ kind: 'tier', id: tierId, shownFen: toFen(shownPrice) });
    createRechargeOrder(tierId)
      .then((o) => {
        setOrder(o);
        setPriceChanged(toFen(o.amount) !== toFen(shownPrice));
        setPhase('waiting');
      })
      .catch((e) => {
        setOrderError(e instanceof Error ? e.message : '创建订单失败');
        setPhase('idle');
      });
  };

  const handleCustomConfirm = (customCredits: number) => {
    if (paying) return;
    startPay();
    const shownFen = customConfig
      ? customPriceFen(customCredits, customConfig.credits_per_yuan)
      : null;
    setPaySource({ kind: 'custom', credits: customCredits, shownFen });
    setCustomSubmitting(true);
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

  const handleRetry = () => {
    if (!paySource) return;
    if (paySource.kind === 'tier') {
      const tier = tiers.find((item) => item.id === paySource.id);
      if (!tier) return;
      handleBuyTier(paySource.id, tier.price);
      return;
    }
    handleCustomConfirm(paySource.credits);
  };

  const resetPay = () => {
    if (phase === 'waiting') void refreshCredits();
    setPhase('idle');
    setOrder(null);
    setPaySource(null);
    setCreditsPending(false);
    setGrantFailed(false);
    setPriceChanged(false);
  };

  const handleClose = () => {
    if (phase === 'waiting') void refreshCredits();
    onClose();
  };

  return (
    <Modal
      open
      footer={null}
      onCancel={handleClose}
      width="min(1120px, calc(100vw - 48px))"
      ariaLabel="积分超市"
      classNames={{
        container: styles.modal,
        body: styles.body,
      }}
    >
      <div className={styles.content}>
        <div className={styles.main}>
          <h2 className={styles.title}>积分超市 / 通用积分卡</h2>

          <section className={styles.hero} aria-label="通用积分卡">
            <div className={styles.heroMain}>
              <h3 className={styles.heroTitle}>通用积分卡</h3>
              <p className={styles.heroDesc}>全模型可用，图片、视频、音频和 Agent 任务都能用</p>
              <div className={styles.heroBullets}>
                <span>固定积分卡</span>
                {customAvailable && <span>自定义充值</span>}
                <span>付款后到账</span>
              </div>
            </div>
            {guest && (
              <aside className={styles.heroSide}>
                <strong>登录后可购买全部上架商品</strong>
                <span>价格与积分以后台配置为准，下单时冻结快照；配置变更只影响新订单。</span>
              </aside>
            )}
          </section>

          <section className={styles.tierSection} aria-label="固定积分卡">
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>固定积分卡</h3>
              <p className={styles.sectionDesc}>到账积分与有效期以各档位标注为准</p>
            </div>

            {tiersLoading ? (
              <div className={styles.emptyHint}>档位加载中…</div>
            ) : tiersError ? (
              <div className={styles.emptyHint}>{tiersError}</div>
            ) : (
              <div className={styles.planRow}>
                {tiers.map((t) => {
                  const denied = t.can_purchase === false;
                  return (
                    <article
                      key={t.id}
                      className={`${styles.planCard} ${t.is_recommended ? styles.planRecommended : ''} ${denied ? styles.planDisabled : ''}`}
                    >
                      {t.is_recommended && <span className={styles.recBadge}>推荐</span>}
                      <div className={styles.planPoints}>
                        <Zap size={18} strokeWidth={2.4} className={styles.planBolt} />
                        <strong>{t.amount.toLocaleString()} 积分</strong>
                      </div>
                      <div className={styles.planPrice}>¥{fmtPrice(t.price)}</div>
                      {denied ? (
                        <span className={styles.planDeniedHint}>{t.denied_hint}</span>
                      ) : (
                        <>
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
                          <button
                            type="button"
                            className={`${styles.planBuy} ${t.is_recommended ? styles.planBuyPrimary : ''}`}
                            disabled={paying}
                            onClick={() => handleBuyTier(t.id, t.price)}
                          >
                            {paying && paySource?.kind === 'tier' && paySource.id === t.id
                              ? '支付中...'
                              : '立即购买'}
                          </button>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {orderError && <p className={styles.barError}>{orderError}</p>}
          </section>

          {customAvailable && customConfig && (
            <CustomRecharge
              config={customConfig}
              onConfirm={handleCustomConfirm}
              submitting={customSubmitting}
              error={customError}
              locked={paying}
            />
          )}
        </div>
      </div>

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

      <Modal
        open={showPayDialog}
        footer={null}
        onCancel={resetPay}
        width={440}
        zIndex={260}
        ariaLabel="扫码支付"
        classNames={{
          container: `${styles.payDialog} ${showPayDialog ? styles.checkout : ''}`,
          body: styles.body,
        }}
      >
        <div className={styles.payDialogBody}>
          {phase === 'creating' && <span className={styles.waiting}>正在创建订单...</span>}

          {order && phase === 'waiting' && (
            <>
              <h3 className={styles.checkoutTitle}>自定义充值 {order.points.toLocaleString()} 积分</h3>
              <span className={styles.checkoutCountdown}>
                <ScanLine size={18} strokeWidth={2} className={styles.countdownIcon} />
                <span className={styles.countdownText}>请于十分钟内使用微信 / 支付宝 扫码支付</span>
              </span>
              {priceChanged && (
                <span className={styles.qrPriceChanged}>
                  价格已更新为 ¥{fmtPrice(order.amount)}，请确认后再支付
                </span>
              )}
              <span className={styles.checkoutAmount}>
                <i>¥</i>
                {fmtPrice(order.amount)}
              </span>
              <div className={styles.qrBox}>
                {order.qr_code_url ? (
                  <QRCodeSVG value={order.qr_code_url} size={180} />
                ) : (
                  <span className={styles.qrPlaceholder}>二维码不可用</span>
                )}
              </div>
              <span className={grantFailed ? styles.waitingBad : styles.waiting}>
                {grantFailed
                  ? GRANT_FAILED_HINT
                  : creditsPending
                    ? '已收到付款，积分发放中…'
                    : '等待支付结果...'}
              </span>
              <p className={styles.checkoutNote}>本订单为一次性支付，后续不会产生自动代扣</p>
            </>
          )}

          {phase === 'paid' && order && (
            <div className={styles.payState}>
              <CheckCircle2 size={56} strokeWidth={2} className={styles.payStateOk} />
              <span className={styles.payStateTitle}>支付成功</span>
              <span className={styles.qrPoints}>+{order.points.toLocaleString()} 积分已到账</span>
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
              <button
                type="button"
                className={`${styles.planBuy} ${styles.planBuyPrimary}`}
                onClick={handleRetry}
              >
                重新支付
              </button>
            </div>
          )}
        </div>
      </Modal>
    </Modal>
  );
}
