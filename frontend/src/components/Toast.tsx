import { useState, useCallback } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';
export interface ToastState { message: string; type: ToastType; }

/**
 * Minimal toast for user feedback. Returns the current toast, a `showToast` to raise one
 * (auto-dismisses after 4s), and a `clear`. Render <Toast/> once in the page.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type });
    window.setTimeout(() => setToast((t) => (t && t.message === message ? null : t)), 4000);
  }, []);
  const clear = useCallback(() => setToast(null), []);
  return { toast, showToast, clear };
}

export default function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null;
  const color = toast.type === 'error' ? '#F0565B' : toast.type === 'success' ? 'var(--accent)' : 'var(--text-secondary)';
  const Icon = toast.type === 'error' ? AlertTriangle : toast.type === 'success' ? CheckCircle : Info;
  return (
    <div
      role="status"
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999, maxWidth: 400,
        display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px',
        borderRadius: 12, background: '#161922', border: `1px solid ${color}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      <Icon size={18} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
      <span style={{ fontSize: '0.9rem', color: '#fff', flex: 1, lineHeight: 1.45 }}>{toast.message}</span>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, display: 'flex' }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/** Pull a human-readable message out of an axios-style error. */
export function errMsg(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { response?: { data?: { detail?: string } }; message?: string };
  return e?.response?.data?.detail || e?.message || fallback;
}
