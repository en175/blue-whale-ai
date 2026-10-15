import LoginModal from '@/custom/components/LoginModal';
import { useAuthPromptStore } from '@/shared/stores/authPrompt';

export default function AuthExpiredGate() {
  const open = useAuthPromptStore((s) => s.open);
  if (!open) return null;
  return (
    <LoginModal
      onSuccess={() => useAuthPromptStore.getState().succeed()}
      onClose={() => useAuthPromptStore.getState().abandon()}
    />
  );
}
