import { toast } from 'sonner';

export type ToastKind = 'success' | 'error' | 'warn';

export function showToast(type: ToastKind, msg: string): void {
  if (type === 'success') toast.success(msg);
  else if (type === 'error') toast.error(msg);
  else toast.warning(msg);
}
