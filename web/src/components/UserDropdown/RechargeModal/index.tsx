/* ============================================
 * RechargeModal 积分充值弹窗：当前是「暂未开放」说明态
 *
 * ⚠️ new-api 已降级成上游供应商，充值面后端（协议 / 下单 / 查单 / 充值记录）整条删除，
 *    本仓没有支付通道（blue_whale_pay 是独立仓库）。入口保留而不是连按钮一起删掉：
 *    「删掉再恢复」是白工，而点进来必须看到一句明确的话——静默 404 会被用户当成自己点错了。
 *    支付通道接回来时，在这里恢复档位选择 / 扫码支付 / 轮询到账（见 git 历史里本文件的上一个版本）。
 * ============================================ */
import { Wallet } from 'lucide-react';
import Modal from '@/components/Modal';
import styles from './index.module.css';

interface RechargeModalProps {
  onClose: () => void;
}

export default function RechargeModal({ onClose }: RechargeModalProps) {
  return (
    <Modal
      open
      title="积分充值"
      footer={null}
      width={440}
      onCancel={onClose}
      ariaLabel="积分充值"
    >
      <div className={styles.notice}>
        <span className={styles.noticeIcon}>
          <Wallet size={28} strokeWidth={1.75} />
        </span>
        <p className={styles.noticeTitle}>充值功能暂未开放</p>
        <p className={styles.noticeDesc}>
          支付通道尚未接入，当前暂时无法充值。已有积分不受影响，生成功能可正常使用。
        </p>
      </div>
    </Modal>
  );
}
