import { fetchCredits } from '@/custom/api/auth';
import { useAuthStore } from '@/shared/stores/auth';

export async function refreshCredits(): Promise<void> {
  try {
    const data = await fetchCredits({ fresh: true });
    useAuthStore.getState().setUsage(data);
  } catch {
  }
}
