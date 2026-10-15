import { useAuthStore } from '@/shared/stores/auth';
import { useRechargeUiStore } from '@/app/stores/recharge';
import CoinIcon from './CoinIcon';
import styles from './index.module.css';

export default function CreditsShopButton() {
  const user = useAuthStore((s) => s.user);
  const openRecharge = useRechargeUiStore((s) => s.openRecharge);

  if (!user) return null;

  return (
    <button type="button" className={styles.button} onClick={openRecharge}>
      <CoinIcon size={14} />
      <span>积分超市</span>
    </button>
  );
}
