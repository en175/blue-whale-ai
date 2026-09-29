/* ============================================
 * 首页顶栏「积分超市」入口：铜钱图标 + 文案
 * 点击拉起积分充值弹窗（RechargeModal 由同页顶栏的用户菜单挂载，
 * 两边共用 useRechargeUiStore 这一个开关，不各挂一份弹窗）
 * 仅在登录态显示
 * ============================================ */
import { useAuthStore } from '@/stores/auth';
import { useRechargeUiStore } from '@/stores/recharge';
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
