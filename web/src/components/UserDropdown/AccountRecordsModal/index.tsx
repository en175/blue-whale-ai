/* ============================================
 * AccountRecordsModal 账户记录弹窗：充值记录/消费记录（真实后端数据）
 * ============================================ */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Wallet, Wand2, ArrowDown, ArrowUp } from 'lucide-react';
import {
  fetchConsumptions,
  fetchTopups,
  type ConsumptionRecord,
  type TopUpRecord,
} from '@/api/account';
import styles from './index.module.css';

interface AccountRecordsModalProps {
  onClose: () => void;
}

/** 充值状态文案（后端状态映射） */
const TOPUP_STATUS_LABEL: Record<string, string> = {
  paid: '已到账',
  success: '已到账',
  pending: '待支付',
  expired: '已过期',
  failed: '失败',
};

/** 相对时间：秒时间戳 → "X分钟前/X小时前/X天前" */
function fmtRelativeTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const diffSec = Math.max(0, Date.now() / 1000 - seconds);
  const min = Math.floor(diffSec / 60);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}小时前`;
  const day = Math.floor(hour / 24);
  return `${day}天前`;
}

/** 积分格式化：保留 2 位小数去尾零 */
function fmtCredits(n: number): string {
  const fixed = Number.isFinite(n) ? n.toFixed(2) : '0';
  return fixed.replace(/\.?0+$/, '');
}

export default function AccountRecordsModal({ onClose }: AccountRecordsModalProps) {
  const [tab, setTab] = useState<'recharge' | 'consume'>('recharge');
  const [topups, setTopups] = useState<TopUpRecord[]>([]);
  const [consumptions, setConsumptions] = useState<ConsumptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 打开/切换 tab 拉取真实记录（各拉前 20 条）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const fail = (e: unknown) => {
      if (alive) setError(e instanceof Error ? e.message : '记录加载失败');
    };
    const done = () => {
      if (alive) setLoading(false);
    };
    if (tab === 'recharge') {
      fetchTopups()
        .then((d) => {
          if (alive) setTopups(d?.items ?? []);
        })
        .catch(fail)
        .finally(done);
    } else {
      fetchConsumptions()
        .then((d) => {
          if (alive) setConsumptions(d?.items ?? []);
        })
        .catch(fail)
        .finally(done);
    }
    return () => {
      alive = false;
    };
  }, [tab]);

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} title="关闭">
          <X size={16} strokeWidth={2} />
        </button>
        <h2 className={styles.title}>账户记录</h2>

        {/* 标签切换 */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'recharge' ? styles.tabActive : ''}`}
            onClick={() => setTab('recharge')}
          >
            <Wallet size={16} strokeWidth={2} />
            <span>充值记录</span>
          </button>
          <button
            className={`${styles.tab} ${tab === 'consume' ? styles.tabActive : ''}`}
            onClick={() => setTab('consume')}
          >
            <Wand2 size={16} strokeWidth={2} />
            <span>消费记录</span>
          </button>
        </div>

        {/* 记录列表（真实数据） */}
        <div className={styles.list}>
          {loading ? (
            <div className={styles.empty}>记录加载中…</div>
          ) : error ? (
            <div className={styles.empty}>{error}</div>
          ) : tab === 'recharge' ? (
            topups.length === 0 ? (
              <div className={styles.empty}>暂无充值记录</div>
            ) : (
              topups.map((r) => (
                <div className={styles.item} key={r.trade_no}>
                  <ArrowDown size={18} strokeWidth={2} className={styles.iconDown} />
                  <div className={styles.main}>
                    <div className={styles.itemTitle}>+{fmtCredits(r.credits)} 积分</div>
                    <div className={styles.sub}>
                      <span>
                        ¥{Number.isFinite(r.amount_cny) ? r.amount_cny.toFixed(2) : '0.00'}
                        {' · '}
                        {r.payment_method || '其他'}
                      </span>
                      <span className={styles.status}>
                        {TOPUP_STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </div>
                    <div className={styles.meta}>单号 {r.trade_no || '—'}</div>
                  </div>
                  <span className={styles.time}>{fmtRelativeTime(r.created_at)}</span>
                </div>
              ))
            )
          ) : consumptions.length === 0 ? (
            <div className={styles.empty}>暂无消费记录</div>
          ) : (
            consumptions.map((r) => {
              // IKGCWU：退款与消耗同列。后端给的一律是正的变动幅度，方向看 kind——
              // 照抄扣费的 `-` 会把退回来的积分显示成又扣了一笔。
              const isRefund = r.kind === 'refund';
              return (
                <div className={styles.item} key={r.id}>
                  {isRefund ? (
                    <ArrowDown size={18} strokeWidth={2} className={styles.iconDown} />
                  ) : (
                    <ArrowUp size={18} strokeWidth={2} className={styles.iconUp} />
                  )}
                  <div className={styles.main}>
                    <div className={styles.itemTitle}>
                      {isRefund ? '+' : '-'}
                      {fmtCredits(r.credits)} 积分
                    </div>
                    <div className={styles.sub}>
                      <span>
                        {r.summary || '内容生成'}
                        {r.model ? ` · ${r.model}` : ''}
                      </span>
                    </div>
                  </div>
                  <span className={styles.time}>{fmtRelativeTime(r.created_at)}</span>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.note}>记录按时间倒序排列</div>
      </div>
    </div>,
    document.body
  );
}
