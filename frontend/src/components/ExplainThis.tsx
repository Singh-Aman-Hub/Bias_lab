import { useState } from 'react';
import { Sparkles, Loader, AlertTriangle, ChevronDown, ChevronUp, Users, Target, TrendingUp, ArrowRight } from 'lucide-react';
import { api } from '../api/client';
import { useAppContext } from '../context/AppContext';

export interface ExplainPayload {
  metric: string;
  label: string;
  value?: number | string | null;
  interpretation?: string;
  domain?: string;
  facts?: Record<string, unknown>;
}

// Structured explanation from the new batch prompt schema
export interface StructuredExplanation {
  plain_summary?: string;
  technical_meaning?: string;
  current_value_interpretation?: string;
  affected_groups?: string;
  risk_reason?: string;
  recommended_review?: string;
}

interface ExplainResponse {
  explanation: string | StructuredExplanation;
  status: string;
  metric?: string;
}

function isStructured(v: any): v is StructuredExplanation {
  return v != null && typeof v === 'object' && (
    'plain_summary' in v || 'technical_meaning' in v || 'current_value_interpretation' in v
  );
}

function StructuredPanel({ data, onClose }: { data: StructuredExplanation; onClose: () => void }) {
  const sections: { icon: React.ReactNode; label: string; key: keyof StructuredExplanation }[] = [
    { icon: <Target size={13} />, label: 'What it measures', key: 'technical_meaning' },
    { icon: <TrendingUp size={13} />, label: 'Current result', key: 'current_value_interpretation' },
    { icon: <Users size={13} />, label: 'Affected groups', key: 'affected_groups' },
    { icon: <AlertTriangle size={13} />, label: 'Why it matters', key: 'risk_reason' },
    { icon: <ArrowRight size={13} />, label: 'Next step', key: 'recommended_review' },
  ];

  return (
    <div
      role="note"
      style={{
        marginTop: 4,
        padding: 14,
        borderRadius: 10,
        fontSize: '0.83rem',
        lineHeight: 1.6,
        background: 'rgba(52, 214, 196, 0.05)',
        border: '1px solid rgba(52, 214, 196, 0.18)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, color: 'var(--accent)' }}>
        <Sparkles size={13} />
        <strong style={{ fontSize: '0.7rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Plain-English Explanation
        </strong>
      </div>

      {/* Plain summary callout */}
      {data.plain_summary && (
        <p style={{
          margin: '0 0 12px',
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgba(52,214,196,0.08)',
          border: '1px solid rgba(52,214,196,0.2)',
          fontWeight: 500,
          color: 'var(--text-primary)',
        }}>
          {data.plain_summary}
        </p>
      )}

      {/* Detail sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sections.map(({ icon, label, key }) => {
          const val = data[key];
          if (!val) return null;
          return (
            <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: 2 }}>{icon}</span>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6 }}>
                  {label}:
                </span>
                <span style={{ color: 'var(--text-primary)' }}>{val}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Disclaimer */}
      <p style={{ margin: '10px 0 0', fontSize: '0.7rem', opacity: 0.6, color: 'var(--text-secondary)' }}>
        AI-generated from the computed numbers above. The metric itself is calculated, not guessed. Not legal advice.
      </p>

      <button
        className="btn btn-ghost"
        onClick={onClose}
        style={{ marginTop: 8, fontSize: '0.72rem', padding: '2px 8px' }}
      >
        Hide
      </button>
    </div>
  );
}

/**
 * "Explain this" — shows a rich structured explanation panel on click.
 * Uses the pre-fetched cache from the batch call; falls back to a lazy per-metric call.
 * No new LLM call is made if the explanation is already cached.
 */
export default function ExplainThis({ payload }: { payload: ExplainPayload }) {
  const { getExplanation, cacheExplanation } = useAppContext();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<ExplainResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    // If already loaded, just toggle
    if (result) { setExpanded(v => !v); return; }

    // Cache hit (pre-fetched after analysis) → instant, no API call
    const cached = getExplanation(payload.metric);
    if (cached) {
      setResult({ explanation: cached, status: 'ok' });
      setExpanded(true);
      return;
    }

    // Cache miss → one lazy call
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<ExplainResponse>('/narrative/explain-metric', payload);
      setResult(res.data);
      if (res.data.status === 'ok') {
        cacheExplanation(payload.metric, res.data.explanation);
      }
      setExpanded(true);
    } catch {
      setError('Could not reach the explanation service. Please check the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const hasResult = result && result.status === 'ok';
  const isWarn = error || (result && result.status !== 'ok');

  const buttonLabel = loading
    ? 'Explaining…'
    : expanded && hasResult
      ? 'Hide explanation'
      : 'Explain this';

  return (
    <div style={{ marginTop: 10 }}>
      {/* Toggle button — always visible */}
      <button
        className="btn btn-ghost"
        onClick={run}
        disabled={loading}
        aria-label={`Explain ${payload.label} in plain English`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', padding: '4px 10px' }}
      >
        {loading ? (
          <Loader size={13} style={{ animation: 'spin 1.2s linear infinite' }} />
        ) : expanded && hasResult ? (
          <ChevronUp size={13} />
        ) : (
          <Sparkles size={13} />
        )}
        {buttonLabel}
      </button>

      {/* Error state */}
      {isWarn && (
        <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--amber, #d99a2b)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={13} />
          {error ?? (result as any)?.explanation ?? 'Explanation unavailable.'}
        </div>
      )}

      {/* Structured explanation panel */}
      {expanded && hasResult && (() => {
        const exp = (result as ExplainResponse).explanation;
        if (isStructured(exp)) {
          return <StructuredPanel data={exp} onClose={() => setExpanded(false)} />;
        }
        // Legacy plain-string fallback
        return (
          <div
            role="note"
            style={{
              marginTop: 4,
              padding: 12,
              borderRadius: 8,
              fontSize: '0.84rem',
              lineHeight: 1.55,
              background: 'rgba(52, 214, 196, 0.06)',
              border: '1px solid rgba(52, 214, 196, 0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: 'var(--accent)' }}>
              <Sparkles size={13} />
              <strong style={{ fontSize: '0.7rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Plain-English explanation
              </strong>
            </div>
            <p style={{ margin: 0 }}>{String(exp)}</p>
            <p className="helper" style={{ margin: '8px 0 0', fontSize: '0.7rem', opacity: 0.6 }}>
              AI-generated from the computed numbers above. The metric itself is calculated, not guessed.
            </p>
            <button
              className="btn btn-ghost"
              onClick={() => setExpanded(false)}
              style={{ marginTop: 6, fontSize: '0.72rem', padding: '2px 8px' }}
            >
              Hide
            </button>
          </div>
        );
      })()}
    </div>
  );
}
