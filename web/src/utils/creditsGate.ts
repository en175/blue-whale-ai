import { isApiError } from '@/api/http';
import { useAuthStore } from '@/stores/auth';
import { useRechargeUiStore } from '@/stores/recharge';

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

export function isCreditsExhaustedError(e: unknown): boolean {
  if (!isApiError(e)) return false;
  const code = String(e.code);
  return e.status === 402 || code === 'payment_required' || code === 'quota_exhausted';
}

export function openRechargeForCreditsError(e: unknown): boolean {
  if (!isCreditsExhaustedError(e)) return false;
  useRechargeUiStore.getState().openRecharge();
  return true;
}
