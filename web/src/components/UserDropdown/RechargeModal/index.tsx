/* ============================================
 * RechargeModal 积分充值弹窗：档位选择 / 自定义充值 / 扫码支付 / 轮询到账 / 充值协议
 * 拉起档位 → 创建订单 → 渲染真实收银台二维码 → 轮询支付结果
 *
 * ⚠️ 只有一个支付渠道（杭州银行聚合主扫）：二维码指向银行统一收银台，
 *    微信/支付宝/云闪付由**用户在银行页面上自选**，我们这边没有渠道可切。
 *
 * ⚠️ 两种购买方式（固定积分卡 / 自定义充值）**共用同一条支付链路**：
 *    下单 → 出码 → 轮询 → 到账。切换只换「买什么」，不换「怎么付」——
 *    所以它们不各写一套二维码与轮询。
 * ============================================ */
import { useEffect, useState } from 'react';
import { Check, CreditCard, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import Modal from '@/components/Modal';
import CustomRecharge from '@/components/CustomRecharge';
import styles from './index.module.css';
import { fetchCredits } from '@/api/auth';
import {
  createCustomRechargeOrder,
  createRechargeOrder,
  fetchRechargeCustomConfig,
  fetchRechargeOrderStatus,
  fetchRechargeTierCatalog,
  type RechargeCustomConfig,
  type RechargeOrder,
  type RechargeTierCatalog,
} from '@/api/recharge';
import { useAuthStore } from '@/stores/auth';

interface RechargeModalProps {
  onClose: () => void;
}

/**
 * 套餐权益。
 *
 * ⚠️ 这里**刻意不写有效期**：充值本金的策略是 billing 的 `GrantPolicy` 按来源
 *    （`purchased`）给的 **2 年**（自支付成功起算），与「是不是买了加赠档」无关，
 *    也没有按档位不同的差别 —— 它是整页一条口径，写在卡片上会变成重复三遍的同一条。
 *    原先那句「积分永久有效」是旧策略留下的假话，已删。
 */
const PERKS = ['积分即时到账', '支持全部模型调用'];

/**
 * 充值到账积分的有效期（＝ billing `GrantPolicy` 对 `source = purchased` 的策略）。
 *
 * <p>写死在文案里是**有意的**：这条策略不由本仓决定，用户也不该看到「2 年」随某个
 * 接口抖动。它变了（PRD §9.5 改口径）就得连着这句文案一起改 —— 这与「档位到账积分」
 * 那种**后台可配**的值不同，那个必须从接口读。
 */
const CREDITS_VALIDITY_TEXT = '积分自到账起 2 年内有效';

/** 支付流程状态：idle 未下单 / creating 下单中 / waiting 待支付 / paid / expired / failed */
type Phase = 'idle' | 'creating' | 'waiting' | 'paid' | 'expired' | 'failed';

/**
 * 购买方式：`tier` 固定积分卡（默认，保持原有形态）/ `custom` 自定义充值（PRD §7.2）。
 *
 * <p>默认落在固定积分卡：它是有明确档位的推荐路径，自定义是「量不够用」时的补充。
 */
type Mode = 'tier' | 'custom';

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
  /** 当前购买方式（固定积分卡 / 自定义充值） */
  const [mode, setMode] = useState<Mode>('tier');
  /**
   * 自定义充值的后台配置；`null` = 还没拿到（或拉失败）。
   *
   * <p>⚠️ 本弹窗只拿它判**入口是否存在**（`enabled`），并把同一份**注入**给面板 ——
   * 面板不再自己拉一次，否则「入口按 A 显示、面板按 B 渲染」迟早出现。
   */
  const [customConfig, setCustomConfig] = useState<RechargeCustomConfig | null>(null);
  /** 自定义充值下单中：防重复提交（PRD §7.5），由面板的按钮呈现 */
  const [customSubmitting, setCustomSubmitting] = useState(false);
  /** 自定义充值下单失败：展示在面板里（与 orderError 一样，就地、不弹 toast） */
  const [customError, setCustomError] = useState('');
  /**
   * 后端已确认「钱到了、积分还在发」（`paid_pending` / `grant_failed`）。
   *
   * <p>与「等待支付结果…」分开：那时用户**可能还没付钱**，这时他已经付了。
   * 两种情况都继续轮询（不是终态），但说的话不一样。
   */
  const [creditsPending, setCreditsPending] = useState(false);

  /** 可用余额（billing 账本的整数积分）；未拉取到为 null，显示 -- */
  const credits = useAuthStore((s) => s.credits);

  const tiers = catalog?.tiers ?? [];
  const selected = tiers.find((t) => t.id === selectedId) ?? null;
  const paying = phase === 'creating' || phase === 'waiting';
  /**
   * 选中的这一档没有购买权限（后台把它限到了白名单，而当前用户不在名单里）。
   *
   * ⚠️ 判定与后端**同一个来源**（`can_purchase`，服务端用 `canPurchaseTier` 算的）：
   *    前端自己拿白名单再算一遍，就会出现「界面可点、下单被拒」或反过来。
   *    `null`（游客）**不算无权限** —— 那是「未判定」，价格表本来就该看得见。
   */
  const selectedDenied = selected?.can_purchase === false;
  /** 仅 order 成功后出右侧支付码；下单中不出「正在创建订单…」 */
  const showQrPanel =
    phase === 'waiting' || phase === 'paid' || phase === 'expired' || phase === 'failed';
  /**
   * 一次性订单是否还允许切换购买方式。
   *
   * <p>`waiting` 期间**锁住**：两个方式各自下单会同时存在两张待付订单，用户付哪张都
   * 只算一张，「我付了怎么没到账」十有八九是这么来的。与档位卡片在支付中被锁住同一条规矩。
   */
  const locked = paying;
  /** 后台开了自定义充值才给这个入口（拉不到配置一律当没开） */
  const customAvailable = customConfig?.enabled === true;
  /** 当前展示的是自定义充值面板（配置在手才是真能买的状态） */
  const showCustomPanel = mode === 'custom' && customConfig !== null;

  // 打开弹窗拉取档位目录（按 sort_order 升序；服务端顺序不做承诺，客户端定一次）
  // ⚠️ 回包里那条 `credits_per_yuan`（定价目录的**消费锚点**）保留在 state 里但**不展示**：
  //    档位到账积分是后台配的，与它不成比例（见下方 unitHint 处的说明）。删掉它就得改
  //    这个接口的返回形状，而它是有用的契约信息，留着但不渲染是代价最小的做法。
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

  // 自定义充值配置：只用来判「有没有这个入口」，以及把同一份配置注入给面板。
  // ⚠️ 拉不到 / 后台关掉（enabled=false）就不出现入口 —— 一个点开是空白的页签
  //    比没有页签更糟。这与面板「拉不到配置就整块不渲染」是同一条处置。
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

  // 待支付态轮询订单状态（立即一次 + 每 3s），直到落成 paid / expired / failed
  // ⚠️ `paid_pending`（钱到了、积分还没发）**不是终态**：后端会重试发放，界面继续等，
  //    提前报成功等于骗用户。但它的**话**与「还没付钱」必须不一样 ——
  //    钱已经收了，用户此刻该看到的不是「等待支付结果…」（他付过了），而是「发放中」。
  //    服务端超窗之后仍会如实回这个状态（超窗只是不再重试，不是「没收到钱」）。
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
          } else if (st.status === 'paid_pending' || st.status === 'grant_failed') {
            setCreditsPending(true);
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
    // 无权限的档位不该下单：按钮那个 `disabled` 只是界面，这里才是真正的闸
    // （服务端也会再判一次 —— 两层都要有，前端的错在于「点了没反应」而不是安全）
    if (!selected || paying || phase === 'paid' || selectedDenied) return;
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

  /**
   * 自定义充值点「购买」：面板只交出**修正过的积分数**（价格由服务端重新算）。
   *
   * <p>⚠️ 这里只传 `credits`，不传价格 —— 前端那个价是展示值（PRD §7.5）。
   *    下单成功后与档位单走完全相同的二维码面板与轮询。
   */
  const handleCustomConfirm = (customCredits: number) => {
    if (paying) return;
    setCustomError('');
    setOrderError('');
    setCustomSubmitting(true);
    setPhase('creating');
    createCustomRechargeOrder(customCredits)
      .then((o) => {
        setOrder(o);
        setPhase('waiting');
      })
      .catch((e) => {
        // 服务端对不在格点上的值会拒绝（它不替用户改数），文案原样展示
        setCustomError(e instanceof Error ? e.message : '创建订单失败');
        setPhase('idle');
      })
      .finally(() => setCustomSubmitting(false));
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
        {/* 左侧主区域 */}
        <div className={styles.main}>
          <h2 className={styles.title}>积分充值</h2>
          <p className={styles.subtitle}>
            {customAvailable ? '请选择充值方式' : '请选择充值套餐'}
          </p>

          {/* 购买方式切换：固定积分卡（默认）/ 自定义充值。
              ⚠️ 两者**共用**右侧二维码与轮询那一条链路，切换只决定「买什么」，
                 所以这里没有第二套支付 UI。支付进行中锁住，避免同时开出两张待付订单。
              ⚠️ 后台关掉自定义充值时整个切换器都不渲染：只剩一种方式，「选方式」是废话。 */}
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
              {/*
                ⚠️ 这里**不再**写「1 元 = N 积分」。
                那条换算率是定价目录里的**消费锚点**（生成任务按它计价），而档位到账积分
                2026-09-27 起是后台按活动配的**配置值**（PRD §6.1 的 6 档都高于该比例，
                如 ¥499 到账 7,500 而 499 × 15 = 7,485）。摆在卡片上方只会让人拿它去核算，
                一遇到有折扣的档位就像「少给了」。现在统一说「以各档位标注为准」。
              */}
              <p className={styles.unitHint}>
                到账积分以各档位标注为准 · {CREDITS_VALIDITY_TEXT}
              </p>

              {/* 套餐卡片（真实档位） */}
              {tiersLoading ? (
                <div className={styles.emptyHint}>档位加载中…</div>
              ) : tiersError ? (
                <div className={styles.emptyHint}>{tiersError}</div>
              ) : (
                <div className={`${styles.planRow} ${showQrPanel ? styles.planRowPaying : ''}`}>
                  {tiers.map((t) => {
                    const discount = fmtDiscount(t.discount);
                    // 无权限的档位（后台把它限到了白名单，而当前用户不在名单里）：
                    // 置灰 + 不可选 + 展示后台配的提示（PRD §6.3），做法与自定义充值面板一致。
                    // `null`（游客未判定）**不算**无权限 —— 价格表本来就该看得见
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
                          // 无权限时不列权益：这张卡现在买不了，列一堆权益等于在推销一个买不到的东西
                          <span className={styles.planDeniedHint}>{t.denied_hint}</span>
                        ) : (
                          <div className={styles.perkList}>
                            {PERKS.map((perk) => (
                              <span key={perk} className={styles.perkItem}>
                                <Check size={14} strokeWidth={2.5} className={styles.perkCheck} />
                                {perk}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /*
              自定义充值面板（PRD §7.2「与固定积分卡并列展示」）。
              它自带「买多少 / 多少钱」与购买按钮，所以这一支下**不渲染底部结算栏** ——
              两处各写一次价格，用户会怀疑哪个是真的。

              ⚠️ 不传 onRequireLogin：本弹窗的入口（用户菜单、生成前余额拦截）都在登录态之后，
                 `can_purchase === null`（游客）走不到这里。将来若放开游客入口，必须在这里接上
                 登录弹窗，别让它变成一个点了没反应的「登录后购买」。
            */
            <CustomRecharge
              config={customConfig}
              onConfirm={handleCustomConfirm}
              submitting={customSubmitting}
              error={customError}
            />
          )}

          {/* 底部结算栏（仅固定积分卡）：自定义充值面板自带价格与购买按钮 */}
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
                {/* 确认支付（未选套餐 / 选中的档位无购买权限时禁用）。渠道没法选：银行收银台统一收单 */}
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
                <span className={styles.waiting}>
                  {creditsPending ? '已收到付款，积分发放中…' : '等待支付结果...'}
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
