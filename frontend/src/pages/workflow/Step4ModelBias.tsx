import { useNavigate } from 'react-router-dom';
import FairnessTable from '../../components/FairnessTable';
import FairnessMetricsPanel from '../../components/FairnessMetricsPanel';
import HiddenBiasExplorer from '../../components/HiddenBiasExplorer';
import DisparityBar from '../../components/DisparityBar';
import { useAppContext } from '../../context/AppContext';
import { ArrowRight, ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function Step4ModelBias() {
  const { pipelineResults, biasResult, counterfactualResult, advanceStep } = useAppContext();
  const navigate = useNavigate();

  if (!pipelineResults || !biasResult) {
    return (
      <div>
        <div className="page-header">
          <div>
            <div className="kicker">Step 4 of 9</div>
            <h1 className="page-title">Model Bias</h1>
          </div>
        </div>
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <p className="helper" style={{ marginBottom: 24 }}>No analysis data yet. Please run the analysis first.</p>
          <button className="btn btn-primary" onClick={() => navigate('/workflow/step-2')}>
            Go to Configuration <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  const availableGroups = Object.keys(biasResult.group_performance || {});
  const displayGroupKey = availableGroups.length > 0 ? availableGroups[0] : null;
  // Prefer the backend's authoritative fairness_score; fall back to a local estimate.
  const fairnessScore = typeof biasResult.fairness_score === 'number'
    ? Math.round(biasResult.fairness_score)
    : Math.max(0, Math.round(100 - ((biasResult.metrics?.demographic_parity_difference || 0) * 100)));

  const overfit = biasResult.overfit;
  const showOverfit = overfit && overfit.gap != null && overfit.level !== 'unknown';
  const isOverfit = overfit?.level === 'mild' || overfit?.level === 'high';
  const overfitColor = overfit?.level === 'high' ? 'var(--red)' : overfit?.level === 'mild' ? 'var(--amber, #d99a2b)' : 'var(--accent)';
  const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="kicker">Step 4 of 9</div>
          <h1 className="page-title">Model Bias</h1>
          <p className="page-subtitle">We evaluated the model across different groups to check for disparate impact.</p>
        </div>
      </div>

      <div className="card section-gap">
        <div className="stat-label">Fairness Score</div>
        <div className={`stat-number text-8xl ${fairnessScore < 70 ? 'text-red' : 'text-accent'}`}>
          {fairnessScore}
        </div>
      </div>

      {showOverfit && (
        <div
          className="card section-gap"
          style={{
            borderLeft: `4px solid ${overfitColor}`,
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
          }}
        >
          {isOverfit
            ? <AlertTriangle size={20} color={overfitColor} style={{ flexShrink: 0, marginTop: 2 }} />
            : <CheckCircle2 size={20} color={overfitColor} style={{ flexShrink: 0, marginTop: 2 }} />}
          <div style={{ flex: 1 }}>
            <div className="section-title" style={{ marginBottom: 4, color: overfitColor }}>
              {overfit?.level === 'high'
                ? 'Significant overfitting detected'
                : overfit?.level === 'mild'
                  ? 'Mild overfitting detected'
                  : 'Model generalizes well'}
            </div>
            <p className="helper" style={{ margin: 0 }}>
              {overfit?.warning
                ?? `Train accuracy ${fmtPct(overfit?.train_accuracy ?? null)} vs test accuracy ${fmtPct(overfit?.test_accuracy ?? null)} (gap ${fmtPct(overfit?.gap ?? null)}). The model performs consistently on unseen data.`}
            </p>
            <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <span>Train: <strong style={{ color: 'var(--text-primary)' }}>{fmtPct(overfit?.train_accuracy ?? null)}</strong></span>
              <span>Test: <strong style={{ color: 'var(--text-primary)' }}>{fmtPct(overfit?.test_accuracy ?? null)}</strong></span>
              <span>Gap: <strong style={{ color: overfitColor }}>{fmtPct(overfit?.gap ?? null)}</strong></span>
            </div>
          </div>
        </div>
      )}

      <FairnessMetricsPanel
        biasResult={biasResult}
        counterfactualResult={counterfactualResult}
      />

      {biasResult.low_confidence_subgroups && biasResult.low_confidence_subgroups.length > 0 && (
        <div
          className="card"
          style={{ marginBottom: 16, borderLeft: '4px solid var(--amber, #d99a2b)', display: 'flex', gap: 14, alignItems: 'flex-start' }}
        >
          <AlertTriangle size={20} color="var(--amber, #d99a2b)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div className="section-title" style={{ marginBottom: 4, color: 'var(--amber, #d99a2b)' }}>
              Small subgroups — interpret with caution
            </div>
            <p className="helper" style={{ margin: 0 }}>
              {biasResult.low_confidence_subgroups.length} group(s) have fewer than{' '}
              {biasResult.min_subgroup_size ?? 30} samples, so their rates (and any gaps they drive) are
              statistically noisy. They are still included so bias against them is never hidden — but treat the numbers as indicative, not conclusive:
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {biasResult.low_confidence_subgroups.map((s) => (
                <span
                  key={`${s.attribute}-${s.group}`}
                  style={{ fontSize: '0.8rem', padding: '2px 10px', borderRadius: 12, border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  {s.attribute}: {s.group} (n={s.sample_size})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

       {displayGroupKey && (
         <div className="card" style={{ marginBottom: 16 }}>
           <div className="section-title">Group performance ({displayGroupKey})</div>
           <div style={{ margin: '18px 0 24px' }}>
             <DisparityBar
               label={`Approval rate · ${displayGroupKey}`}
               groups={Object.entries(biasResult.group_performance[displayGroupKey]).map(
                 ([name, m]) => ({ name, value: m.approval_rate })
               )}
             />
           </div>
           <FairnessTable data={biasResult.group_performance[displayGroupKey]} />
         </div>
       )}

       {biasResult?.hidden_bias && biasResult.hidden_bias.length > 0 && (
         <HiddenBiasExplorer subgroups={biasResult.hidden_bias} />
       )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <button className="btn" onClick={() => navigate('/workflow/step-3')}>
          <ArrowLeft size={16} /> Back
        </button>
        <button className="btn btn-primary" onClick={async () => {
          await advanceStep(5);
          navigate('/workflow/step-5');
        }}>
          Next: Explore Explanations <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
