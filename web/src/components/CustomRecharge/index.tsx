/* ============================================
 * CustomRecharge 自定义充值面板（模块 B，PRD §7.2 / §7.3 / §7.5）
 *
 *   自己拉配置 → 用户选/输积分数 → 实时显示价格 → 点购买交给调用方去下单
 *
 * ⚠️ **这一块不负责支付**：下单、出二维码、轮询到账都在调用方（#45 把它嵌进
 *    积分卡页/充值弹窗后复用同一条支付链路）。这里只回答「买多少积分、多少钱」。
 *
 * ⚠️ **首购那两条刻意没做**（产品的决定，不是遗漏）：
 *    · PRD §7.2 的「购买后将失去首购加赠资格」确认弹窗；
 *    · PRD §7.4 的「支付成功后占用首购资格」。
 *    原因：首购功能本身还没定形（每档独立算一次还是每账号只一次，见 #40 停放中）。
 *    在首购状态怎么算都没定的情况下写这句提示，等于对用户承诺一个还没定的规则。
 *    等 #40 落地时再一起补 —— 那时要动的是这里与 `RechargeService` 的对应注释。
 * ============================================ */
import { useEffect, useState } from 'react';
import { fetchRechargeCustomConfig, type RechargeCustomConfig } from '@/api/recharge';
import {
  customPriceFen,
  formatCredits,
  formatPriceYuan,
  snapCredits,
  validateCredits,
} from '@/lib/customRecharge';
import styles from './index.module.css';

export interface CustomRechargeProps {
  /**
   * 点「购买」。参数是**修正后**的积分数（一定落在后台配的范围与步长格点上）。
   * 调用方拿它去 `createCustomRechargeOrder(credits)`。
   */
  onConfirm: (credits: number) => void;
  /**
   * 游客点「登录后购买」时调用（PRD §7.5「引导登录/注册，不创建订单」）。
   * 不传则按钮只做展示（嵌入方还没接登录弹窗时不会静默什么都不做——见 handleBuy）。
   */
  onRequireLogin?: () => void;
  /** 下单进行中：由调用方控制（防重复提交是它那一侧的事，PRD §7.5） */
  submitting?: boolean;
  /** 下单失败的就地错误（调用方给，展示在价格旁边） */
  error?: string;
}

export default function CustomRecharge({
  onConfirm,
  onRequireLogin,
  submitting = false,
  error = '',
}: CustomRechargeProps) {
  const [config, setConfig] = useState<RechargeCustomConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  /** 当前选中的积分数（滑杆与提交都看它） */
  const [credits, setCredits] = useState(0);
  /** 手输框里的草稿：允许用户输到一半（比如只敲了个「6」），失焦时才修正 */
  const [draft, setDraft] = useState<string | null>(null);
  /** 「已修正为 …」提示：改了什么要说出来，不做无声修正 */
  const [correction, setCorrection] = useState('');

  useEffect(() => {
    let alive = true;
    fetchRechargeCustomConfig()
      .then((data) => {
        if (!alive) return;
        setConfig(data);
        // PRD §7.6「默认值」：进入时默认展示后台配的默认积分（默认 600 = ¥40）
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
  }, []);

  if (loading) return <div className={styles.loading}>自定义充值加载中…</div>;
  // 拉不到配置就整块不显示：拿一份编的上下限去渲染，用户会按一个不存在的规则下单
  if (!config || loadError) return null;
  // 后台关了自定义充值（PRD §10.3「是否启用」）→ 用户侧不展示
  if (!config.enabled) return null;

  const tourist = config.can_purchase === null;
  const denied = config.can_purchase === false;
  const paying = submitting;
  const locked = paying || denied;

  // 草稿还在输入框里时，价格按草稿的**修正值**预览 —— 用户敲「500」看到的是「最低 600 的价」，
  // 而不是一个他其实买不到的价格
  const preview = draft === null ? credits : snapCredits(Number(draft), config);
  const previewFen = customPriceFen(preview, config.credits_per_yuan);

  /** 手输框失焦：修正 + 说明改成了什么（PRD §7.3「自动修正或禁止提交」）。 */
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = draft.trim() === '' ? null : Number(draft);
    const snapped = snapCredits(parsed, config);
    setCredits(snapped);
    setDraft(null);
    // 原样合法就不提示；被改过（含清空后回默认）才说一句
    const unchanged = parsed !== null && Number.isFinite(parsed) && parsed === snapped;
    setCorrection(unchanged ? '' : `已修正为 ${formatCredits(snapped)} 积分`);
  };

  const handleBuy = () => {
    // 提交前再修正一次：用户可能没失焦就直接点了按钮（jsdom 里点按钮不会触发 blur）。
    // 服务端对不在格点上的值一律**拒绝**（不替用户改数），所以这里必须保证发出去的
    // 是一个合法值，否则用户会看到一句他无法理解的后端报错
    const final = draft === null ? credits : snapCredits(Number(draft), config);
    setCorrection('');
    setDraft(null);
    setCredits(final);

    if (tourist) {
      // PRD §7.5「用户未登录点击购买 → 引导登录/注册，不创建订单」
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
        {/* PRD §7.2「最小值提示 / 最大值提示」 */}
        <span className={styles.rangeHint}>
          {formatCredits(config.min_credits)} – {formatCredits(config.max_credits)} 积分
        </span>
      </div>

      <div className={styles.controlRow}>
        {/* 滑杆与输入框是同一个值的两个入口，用同一个 min/max/step，不会互相打架 */}
        <input
          className={styles.slider}
          type="range"
          min={config.min_credits}
          max={config.max_credits}
          step={config.step_credits}
          value={credits}
          disabled={locked}
          aria-label="积分数量"
          onChange={(e) => {
            setCorrection('');
            setDraft(null);
            setCredits(Number(e.target.value));
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
        {/* PRD §7.2「价格 根据积分数量实时计算」+ §7.3「展示精度到分」 */}
        <span className={styles.price} aria-label="应付金额">
          ¥{formatPriceYuan(previewFen)}
          <span className={styles.priceUnit}>{formatCredits(preview)} 积分</span>
        </span>
        {/* PRD §7.2「购买按钮 展示实际支付金额」 */}
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
