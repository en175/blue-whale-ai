/* ============================================
 * AccountRecordsModal 账户记录弹窗：充值记录/消费记录切换查看
 * ============================================ */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Wallet, Wand2, ArrowDown, ArrowUp } from 'lucide-react';
import styles from './index.module.css';

interface AccountRecordsModalProps {
  onClose: () => void;
}

/** 充值记录 */
const rechargeRecords = [
  { points: '+20 积分', amount: '¥0.08 扫码支付', time: '34分钟前' },
  { points: '+5 积分', amount: '¥0.01 扫码支付', time: '36分钟前' },
  { points: '+50 积分', amount: '¥10.00 扫码支付', time: '50分钟前' },
  { points: '+50 积分', amount: '¥10.00 扫码支付', time: '51分钟前' },
  { points: '+20 积分', amount: '¥0.08 扫码支付', time: '53分钟前' },
  { points: '+100 积分', amount: '¥20.00 扫码支付', time: '1小时前' },
];

/** 消费记录 */
const consumeRecords = [
  { points: '-57.5 积分', usage: '生成视频', time: '1小时前' },
  { points: '-0.01 积分', usage: '内容生成', time: '2小时前' },
  { points: '-0 积分', usage: '内容生成', time: '2小时前' },
  { points: '-0.09 积分', usage: '内容生成', time: '2小时前' },
  { points: '-0.01 积分', usage: '内容生成', time: '5小时前' },
];

export default function AccountRecordsModal({ onClose }: AccountRecordsModalProps) {
  const [tab, setTab] = useState<'recharge' | 'consume'>('recharge');

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

        {/* 记录列表 */}
        <div className={styles.list}>
          {tab === 'recharge'
            ? rechargeRecords.map((r, i) => (
                <div className={styles.item} key={i}>
                  <ArrowDown size={18} strokeWidth={2} className={styles.iconDown} />
                  <div className={styles.main}>
                    <div className={styles.itemTitle}>{r.points}</div>
                    <div className={styles.sub}>
                      <span>{r.amount}</span>
                      <span className={styles.status}>进行中</span>
                    </div>
                  </div>
                  <span className={styles.time}>{r.time}</span>
                </div>
              ))
            : consumeRecords.map((r, i) => (
                <div className={styles.item} key={i}>
                  <ArrowUp size={18} strokeWidth={2} className={styles.iconUp} />
                  <div className={styles.main}>
                    <div className={styles.itemTitle}>{r.points}</div>
                    <div className={styles.sub}>
                      <span>{r.usage}</span>
                    </div>
                  </div>
                  <span className={styles.time}>{r.time}</span>
                </div>
              ))}
        </div>

        <div className={styles.note}>记录按时间倒序排列</div>
      </div>
    </div>,
    document.body
  );
}
