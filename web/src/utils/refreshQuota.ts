/* ============================================
 * 充值到账后刷新 /api/usage/token，写入 auth store（IKBD2Q）
 * new-api 入账可能晚于订单 paid，需短重试，避免顶栏积分仍为 0。
 * ============================================ */
import { fetchQuota } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';

export interface RefreshQuotaAfterPaymentOptions {
  previousQuota?: number | null;
  attempts?: number;
  intervalMs?: number;
  refresh?: () => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
}

async function defaultRefresh(): Promise<number> {
  const data = await fetchQuota({ fresh: true });
  useAuthStore.getState().setQuota(data.quota);
  return data.quota;
}

/** 拉取最新配额写入 store；失败返回 null，不改现有值。 */
export async function syncQuotaFromUsageToken(
  refresh: () => Promise<number> = defaultRefresh,
): Promise<number | null> {
  try {
    return await refresh();
  } catch {
    return null;
  }
}

/** 支付完成后刷新配额：若仍不高于支付前余额，则短重试以等待入账。 */
export async function refreshQuotaAfterPayment(
  options: RefreshQuotaAfterPaymentOptions = {},
): Promise<number | null> {
  const previous = options.previousQuota ?? 0;
  const attempts = options.attempts ?? 5;
  const intervalMs = options.intervalMs ?? 1000;
  const refresh = options.refresh ?? defaultRefresh;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let last: number | null = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await syncQuotaFromUsageToken(refresh);
    if (last != null && last > previous) return last;
    if (i < attempts - 1) await sleep(intervalMs);
  }
  return last;
}
