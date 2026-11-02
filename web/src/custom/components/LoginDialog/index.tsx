import { useLocation, useNavigate } from 'react-router-dom';
import LoginModal from '@/custom/components/LoginModal';
import { useLoginDialogStore } from '@/shared/stores/loginDialog';

export default function LoginDialog() {
  const navigate = useNavigate();
  const location = useLocation();
  const open = useLoginDialogStore((s) => s.open);
  const returnTo = useLoginDialogStore((s) => s.returnTo);
  const notice = useLoginDialogStore((s) => s.notice);
  if (!open) return null;
  return (
    <LoginModal
      notice={notice ?? undefined}
      onSuccess={() => {
        if (returnTo) navigate(returnTo, { state: location.state });
      }}
      onClose={() => useLoginDialogStore.getState().closeLogin()}
    />
  );
}
