/* ============================================
 * RechargeModal 积分充值弹窗：套餐选择/支付方式/扫码支付/充值协议
 * ============================================ */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, CreditCard, Smartphone } from 'lucide-react';
import styles from './index.module.css';

interface RechargeModalProps {
  onClose: () => void;
}

/** 套餐数据 */
interface Plan {
  id: string;
  points: number;
  price: number;
  discount?: string;
  original?: number;
  recommended?: boolean;
}

const plans: Plan[] = [
  { id: 'p50', points: 50, price: 10 },
  { id: 'p10', points: 10, price: 0.02, discount: '0.1折', original: 2, recommended: true },
  { id: 'p15', points: 15, price: 0.03, discount: '0.1折', original: 3, recommended: true },
  { id: 'p5', points: 5, price: 0.01, discount: '0.1折', original: 1 },
  { id: 'p20', points: 20, price: 0.08, discount: '0.2折', original: 4 },
];

/** 套餐权益 */
const PERKS = ['积分即时到账', '积分永久有效', '支持全部模型调用'];

/** 当前积分余额 */
const BALANCE = '5000000';

/** 价格格式化 */
const fmtPrice = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** 字符串哈希 */
function hashSeed(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** 伪二维码图案 */
function QrPattern({ seed }: { seed: string }) {
  const cells = useMemo(() => {
    const N = 25;
    let h = hashSeed(seed);
    const rand = () => {
      h = (h * 1664525 + 1013904223) >>> 0;
      return h / 4294967296;
    };
    const inFinder = (r: number, c: number) =>
      (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);
    const finderBlack = (r: number, c: number) => {
      const lr = r < 7 ? r : r - (N - 7);
      const lc = c < 7 ? c : c - (N - 7);
      const onRing = lr === 0 || lr === 6 || lc === 0 || lc === 6;
      const onCenter = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
      return onRing || onCenter;
    };
    const grid: boolean[] = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        grid.push(inFinder(r, c) ? finderBlack(r, c) : rand() < 0.45);
      }
    }
    return grid;
  }, [seed]);

  return (
    <div className={styles.qrGrid}>
      {cells.map((b, i) => (
        <span key={i} className={b ? styles.qrBlack : undefined} />
      ))}
    </div>
  );
}

export default function RechargeModal({ onClose }: RechargeModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [paying, setPaying] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [showAgreement, setShowAgreement] = useState(false);

  const selected = plans.find((p) => p.id === selectedId) ?? null;

  /** 确认支付：展示二维码等待支付 */
  const handleConfirm = () => {
    if (!selected || paying) return;
    const d = new Date(Date.now() + 15 * 60 * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    setExpiry(`${hh}:${mm} 后过期`);
    setPaying(true);
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={`${styles.modal} ${paying ? styles.modalPaying : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button className={styles.closeBtn} onClick={onClose} title="关闭">
          <X size={16} strokeWidth={2} />
        </button>

        <div className={styles.content}>
          {/* 左侧主区域 */}
          <div className={styles.main}>
            <h2 className={styles.title}>积分充值</h2>
            <p className={styles.subtitle}>请选择充值套餐</p>

            {/* 套餐卡片 */}
            <div className={styles.planRow}>
              {plans.map((p) => (
                <button
                  key={p.id}
                  className={`${styles.planCard} ${p.recommended ? styles.planRecommended : ''} ${p.id === selectedId ? styles.planSelected : ''}`}
                  onClick={() => {
                    if (!paying) setSelectedId(p.id);
                  }}
                >
                  {p.recommended && <span className={styles.recBadge}>推荐</span>}
                  <span className={styles.planPoints}>{p.points} 积分</span>
                  <span className={styles.planPriceRow}>
                    <span className={styles.planPrice}>¥{fmtPrice(p.price)}</span>
                    {p.discount && <span className={styles.discountTag}>{p.discount}</span>}
                  </span>
                  {p.original && (
                    <span className={styles.planOriginal}>原价 ¥{p.original}</span>
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
              ))}
            </div>

            {/* 底部结算栏 */}
            <div className={styles.bottomBar}>
              {!selected ? (
                <div className={styles.emptyHint}>
                  <CreditCard size={18} strokeWidth={2} className={styles.emptyIcon} />
                  <span className={styles.emptyBold}>请选择充值套餐</span>
                  <span>选择上方套餐后确认支付</span>
                </div>
              ) : (
                <>
                  <div className={styles.barLeft}>
                    <span className={styles.balance}>{BALANCE}积分</span>
                    <span className={styles.selectedInfo}>
                      {selected.points} 积分&nbsp;&nbsp;¥{fmtPrice(selected.price)}
                    </span>
                    {selected.original && (
                      <span className={styles.barOriginal}>¥{selected.original}</span>
                    )}
                    {selected.discount && (
                      <span className={styles.barDiscount}>{selected.discount}</span>
                    )}
                  </div>
                  <div className={styles.barRight}>
                    {/* 支付方式切换 */}
                    <div className={styles.paySegment}>
                      <button
                        className={`${styles.payOption} ${payMethod === 'wechat' ? styles.payOptionActive : ''}`}
                        onClick={() => setPayMethod('wechat')}
                      >
                        <Smartphone size={14} strokeWidth={2} />
                        <span>微信支付</span>
                      </button>
                      <button
                        className={`${styles.payOption} ${payMethod === 'alipay' ? styles.payOptionActive : ''}`}
                        onClick={() => setPayMethod('alipay')}
                      >
                        <Smartphone size={14} strokeWidth={2} />
                        <span>支付宝</span>
                      </button>
                    </div>
                    {/* 确认支付 */}
                    <button
                      className={`${styles.confirmBtn} ${paying ? styles.confirmBtnPaying : ''}`}
                      onClick={handleConfirm}
                      disabled={paying}
                    >
                      {paying ? '支付中...' : `确认支付 ¥${fmtPrice(selected.price)}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 右侧二维码面板 */}
          {paying && selected && (
            <div className={styles.qrPanel}>
              <div className={styles.qrBox}>
                <QrPattern seed={`${selected.id}-${payMethod}`} />
              </div>
              <span className={styles.qrExpiry}>{expiry}</span>
              <span className={styles.qrHint}>
                {payMethod === 'wechat' ? '请用微信扫码支付' : '请用支付宝扫码支付'}
              </span>
              <span className={styles.qrAmount}>¥{fmtPrice(selected.price)}</span>
              <span className={styles.qrPoints}>获得 {selected.points} 积分</span>
              <div className={styles.dots}>
                <span />
                <span />
                <span />
              </div>
              <span className={styles.waiting}>等待支付结果...</span>
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
              setShowAgreement(true);
            }}
          >
            《充值协议》
          </a>
        </div>
      </div>

      {/* 充值协议弹窗 */}
      {showAgreement && (
        <div
          className={styles.agreementOverlay}
          onClick={(e) => {
            e.stopPropagation();
            setShowAgreement(false);
          }}
        >
          <div className={styles.agreementModal} onClick={(e) => e.stopPropagation()}>
            <button className={styles.closeBtn} onClick={() => setShowAgreement(false)} title="关闭">
              <X size={16} strokeWidth={2} />
            </button>
            <h2 className={styles.agreementTitle}>充值协议</h2>
            <div className={styles.agreementBody}>
              <p>## 充值协议</p>
              <p>充值即视为同意本协议。</p>
              <p>
                - 充值金额不支持退款
                <br />
                - 暂不支持开具发票
                <br />
                - 如有疑问请联系客服
              </p>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
