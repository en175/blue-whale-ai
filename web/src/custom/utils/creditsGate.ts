import { isApiError } from '@/shared/api/http';
import { useAuthStore } from '@/shared/stores/auth';
import { useRechargeUiStore } from '@/custom/stores/recharge';

export function isCreditsInsufficient(credits: number | null | undefined): boolean {
  return typeof credits === 'number' && credits <= 0;
}

export function blockIfCreditsInsufficient(
  credits: number | null | undefined = useAuthStore.getState().credits,
): boolean {
  if (!isCreditsInsufficient(credits)) return false;
  useRechargeUiStore.getState().openRecharge();
  return true;
}

const PLATFORM_QUOTA_EXHAUSTED_CODE = 'platform_quota_exhausted';
const PLATFORM_QUOTA_EXHAUSTED_NUMERIC = 1061;

export function isCreditsExhaustedError(e: unknown): boolean {
  if (!isApiError(e)) return false;
  const code = String(e.code);
  if (
    code === PLATFORM_QUOTA_EXHAUSTED_CODE ||
    Number(e.code) === PLATFORM_QUOTA_EXHAUSTED_NUMERIC
  ) {
    return false;
  }
  return e.status === 402 || code === 'payment_required' || code === 'quota_exhausted';
}

export function openRechargeForCreditsError(e: unknown): boolean {
  if (!isCreditsExhaustedError(e)) return false;
  useRechargeUiStore.getState().openRecharge();
  return true;
}
