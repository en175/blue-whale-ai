/* ============================================
 * 铜钱图标：外圆 + 内方孔（中国古钱形）
 * lucide 只有 Coins（叠币）/ JapaneseYen（円），没有圆孔方钱，
 * 这里按同一套线稿规格自绘：24 视框 / stroke 走 currentColor / 线宽 2。
 * ============================================ */
interface CoinIconProps {
  size?: number;
}

export default function CoinIcon({ size = 14 }: CoinIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="0.5" />
    </svg>
  );
}
