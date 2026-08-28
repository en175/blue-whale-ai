/* ============================================
 * 生成前余额门：不足则拦截并打开「积分充值」弹框（IKBD2Q 方案 A）
 * ============================================ */
import { isApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth';
import { useRechargeUiStore } from '@/stores/recharge';

/** 已拉取且余额不足以启动生成；未拉取（null）不当拦截。 */
export function isQuotaInsufficient(quota: number | null | undefined): boolean {
  return typeof quota === 'number' && quota <= 0;
}

/** 余额不足则打开积分充值弹框并返回 true（调用方应中止生成）。 */
export function blockIfQuotaInsufficient(
  quota: number | null | undefined = useAuthStore.getState().quota,
): boolean {
  if (!isQuotaInsufficient(quota)) return false;
  useRechargeUiStore.getState().openRecharge();
  return true;
}

/** 后端余额耗尽：402 / payment_required / quota_exhausted */
export function isQuotaExhaustedError(e: unknown): boolean {
  if (!isApiError(e)) return false;
  const code = String(e.code);
  return e.status === 402 || code === 'payment_required' || code === 'quota_exhausted';
}

/** 捕获余额耗尽错误时打开充值弹框，返回是否已处理。 */
export function openRechargeForQuotaError(e: unknown): boolean {
  if (!isQuotaExhaustedError(e)) return false;
  useRechargeUiStore.getState().openRecharge();
  return true;
}
