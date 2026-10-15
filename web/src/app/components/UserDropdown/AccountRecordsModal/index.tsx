import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Wallet, Wand2, ArrowDown, ArrowUp } from 'lucide-react';
import { fetchConsumptions, type ConsumptionRecord } from '@/app/api/account';
import styles from './index.module.css';

interface AccountRecordsModalProps {
  onClose: () => void;
}

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

function fmtCredits(n: number): string {
  const fixed = Number.isFinite(n) ? n.toFixed(2) : '0';
  return fixed.replace(/\.?0+$/, '');
}

export default function AccountRecordsModal({ onClose }: AccountRecordsModalProps) {
  const [tab, setTab] = useState<'recharge' | 'consume'>('recharge');
  const [records, setRecords] = useState<ConsumptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const typeFilter = tab === 'recharge' ? 'recharge' : 'consume';

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    fetchConsumptions(1, 20, typeFilter)
      .then((d) => {
        if (alive) setRecords(d?.items ?? []);
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
  }, [typeFilter]);

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} title="关闭">
          <X size={16} strokeWidth={2} />
        </button>
        <h2 className={styles.title}>账户记录</h2>

        {}
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

        {}
        <div className={styles.list}>
          {loading ? (
            <div className={styles.empty}>记录加载中…</div>
          ) : error ? (
            <div className={styles.empty}>{error}</div>
          ) : records.length === 0 ? (
            <div className={styles.empty}>
              {tab === 'recharge' ? '暂无充值记录' : '暂无消费记录'}
            </div>
          ) : (
            records.map((r) => {
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
                        {}
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
