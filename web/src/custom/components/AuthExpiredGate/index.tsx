import LoginModal from '@/custom/components/LoginModal';
import { useAuthPromptStore } from '@/shared/stores/authPrompt';

export default function AuthExpiredGate() {
  const open = useAuthPromptStore((s) => s.open);
  const notice = useAuthPromptStore((s) => s.notice);
  if (!open) return null;
  return (
    <LoginModal
      notice={notice ?? undefined}
      onSuccess={() => useAuthPromptStore.getState().succeed()}
      onClose={() => useAuthPromptStore.getState().dismiss()}
    />
  );
}
