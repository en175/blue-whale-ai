/* ============================================
 * RechargeModal 积分充值弹窗：档位选择/支付方式/扫码支付/充值协议
 * 对接真实后端：拉档位 → 创建订单 → 渲染真实支付码 → 轮询支付结果
 * ============================================ */
import { useEffect, useState } from 'react';
import {
  Check,
  CreditCard,
  Smartphone,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '@/components/Modal';
import styles from './index.module.css';
import { quotaToPoints } from '@/api/auth';
import {
  cancelRechargeOrder,
  createRechargeOrder,
  fetchRechargeAgreement,
  fetchRechargeOrderStatus,
  fetchRechargeTiers,
  type RechargeOrder,
  type RechargeTier,
} from '@/api/recharge';
import { useAuthStore } from '@/stores/auth';
import { refreshQuotaAfterPayment, syncQuotaFromUsageToken } from '@/utils/refreshQuota';

interface RechargeModalProps {
  onClose: () => void;
}

/** 套餐权益 */
const PERKS = ['积分即时到账', '积分永久有效', '支持全部模型调用'];

/** 支付流程状态：idle 未下单 / creating 下单中 / waiting 待支付 / paid / expired / failed */
type Phase = 'idle' | 'creating' | 'waiting' | 'paid' | 'expired' | 'failed';

/** 价格格式化 */
const fmtPrice = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** 折扣率 → 文案：0.01 → "现价 1%"；1/缺失 = 无折扣。
 *  用「现价 X%」替代「X 折」避免折数语义歧义（0.1折=1% 常被误读为 ×0.1，引发纠纷）。 */
function fmtDiscount(discount?: number | null) {
  if (!discount || discount >= 1) return '';
  const pct = Math.round(discount * 100);
  return `现价 ${pct}%`;
}

/** ISO 过期时间 → HH:mm 后过期 */
function fmtExpiry(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} 后过期`;
}

export default function RechargeModal({ onClose }: RechargeModalProps) {
  const [tiers, setTiers] = useState<RechargeTier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [tiersError, setTiersError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [phase, setPhase] = useState<Phase>('idle');
  const [order, setOrder] = useState<RechargeOrder | null>(null);
  const [orderError, setOrderError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  const [agreement, setAgreement] = useState<{ title: string; content: string } | null>(null);

  const quota = useAuthStore((s) => s.quota);

  const selected = tiers.find((t) => t.id === selectedId) ?? null;
  const paying = phase === 'creating' || phase === 'waiting';
  const showQrPanel = phase !== 'idle';

  // 打开弹窗拉取真实档位（按 sort_order 升序）
  useEffect(() => {
    let alive = true;
    fetchRechargeTiers()
      .then((list) => {
        if (alive) setTiers([...list].sort((a, b) => a.sort_order - b.sort_order));
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

  // 待支付态轮询订单状态（立即一次 + 每 3s）；paid 后强制刷新 /api/usage/token
  useEffect(() => {
    if (phase !== 'waiting' || !order) return;
    let alive = true;
    const tick = () => {
      fetchRechargeOrderStatus(order.trade_no)
        .then((st) => {
          if (!alive) return;
          if (st.status === 'paid') {
            setPhase('paid');
            void refreshQuotaAfterPayment({
              previousQuota: useAuthStore.getState().quota,
            });
          } else if (st.status === 'expired' || st.status === 'failed') {
            setPhase(st.status);
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

  /** 确认支付 / 重新支付：创建订单并展示真实二维码 */
  const handleConfirm = () => {
    if (!selected || paying || phase === 'paid') return;
    setOrderError('');
    setPhase('creating');
    createRechargeOrder(selected.id, payMethod)
      .then((o) => {
        setOrder(o);
        setPhase('waiting');
      })
      .catch((e) => {
        setOrderError(e instanceof Error ? e.message : '创建订单失败');
        setPhase('idle');
      });
  };

  /** 关闭：未支付订单调用取消（幂等 no-op）；支付中/已支付再拉一次余额，避免顶栏仍为 0 */
  const handleClose = () => {
    if (order && phase === 'waiting') {
      cancelRechargeOrder(order.trade_no).catch(() => undefined);
    }
    if (phase === 'paid' || phase === 'waiting') {
      void syncQuotaFromUsageToken();
    }
    onClose();
  };

  /** 取消当前订单并留在充值弹窗内，以便用户重新选择或再次支付。 */
  const handleCancelPayment = async () => {
    if (!order || phase !== 'waiting' || cancelling) return;
    setCancelling(true);
    setOrderError('');
    try {
      await cancelRechargeOrder(order.trade_no);
      setOrder(null);
      setPhase('idle');
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : '取消支付失败，请稍后重试');
    } finally {
      setCancelling(false);
    }
  };

  /** 打开协议弹窗：首次从后端拉取 */
  const handleOpenAgreement = () => {
    setShowAgreement(true);
    if (agreement) return;
    fetchRechargeAgreement()
      .then(setAgreement)
      .catch(() =>
        setAgreement({ title: '充值协议', content: '充值即视为同意本协议。' }),
      );
  };

  const confirmLabel = !selected
    ? '确认支付'
    : paying
      ? '支付中...'
      : phase === 'paid'
        ? '支付成功'
        : phase === 'expired' || phase === 'failed'
          ? '重新支付'
          : `确认支付 ¥${fmtPrice(selected.price)}`;

  return (
    <>
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
          {/* 左侧主区域 */}
          <div className={styles.main}>
            <h2 className={styles.title}>积分充值</h2>
            <p className={styles.subtitle}>请选择充值套餐</p>
            <p className={styles.unitHint}>1 元 = 10 积分 · 充值到账后长期有效</p>

            {/* 套餐卡片（真实档位） */}
            {tiersLoading ? (
              <div className={styles.emptyHint}>
                <span className={styles.emptyBold}>档位加载中…</span>
              </div>
            ) : tiersError ? (
              <div className={styles.emptyHint}>
                <span className={styles.emptyBold}>{tiersError}</span>
              </div>
            ) : (
              <div className={`${styles.planRow} ${showQrPanel ? styles.planRowPaying : ''}`}>
                {tiers.map((t) => {
                  const discount = fmtDiscount(t.discount);
                  return (
                    <button
                      key={t.id}
                      className={`${styles.planCard} ${t.is_recommended ? styles.planRecommended : ''} ${t.id === selectedId ? styles.planSelected : ''}`}
                      onClick={() => {
                        if (!paying) setSelectedId(t.id);
                      }}
                    >
                      {t.is_recommended && <span className={styles.recBadge}>推荐</span>}
                      {t.id === selectedId && (
                        <span className={styles.selectedBadge}>
                          <Check size={12} strokeWidth={3} />
                          已选
                        </span>
                      )}
                      <span className={styles.planTitle}>
                        {t.amount.toLocaleString()} 积分
                      </span>
                      <span className={styles.planPriceRow}>
                        <span className={styles.planPrice}>¥{fmtPrice(t.price)}</span>
                        {discount && <span className={styles.discountTag}>{discount}</span>}
                      </span>
                      {t.original_price != null && (
                        <span className={styles.planOriginal}>
                          原价 ¥{fmtPrice(t.original_price)}
                        </span>
                      )}
                      <div className={styles.perkList}>
                        {PERKS.map((perk) => (
                          <span key={perk} className={styles.perkItem}>
                            <Check size={14} strokeWidth={2.5} className={styles.perkCheck} />
                            {perk}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 底部结算栏 */}
            <div className={styles.bottomBar}>
              {!selected ? (
                <div className={styles.barLeft}>
                  <CreditCard size={18} strokeWidth={2} className={styles.emptyIcon} />
                  <span className={styles.emptyHintText}>请先选择上方套餐</span>
                </div>
              ) : (
                <>
                  <div className={styles.barLeft}>
                    <span className={styles.balance}>
                      {quota === null ? '--' : quotaToPoints(quota)}积分
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
                      <span className={styles.barDiscount}>
                        {fmtDiscount(selected.discount)}
                      </span>
                    )}
                    {orderError && <span className={styles.barError}>{orderError}</span>}
                  </div>
                </>
              )}
              <div className={styles.barRight}>
                {/* 支付方式切换 */}
                <div className={styles.paySegment}>
                  <button
                    className={`${styles.payOption} ${payMethod === 'wechat' ? styles.payOptionActive : ''}`}
                    onClick={() => setPayMethod('wechat')}
                    disabled={paying}
                  >
                    <Smartphone size={14} strokeWidth={2} />
                    <span>微信支付</span>
                  </button>
                  <button
                    className={`${styles.payOption} ${payMethod === 'alipay' ? styles.payOptionActive : ''}`}
                    onClick={() => setPayMethod('alipay')}
                    disabled={paying}
                  >
                    <Smartphone size={14} strokeWidth={2} />
                    <span>支付宝</span>
                  </button>
                </div>
                {/* 确认支付（未选套餐时禁用） */}
                <button
                  className={`${styles.confirmBtn} ${!selected || paying || phase === 'paid' ? styles.confirmBtnDisabled : ''}`}
                  onClick={handleConfirm}
                  disabled={!selected || paying || phase === 'paid'}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </div>

          {/* 右侧二维码面板（真实支付码 + 状态轮询） */}
          {showQrPanel && (
            <div className={styles.qrPanel}>
              {phase === 'creating' && (
                <>
                  <div className={styles.qrBox}>
                    <span className={styles.qrPlaceholder}>正在创建订单…</span>
                  </div>
                  <span className={styles.waiting}>请稍候</span>
                </>
              )}

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
                  <span className={styles.qrHint}>
                    {payMethod === 'wechat' ? '请用微信扫码支付' : '请用支付宝扫码支付'}
                  </span>
                  <span className={styles.qrAmount}>¥{fmtPrice(order.amount)}</span>
                  <span className={styles.qrPoints}>
                    获得 {order.points.toLocaleString()} 积分
                  </span>
                  <div className={styles.dots}>
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className={styles.waiting}>等待支付结果...</span>
                  <button
                    className={styles.cancelPaymentButton}
                    type="button"
                    onClick={handleCancelPayment}
                    disabled={cancelling}
                  >
                    {cancelling ? '取消中…' : '取消支付'}
                  </button>
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

        {/* 协议 */}
        <div className={styles.agreement}>
          <span>充值即视为同意</span>
          <a
            className={styles.agreementLink}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleOpenAgreement();
            }}
          >
            《充值协议》
          </a>
        </div>
      </Modal>

      <Modal
        open={showAgreement}
        title={agreement?.title ?? '充值协议'}
        footer={null}
        onCancel={() => setShowAgreement(false)}
        width="min(560px, calc(100vw - 48px))"
        zIndex={130}
        classNames={{ body: styles.agreementBody }}
      >
        <p className={styles.agreementText}>
          {agreement ? agreement.content : '协议加载中…'}
        </p>
      </Modal>
    </>
  );
}
