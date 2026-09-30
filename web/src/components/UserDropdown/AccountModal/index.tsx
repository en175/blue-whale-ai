/* ============================================
 * AccountModal 账号信息弹窗：ID/昵称/修改密码/账户记录入口
 * 充值入口已统一收到首页顶栏「积分超市」，这里不再给第二入口
 * ============================================ */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import styles from './index.module.css';
import PasswordModal from '../PasswordModal';
import AccountRecordsModal from '../AccountRecordsModal';
import BindPhoneModal from '../BindPhoneModal';
import { updateUser } from '@/utils/auth';

interface AccountModalProps {
  userId: number;
  nickname: string;
  /** 未绑定时为空串 */
  phone: string;
  /** 手机号验证码建出来的账号没有口令——决定这一行说「设置」还是「修改」 */
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

        {/* 手机号（IKJA4R）：未绑定时可点绑定；已绑定只读——本单不做换绑 */}
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

        {/* 密码（IKJA4R）：**没有口令的账号说「设置」不说「修改」**——
            他们从来没有过原密码，而修改那条路要求提供原密码，等于永远设不上 */}
        <div className={styles.row}>
          <span className={styles.label}>密码</span>
          <div className={styles.rowRight}>
            <span className={styles.value}>{hasPassword ? '已设置' : '未设置'}</span>
            <button className={styles.link} onClick={() => setShowPassword(true)}>
              {hasPassword ? '修改' : '设置'}
            </button>
          </div>
        </div>

        {/* 积分余额（充值入口已统一收到首页顶栏「积分超市」） */}
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

      {/* 修改密码弹窗：成功后连同账号信息一起关掉 */}
      <PasswordModal
        open={showPassword}
        hasPassword={hasPassword}
        onClose={() => setShowPassword(false)}
        onSuccess={() => {
          setShowPassword(false);
          onClose();
        }}
      />
      {/* 绑定手机号（IKJA4R）：成功后回写本地用户信息，这一行立刻显示号码 */}
      {showBindPhone && (
        <BindPhoneModal
          onClose={() => setShowBindPhone(false)}
          onBound={(bound) => updateUser({ phone: bound })}
        />
      )}
      {/* 账户记录弹窗 */}
      {showRecords && <AccountRecordsModal onClose={() => setShowRecords(false)} />}
    </div>,
    document.body
  );
}
