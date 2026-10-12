import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export interface ToastState {
  type: 'success' | 'error' | 'warn';
  msg: string;
}

interface CanvasToastProps {
  toast: ToastState | null;
}

export default function CanvasToast({ toast }: CanvasToastProps) {
  if (!toast) return null;
  return (
    <>
      <div data-testid="canvas-toast" style={{
        position: 'fixed',
        top: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 20px',
        borderRadius: '8px',
        background: toast.type === 'success' ? '#1a3a1a' : toast.type === 'error' ? '#3a1a1a' : '#3a3a1a',
        color: '#fff',
        fontSize: '14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        border: `1px solid ${toast.type === 'success' ? '#2d7a2d' : toast.type === 'error' ? '#7a2d2d' : '#7a5a2d'}`,
        animation: 'toastIn 0.2s ease',
      }}>
        {toast.type === 'success' && <CheckCircle size={16} />}
        {toast.type === 'error' && <XCircle size={16} />}
        {toast.type === 'warn' && <AlertTriangle size={16} />}
        <span>{toast.msg}</span>
      </div>
      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      `}</style>
    </>
  );
}
