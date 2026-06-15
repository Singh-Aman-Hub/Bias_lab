import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { Loader, CheckCircle2 } from 'lucide-react';

// ── Hardcoded stage list (matches screenshot wording) ────────────────────────
const ANALYSIS_STAGES = [
  'Scanning dataset for representation gaps',
  'Detecting proxy feature correlations',
  'Training model and computing fairness metrics',
  'Calculating SHAP values for explanations',
  'Running counterfactual fairness tests',
  'Probing model under stress perturbations',
  'Generating fix recommendations',
  'Finalizing report and preparing dashboard...',
];

// ── Per-stage durations (ms) — total = 105 000 ms ───────────────────────────
const STAGE_DURATIONS_MS = [
  10_000,  // Scanning dataset
  10_000,  // Detecting proxy
  25_000,  // Training model — longest
  10_000,  // SHAP values
  10_000,  // Counterfactual
  10_000,  // Stress probing
  10_000,  // Fix recommendations
  20_000,  // Finalizing
];

const TOTAL_SCRIPTED_MS = STAGE_DURATIONS_MS.reduce((a, b) => a + b, 0);

function getStageIndex(elapsedMs: number): number {
  let cumulative = 0;
  for (let i = 0; i < STAGE_DURATIONS_MS.length; i++) {
    cumulative += STAGE_DURATIONS_MS[i];
    if (elapsedMs < cumulative) return i;
  }
  return STAGE_DURATIONS_MS.length - 1;
}

function isResultReady(pipelineResults: any): boolean {
  return (
    !!pipelineResults &&
    !!pipelineResults.audit_run_id &&
    !!pipelineResults.scores &&
    !!pipelineResults.data_audit &&
    !!pipelineResults.model_bias &&
    !!pipelineResults.counterfactual &&
    !!pipelineResults.stress
  );
}

// ── Overlay component (position: fixed, renders on top of Step 3) ────────────
export function AnalysisProgressOverlay() {
  const navigate = useNavigate();
  const { analyzeError, pipelineResults } = useAppContext();

  // Stable start — captured once on mount, never reset
  const startedAtRef = useRef<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = now - startedAtRef.current;
  const stageIndex = getStageIndex(elapsedMs);
  const progressPercent = Math.min((elapsedMs / TOTAL_SCRIPTED_MS) * 100, 100);
  const scriptedTimelineComplete = elapsedMs >= TOTAL_SCRIPTED_MS;
  const resultReady = isResultReady(pipelineResults);

  // Navigate only when BOTH the timer and the data are ready
  useEffect(() => {
    if (scriptedTimelineComplete && resultReady && !analyzeError) {
      navigate('/workflow/step-3', { replace: true });
    }
  }, [scriptedTimelineComplete, resultReady, analyzeError, navigate]);

  // Error state — show inline (overlay stays, shows error card)
  if (analyzeError) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(10,12,18,0.96)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ maxWidth: 480, width: '100%', padding: 36, background: 'var(--bg-secondary)', borderRadius: 16, border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: 'var(--red)', marginBottom: 12 }}>Analysis Failed</h2>
          <p className="helper" style={{ marginBottom: 24 }}>{analyzeError}</p>
          <button className="btn btn-primary" onClick={() => navigate('/workflow/step-2')}>
            Back to Configuration
          </button>
        </div>
      </div>
    );
  }

  // Pending — scripted time done but results not yet ready
  if (scriptedTimelineComplete && !resultReady) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(10,12,18,0.96)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ maxWidth: 420, width: '100%', padding: 40, background: 'var(--bg-secondary)', borderRadius: 16, border: '1px solid var(--border)', textAlign: 'center' }}>
          <Loader size={36} color="var(--accent)" style={{ animation: 'spin 1.2s linear infinite', marginBottom: 20 }} />
          <h2 style={{ margin: '0 0 10px', fontSize: '1.3rem', color: 'var(--text-primary)' }}>Loading results…</h2>
          <p className="helper" style={{ margin: 0 }}>The audit pipeline is almost done. Your dashboard will appear shortly.</p>
        </div>
      </div>
    );
  }

  // Main progress overlay — matches screenshot design
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(10,12,18,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        maxWidth: 520, width: '100%', margin: '0 16px',
        padding: '36px 40px',
        background: 'var(--bg-secondary)',
        borderRadius: 16,
        border: '1px solid var(--border)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <Loader size={30} color="var(--accent)" style={{ animation: 'spin 1.2s linear infinite' }} />
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Running Full Analysis
          </h2>
          <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            Computing all fairness stages. This can take up to a minute for larger files.
          </p>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <span>Status</span>
            <span>Running</span>
          </div>
          <div style={{ height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              background: 'linear-gradient(90deg, var(--accent), #818cf8)',
              width: `${progressPercent}%`,
              transition: 'width 0.9s ease-out',
              borderRadius: 2,
            }} />
          </div>
        </div>

        {/* Stage list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ANALYSIS_STAGES.map((stage, i) => {
            const active = i === stageIndex;
            const completed = i < stageIndex;
            return (
              <div
                key={stage}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  opacity: active ? 1 : completed ? 0.6 : 0.28,
                  transition: 'opacity 0.4s ease',
                }}
              >
                {active ? (
                  <Loader size={15} color="var(--accent)" style={{ animation: 'spin 1.2s linear infinite', flexShrink: 0 }} />
                ) : completed ? (
                  <CheckCircle2 size={15} color="var(--green, #34d399)" style={{ flexShrink: 0 }} />
                ) : (
                  <Loader size={15} color="var(--text-secondary)" style={{ flexShrink: 0, opacity: 0.4 }} />
                )}
                <span style={{
                  fontSize: '0.88rem',
                  color: active ? 'var(--accent)' : completed ? 'var(--text-secondary)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                  transition: 'color 0.3s ease',
                }}>
                  {stage}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Default export kept for any legacy route reference ───────────────────────
export default function AnalysisProgress() {
  return <AnalysisProgressOverlay />;
}
