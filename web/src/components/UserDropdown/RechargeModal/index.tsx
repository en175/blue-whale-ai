/* ============================================
 * RechargeModal 积分充值弹窗：档位选择 / 扫码支付 / 轮询到账 / 充值协议
 * 拉起档位 → 创建订单 → 渲染真实收银台二维码 → 轮询支付结果
 *
 * ⚠️ 只有一个支付渠道（杭州银行聚合主扫）：二维码指向银行统一收银台，
 *    微信/支付宝/云闪付由**用户在银行页面上自选**，我们这边没有渠道可切。
 * ============================================ */
import { useEffect, useState } from 'react';
import { Check, CreditCard, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import Modal from '@/components/Modal';
import styles from './index.module.css';
import { fetchCredits } from '@/api/auth';
import {
  createRechargeOrder,
  fetchRechargeOrderStatus,
  fetchRechargeTierCatalog,
  type RechargeOrder,
  type RechargeTierCatalog,
} from '@/api/recharge';
import { useAuthStore } from '@/stores/auth';

interface RechargeModalProps {
  onClose: () => void;
}

/** 套餐权益 */
const PERKS = ['积分即时到账', '积分永久有效', '支持全部模型调用'];

/** 支付流程状态：idle 未下单 / creating 下单中 / waiting 待支付 / paid / expired / failed */
type Phase = 'idle' | 'creating' | 'waiting' | 'paid' | 'expired' | 'failed';

/** 静态站托管的充值协议，跨域打开以免被 SPA catch-all 打回首页。 */
const RECHARGE_AGREEMENT_HREF =
  'https://static-bluewhale.yunjizi.cn/agreement/recharge-agreement.html';

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

/**
 * 拉一次余额写回全局 store（顶栏与其它页面读的就是它）。
 *
 * ⚠️ 必须 `fresh`：`/api/usage/token` 是 GET，http 层对在途同路径请求去重，
 *    而支付成功那一刻很可能还有一次旧请求在途——把旧值拿回来，
 *    用户就会看到「+1000 积分已到账」而顶栏余额纹丝不动。
 *    余额只是展示值，拉取失败不覆盖支付结果提示，下次进页面会自行纠正。
 */
async function refreshCredits() {
  try {
    const d = await fetchCredits({ fresh: true });
    useAuthStore.getState().setCredits(d.credits);
  } catch {
    /* 保持原余额，不打断成功提示 */
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

  /** 可用余额（billing 账本的整数积分）；未拉取到为 null，显示 -- */
  const credits = useAuthStore((s) => s.credits);

  const tiers = catalog?.tiers ?? [];
  const selected = tiers.find((t) => t.id === selectedId) ?? null;
  const paying = phase === 'creating' || phase === 'waiting';
  /** 仅 order 成功后出右侧支付码；下单中不出「正在创建订单…」 */
  const showQrPanel =
    phase === 'waiting' || phase === 'paid' || phase === 'expired' || phase === 'failed';

  // 打开弹窗拉取档位目录（按 sort_order 升序；服务端顺序不做承诺，客户端定一次）
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

  // 待支付态轮询订单状态（立即一次 + 每 3s），直到落成 paid / expired / failed
  useEffect(() => {
    if (phase !== 'waiting' || !order) return;
    let alive = true;
    const tick = () => {
      fetchRechargeOrderStatus(order.trade_no)
        .then((st) => {
          if (!alive) return;
          if (st.status === 'paid') {
            setPhase('paid');
            toast.success('支付成功，积分已到账');
            void refreshCredits();
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

  /** 确认支付 / 重新支付：接口成功后再展开二维码；失败就地提示，不出码区 */
  const handleConfirm = () => {
    if (!selected || paying || phase === 'paid') return;
    setOrderError('');
    setPhase('creating');
    createRechargeOrder(selected.id)
      .then((o) => {
        setOrder(o);
        setPhase('waiting');
      })
      .catch((e) => {
        setOrderError(e instanceof Error ? e.message : '创建订单失败');
        setPhase('idle');
      });
  };

  /** 关闭弹窗。
   *  ⚠️ 不撤单：支付网关侧没有关单接口，本地订单自然过期（撤单只会是个骗人的空壳）。
   *  waiting 态下用户可能刚扫完码付掉，补拉一次余额，免得关掉弹窗后顶栏还是旧值。 */
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
        {/* 左侧主区域 */}
        <div className={styles.main}>
          <h2 className={styles.title}>积分充值</h2>
          <p className={styles.subtitle}>请选择充值套餐</p>
          {/* 换算率来自 billing 定价目录（运营可调），不能写死成常量 */}
          {catalog && (
            <p className={styles.unitHint}>
              1 元 = {catalog.credits_per_yuan} 积分 · 充值到账后长期有效
            </p>
          )}

          {/* 套餐卡片（真实档位） */}
          {tiersLoading ? (
            <div className={styles.emptyHint}>档位加载中…</div>
          ) : tiersError ? (
            <div className={styles.emptyHint}>{tiersError}</div>
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
              {/* 确认支付（未选套餐时禁用）。渠道没法选：银行收银台统一收单 */}
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

        {/* 右侧二维码面板：仅 order 成功后出现 */}
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
                {/* 银行统一收银台：渠道由用户在银行页面上选，我们这边提示到「都能扫」为止 */}
                <span className={styles.qrHint}>请用微信 / 支付宝 / 云闪付 扫码支付</span>
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
