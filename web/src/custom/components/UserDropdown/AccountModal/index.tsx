import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './index.module.css';
import PasswordModal from '../PasswordModal';
import AccountRecordsModal from '../AccountRecordsModal';
import BindPhoneModal from '../BindPhoneModal';
import { updateUser } from '@/shared/utils/auth';

interface AccountModalProps {
  userId: number;
  nickname: string;
  phone: string;
  hasPassword: boolean;
  balance: number | null;
  onClose: () => void;
}

export default function AccountModal({
  userId,
  nickname,
  phone,
  hasPassword,
  balance,
  onClose,
}: AccountModalProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [showBindPhone, setShowBindPhone] = useState(false);

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} title="关闭">
          <X size={16} strokeWidth={2} />
        </button>
        <h2 className={styles.title}>账号信息</h2>

        {}
        <div className={styles.row}>
          <span className={styles.label}>用户ID</span>
          <span className={styles.value}>{userId}</span>
        </div>

        {}
        <div className={styles.row}>
          <span className={styles.label}>昵称</span>
          <span className={styles.value}>{nickname}</span>
        </div>

        {}
        <div className={styles.row}>
          <span className={styles.label}>手机号</span>
          <div className={styles.rowRight}>
            {phone ? (
              <span className={styles.value}>{phone}</span>
            ) : (
              <>
                <span className={styles.value}>未绑定</span>
                <button className={styles.link} onClick={() => setShowBindPhone(true)}>
                  绑定
                </button>
              </>
            )}
          </div>
        </div>

        {}
        <div className={styles.row}>
          <span className={styles.label}>密码</span>
          <div className={styles.rowRight}>
            <span className={styles.value}>{hasPassword ? '已设置' : '未设置'}</span>
            <button className={styles.link} onClick={() => setShowPassword(true)}>
              {hasPassword ? '修改' : '设置'}
            </button>
          </div>
        </div>

        {}
        <div className={`${styles.row} ${styles.rowLast}`}>
          <span className={styles.label}>积分余额</span>
          <div className={styles.rowRight}>
            <span className={styles.balance}>
              {balance === null ? '--' : balance.toLocaleString()}
            </span>
            <button className={styles.link} onClick={() => setShowRecords(true)}>
              账户记录
            </button>
          </div>
        </div>
      </div>

      {}
      <PasswordModal
        open={showPassword}
        hasPassword={hasPassword}
        onClose={() => setShowPassword(false)}
        onSuccess={() => {
          setShowPassword(false);
          onClose();
        }}
      />
      {}
      {showBindPhone && (
        <BindPhoneModal
          onClose={() => setShowBindPhone(false)}
          onBound={(bound) => updateUser({ phone: bound })}
        />
      )}
      {}
      {showRecords && <AccountRecordsModal onClose={() => setShowRecords(false)} />}
    </div>,
    document.body
  );
}
