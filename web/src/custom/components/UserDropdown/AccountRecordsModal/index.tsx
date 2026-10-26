import { useEffect, useState } from 'react';
import { Wallet, Wand2, ArrowDown, ArrowUp } from 'lucide-react';
import { fetchConsumptions, type ConsumptionRecord } from '@/custom/api/account';
import Empty from '@/custom/components/Empty';
import Modal from '@/custom/components/Modal';
import Tabs from '@/custom/components/Tabs';
import styles from './index.module.css';

interface AccountRecordsModalProps {
  open: boolean;
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

export default function AccountRecordsModal({ open, onClose }: AccountRecordsModalProps) {
  const [tab, setTab] = useState<'recharge' | 'consume'>('recharge');
  const [records, setRecords] = useState<ConsumptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const typeFilter = tab === 'recharge' ? 'recharge' : 'consume';

  useEffect(() => {
    if (!open) return undefined;
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
  }, [open, typeFilter]);

  return (
    <Modal
      open={open}
      title="账户记录"
      footer={null}
      onCancel={onClose}
      width="min(660px, 92vw)"
      classNames={{
        container: styles.modal,
        title: styles.title,
      }}
    >
      <Tabs
        className={styles.tabs}
        triggerClassName={styles.tab}
        activeTriggerClassName={styles.tabActive}
        value={tab}
        onChange={setTab}
        items={[
          {
            key: 'recharge',
            label: (
              <>
                <Wallet size={16} strokeWidth={2} />
                <span>充值记录</span>
              </>
            ),
          },
          {
            key: 'consume',
            label: (
              <>
                <Wand2 size={16} strokeWidth={2} />
                <span>消费记录</span>
              </>
            ),
          },
        ]}
      />
      <div className={styles.list}>
        {loading ? (
          <div className={styles.empty}>记录加载中…</div>
        ) : error ? (
          <div className={styles.empty}>{error}</div>
        ) : records.length === 0 ? (
          <Empty
            className={styles.empty}
            title={tab === 'recharge' ? '暂无充值记录' : '暂无消费记录'}
          />
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
    </Modal>
  );
}
