/* ============================================
 * AccountModal 账号信息弹窗：ID/昵称/换绑手机/修改密码/充值与账户记录入口
 * ============================================ */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './index.module.css';
import PasswordModal from '../PasswordModal';
import AccountRecordsModal from '../AccountRecordsModal';
import RebindPhoneModal from '../RebindPhoneModal';

interface AccountModalProps {
  userId: number;
  nickname: string;
  phone: string;
  balance: number | null;
  onClose: () => void;
  onOpenRecharge: () => void;
}

export default function AccountModal({
  userId,
  nickname,
  phone,
  balance,
  onClose,
  onOpenRecharge,
}: AccountModalProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [showRebind, setShowRebind] = useState(false);

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} title="关闭">
          <X size={16} strokeWidth={2} />
        </button>
        <h2 className={styles.title}>账号信息</h2>

        {/* 用户ID */}
        <div className={styles.row}>
          <span className={styles.label}>用户ID</span>
          <span className={styles.value}>{userId}</span>
        </div>

        {/* 昵称 */}
        <div className={styles.row}>
          <span className={styles.label}>昵称</span>
          <span className={styles.value}>{nickname}</span>
        </div>

        {/* 手机号 */}
        <div className={styles.row}>
          <span className={styles.label}>手机号</span>
          <div className={styles.rowRight}>
            <span className={styles.value}>{phone || '—'}</span>
            <button className={styles.link} onClick={() => setShowRebind(true)}>
              换绑
            </button>
          </div>
        </div>

        {/* 密码 */}
        <div className={styles.row}>
          <span className={styles.label}>密码</span>
          <div className={styles.rowRight}>
            <span className={styles.value}>已设置</span>
            <button className={styles.link} onClick={() => setShowPassword(true)}>
              修改
            </button>
          </div>
        </div>

        {/* 积分余额 */}
        <div className={`${styles.row} ${styles.rowLast}`}>
          <span className={styles.label}>积分余额</span>
          <div className={styles.rowRight}>
            <span className={styles.balance}>
              {balance === null ? '--' : balance.toLocaleString()}
            </span>
            <button className={`${styles.link} ${styles.linkBlue}`} onClick={onOpenRecharge}>
              去充值
            </button>
            <button className={styles.link} onClick={() => setShowRecords(true)}>
              账户记录
            </button>
          </div>
        </div>
      </div>

      {/* 修改密码弹窗 */}
      {showPassword && <PasswordModal onClose={() => setShowPassword(false)} />}
      {/* 账户记录弹窗 */}
      {showRecords && <AccountRecordsModal onClose={() => setShowRecords(false)} />}
      {/* 换绑手机号弹窗 */}
      {showRebind && <RebindPhoneModal onClose={() => setShowRebind(false)} />}
    </div>,
    document.body
  );
}
