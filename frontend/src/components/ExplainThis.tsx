import { useState } from 'react';
import { Sparkles, Loader, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';

export interface ExplainPayload {
  metric: string;
  label: string;
  value?: number | string | null;
  interpretation?: string;
  domain?: string;
  facts?: Record<string, unknown>;
}

interface ExplainResponse {
  explanation: string;
  status: string;
  metric?: string;
}

/**
 * "Explain this" — a small button that asks the backend LLM layer to explain ONE
 * already-computed metric in plain English. The numbers come from the deterministic
 * pipeline; the LLM only narrates them. The explanation is a bonus layer: if the key is
 * missing or rate-limited, we show the backend's graceful message, never a crash.
 */
export default function ExplainThis({ payload }: { payload: ExplainPayload }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExplainResponse | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const res = await api.post<ExplainResponse>('/narrative/explain-metric', payload);
      setResult(res.data);
    } catch {
      setResult({
        explanation: 'Could not reach the explanation service. Please check the backend is running.',
        status: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const isWarn = result && result.status !== 'ok';

  return (
    <div style={{ marginTop: 12 }}>
      {!result && (
        <button
          className="btn btn-ghost"
          onClick={run}
          disabled={loading}
          aria-label={`Explain ${payload.label} in plain English`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '4px 10px' }}
        >
          {loading ? (
            <Loader size={14} style={{ animation: 'spin 1.2s linear infinite' }} />
          ) : (
            <Sparkles size={14} />
          )}
          {loading ? 'Explaining…' : 'Explain this'}
        </button>
      )}

      {result && (
        <div
          role="note"
          style={{
            marginTop: 4,
            padding: 12,
            borderRadius: 8,
            fontSize: '0.85rem',
            lineHeight: 1.5,
            background: isWarn ? 'rgba(242, 169, 59, 0.08)' : 'rgba(52, 214, 196, 0.06)',
            border: `1px solid ${isWarn ? 'rgba(242, 169, 59, 0.3)' : 'rgba(52, 214, 196, 0.2)'}`,
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: isWarn ? 'var(--yellow)' : 'var(--accent)' }}>
            {isWarn ? <AlertTriangle size={14} /> : <Sparkles size={14} />}
            <strong style={{ fontSize: '0.75rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {isWarn ? 'Explanation unavailable' : 'Plain-English explanation'}
            </strong>
          </div>
          <p style={{ margin: 0 }}>{result.explanation}</p>
          {!isWarn && (
            <p className="helper" style={{ margin: '8px 0 0', fontSize: '0.72rem', opacity: 0.7 }}>
              AI-generated from the computed numbers above. The metric itself is calculated, not guessed.
            </p>
          )}
          <button
            className="btn btn-ghost"
            onClick={isWarn ? run : () => setResult(null)}
            disabled={loading}
            style={{ marginTop: 8, fontSize: '0.75rem', padding: '2px 8px' }}
          >
            {isWarn ? (loading ? 'Retrying…' : 'Retry') : 'Hide'}
          </button>
        </div>
      )}
    </div>
  );
}
