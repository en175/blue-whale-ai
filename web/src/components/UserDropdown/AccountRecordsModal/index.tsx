/* ============================================
 * AccountRecordsModal 账户记录弹窗：充值记录 / 消费记录
 *
 * ⚠️ new-api 已降级成上游供应商，充值面后端（含 GET /api/account/topups）整条删除，本仓没有
 *    支付通道。「充值记录」页签**保留入口但只说明未开放**：删掉再恢复是白工，而留一个点开
 *    只有静默 404 空列表的页签，用户会以为自己点错了。
 * ============================================ */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Wallet, Wand2, ArrowDown, ArrowUp } from 'lucide-react';
import { fetchConsumptions, type ConsumptionRecord } from '@/api/account';
import styles from './index.module.css';

interface AccountRecordsModalProps {
  onClose: () => void;
}

/** RFC3339 → "X分钟前/X小时前/X天前"；解析不出来时返回空串。 */
function fmtRelativeTime(value: string): string {
  const seconds = new Date(value).getTime() / 1000;
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
  const [consumptions, setConsumptions] = useState<ConsumptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 消费页签拉真实流水（前 20 条）
  useEffect(() => {
    if (tab !== 'consume') return;
    let alive = true;
    setLoading(true);
    setError('');
    // ⚠️ 写死 type=consume：标签叫「消费」，内容就该只有消费。后端默认（不传 type）= 全部流水，
    //    不加这个过滤会把充值 / 赠送 / 退款也混进来。type 是单值，不接受逗号拼接的并集。
    fetchConsumptions('', 20, 'consume')
      .then((d) => {
        if (alive) setConsumptions(d?.items ?? []);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : '记录加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
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
          {tab === 'recharge' ? (
            <div className={styles.placeholder}>
              <span className={styles.placeholderTitle}>充值功能暂未开放</span>
              <span className={styles.placeholderDesc}>
                支付通道尚未接入，暂时无法充值，因此也没有充值记录。
              </span>
            </div>
          ) : loading ? (
            <div className={styles.empty}>记录加载中…</div>
          ) : error ? (
            <div className={styles.empty}>{error}</div>
          ) : consumptions.length === 0 ? (
            <div className={styles.empty}>暂无消费记录</div>
          ) : (
            consumptions.map((r) => {
              // 进账（退款/赠送）与出账（消费）同列。后端给的一律是正的变动幅度，
              // 方向看 `direction`——照抄扣费的 `-` 会把退回来的积分显示成又扣了一笔。
              const isIn = r.direction === 'in';
              return (
                <div className={styles.item} key={r.id}>
                  {isIn ? (
                    <ArrowDown size={18} strokeWidth={2} className={styles.iconDown} />
                  ) : (
                    <ArrowUp size={18} strokeWidth={2} className={styles.iconUp} />
                  )}
                  <div className={styles.main}>
                    <div className={styles.itemTitle}>
                      {isIn ? '+' : '-'}
                      {fmtCredits(r.credits)} 积分
                    </div>
                    <div className={styles.sub}>
                      <span>
                        {r.title || '内容生成'}
                        {/* 未结算的行给的是预计消耗：不标出来，用户会把预扣当成实际扣费 */}
                        {r.status === 'pending' ? ' · 处理中' : ''}
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
