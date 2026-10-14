import LoginModal from '@/components/LoginModal';
import { useAuthPromptStore } from '@/stores/authPrompt';

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
