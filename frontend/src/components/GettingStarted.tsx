import { useNavigate } from 'react-router-dom';
import { Check, ArrowRight } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

interface Step {
  title: string;
  detail: string;
  done: boolean;
  /** Where the primary action takes the user. Omit for steps driven from the top bar. */
  to?: string;
  cta: string;
  /** Shown instead of a navigation button (e.g. "use the menu in the top bar"). */
  hint?: string;
}

/**
 * Progress-aware onboarding for new users. Reads app state to figure out the
 * first incomplete step and surfaces it as the active call-to-action, so a
 * first-time visitor is always one click from the right next move.
 */
export default function GettingStarted() {
  const { projectId, file, sensitiveCols, targetCol, pipelineResults } = useAppContext();
  const navigate = useNavigate();

  const configured = sensitiveCols.length > 0 && !!targetCol;

  const steps: Step[] = [
    {
      title: 'Create a project',
      detail: 'A project holds one model and its audit history.',
      done: !!projectId,
      cta: 'New Project',
      hint: 'Open the project menu in the top bar, then “New Project”.',
    },
    {
      title: 'Add a dataset',
      detail: 'Upload a CSV, or load a built-in benchmark (UCI Adult, COMPAS) in one click.',
      done: !!file,
      to: '/workflow/step-1',
      cta: 'Upload data',
    },
    {
      title: 'Configure attributes',
      detail: 'Pick the sensitive columns to audit and the target the model predicts.',
      done: configured,
      to: '/workflow/step-2',
      cta: 'Configure',
    },
    {
      title: 'Run the analysis',
      detail: 'Eight fairness engines run in the background — usually under a minute.',
      done: !!pipelineResults,
      to: '/workflow/step-2',
      cta: 'Run analysis',
    },
    {
      title: 'Review your report',
      detail: 'Walk the findings step by step, then see the unified score on this dashboard.',
      done: !!pipelineResults,
      to: '/workflow/step-3',
      cta: 'View findings',
    },
  ];

  const activeIndex = steps.findIndex(s => !s.done);
  const completed = steps.filter(s => s.done).length;
  const allDone = activeIndex === -1;

  return (
    <div className="card" style={{ padding: 28, maxWidth: 720, margin: '0 auto', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div className="section-title" style={{ margin: 0 }}>Getting started</div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {completed}/{steps.length}
        </span>
      </div>
      <p className="helper" style={{ marginBottom: 20, fontSize: '0.9rem' }}>
        {allDone
          ? 'Setup complete — your first audit is ready to review.'
          : 'Five steps to your first fairness audit. We’ll keep your place as you go.'}
      </p>

      {/* progress rail */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
        {steps.map((s, i) => (
          <div
            key={s.title}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: s.done
                ? 'var(--risk-low)'
                : i === activeIndex
                  ? 'var(--accent)'
                  : 'rgba(255,255,255,0.08)',
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {steps.map((s, i) => {
          const isActive = i === activeIndex;
          return (
            <div
              key={s.title}
              style={{
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
                padding: '14px 12px',
                borderRadius: 12,
                border: isActive ? '0.5px solid rgba(52, 214, 196, 0.4)' : '0.5px solid transparent',
                background: isActive ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              <div
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: s.done ? 'var(--risk-low)' : isActive ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                  color: s.done || isActive ? '#04110F' : 'var(--text-muted)',
                  border: '0.5px solid var(--border)',
                }}
              >
                {s.done ? <Check size={14} /> : i + 1}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    color: s.done ? 'var(--text-secondary)' : 'var(--text-primary)',
                  }}
                >
                  {s.title}
                </div>
                <div className="helper" style={{ fontSize: '0.85rem', marginTop: 2 }}>{s.detail}</div>

                {isActive && (
                  <div style={{ marginTop: 12 }}>
                    {s.to ? (
                      <button className="btn btn-primary btn-small" onClick={() => navigate(s.to!)}>
                        {s.cta} <ArrowRight size={14} />
                      </button>
                    ) : (
                      <div className="helper" style={{ fontSize: '0.82rem', color: 'var(--accent)' }}>
                        {s.hint}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
