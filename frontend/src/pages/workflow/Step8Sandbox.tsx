import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import SandboxComparison from '../../components/SandboxComparison';
import ExplainThis, { type ExplainPayload } from '../../components/ExplainThis';
import { useAppContext } from '../../context/AppContext';
import type { FixRecommendation } from '../../types';

export default function Step8Sandbox() {
  const { file, pipelineResults, recommendResult, runSandboxSimulation, sandboxResult, domain, advanceStep } = useAppContext();
  const sandboxExplain: ExplainPayload | null = sandboxResult
    ? {
        metric: 'sandbox_recommendation',
        label: 'Sandbox fix comparison',
        value: sandboxResult.recommendation,
        domain,
        facts: {
          recommendation: sandboxResult.recommendation,
          scenarios: (sandboxResult.scenarios || []).map((s) => ({
            name: s.name,
            fairness_score: s.fairness_score,
            accuracy: s.accuracy,
            risk_level: s.risk_level,
          })),
        },
      }
    : null;
  const [selected, setSelected] = useState<string[]>([]);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);
  // The selection that was last actually simulated, so we can tell the user when the
  // current selection is "dirty" (changed since the last run) instead of re-running per toggle.
  const [lastRun, setLastRun] = useState<string[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!recommendResult) return;
    setSelected((recommendResult as FixRecommendation[]).map((r: FixRecommendation) => r.fix_id));
  }, [recommendResult]);

  const handleSimulate = async (fixesToRun?: string[]) => {
    const fixes = fixesToRun || selected;
    setScenarioLoading(true);
    setSimulateError(null);
    try {
      await runSandboxSimulation(fixes);
      setLastRun(fixes);
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      const message = err.response?.data?.detail || err.message || 'Simulation failed';
      setSimulateError(message);
    } finally {
      setScenarioLoading(false);
    }
  };

  const selKey = JSON.stringify([...selected].sort());
  const runKey = lastRun ? JSON.stringify([...lastRun].sort()) : null;
  const dirty = selKey !== runKey;

  if (!file) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <h2 style={{ marginBottom: 16 }}>No dataset uploaded</h2>
        <p className="helper" style={{ marginBottom: 24 }}>Please go back and upload a dataset to begin.</p>
        <button className="btn btn-primary" onClick={() => navigate('/workflow/step-1')}>Go to Upload</button>
      </div>
    );
  }

  if (!pipelineResults || !recommendResult) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <h2>Generating fix recommendations...</h2>
        <p className="helper">Analyzing bias and stress test results to suggest actionable fixes.</p>
      </div>
    );
  }

  const getCategory = (fixType: string) => {
    const t = fixType.toLowerCase();
    if (t.includes('data') || t.includes('sample') || t.includes('feature') || t.includes('reweighing')) return 'Data Fixes';
    if (t.includes('threshold') || t.includes('policy') || t.includes('human')) return 'Policy Fixes';
    return 'Model Fixes';
  };

  const dataFixes = (recommendResult as Array<FixRecommendation & { fix_type: string }>).filter((r) => getCategory(r.fix_type) === 'Data Fixes');
  const modelFixes = (recommendResult as Array<FixRecommendation & { fix_type: string }>).filter((r) => getCategory(r.fix_type) === 'Model Fixes');
  const policyFixes = (recommendResult as Array<FixRecommendation & { fix_type: string }>).filter((r) => getCategory(r.fix_type) === 'Policy Fixes');

  const renderFixGroup = (title: string, fixes: Array<FixRecommendation & { fix_type: string; mitigation_options?: Array<{ option: string; rationale: string }>; estimated_impact?: string }>) => {
    if (!fixes || fixes.length === 0) return null;
    return (
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ borderBottom: '0.5px solid var(--border)', paddingBottom: 8, marginBottom: 16, color: 'var(--text-primary)' }}>{title}</h3>
        <div className="grid-2">
          {fixes.map(fix => {
            const isApplied = selected.includes(fix.fix_id);
            const rationale = fix.mitigation_options?.[0]?.rationale || 'Addresses identified bias patterns directly.';

            return (
              <div className="card" key={fix.fix_id} style={{ display: 'flex', flexDirection: 'column', height: '100%', border: isApplied ? '0.5px solid rgba(52, 214, 196,0.72)' : '0.5px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {fix.fix_type.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  {isApplied && <span className="pill green">Active</span>}
                </div>

                <div style={{ marginBottom: 12, fontSize: '0.95rem' }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>What to do:</strong>
                  <div style={{ color: 'var(--text-primary)', marginTop: 4 }}>{fix.description}</div>
                </div>

                <div style={{ marginBottom: 12, fontSize: '0.95rem' }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>Why it helps:</strong>
                  <div style={{ color: 'var(--text-primary)', marginTop: 4 }}>{rationale}</div>
                </div>

                <div style={{ marginBottom: 24, fontSize: '0.95rem', flexGrow: 1 }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>Expected impact:</strong>
                  <div style={{ color: 'var(--accent)', marginTop: 4, fontWeight: 500 }}>{fix.estimated_impact}</div>
                </div>

                <button
                  className={`btn ${isApplied ? 'btn-secondary' : 'btn-primary'}`}
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => {
                    // Only update the selection — the simulation runs when the user clicks
                    // "Run Simulation", not on every toggle.
                    setSelected(isApplied ? selected.filter(id => id !== fix.fix_id) : [...selected, fix.fix_id]);
                  }}
                  disabled={scenarioLoading}
                >
                  {isApplied ? 'Remove from Selection' : 'Add to Selection'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="kicker">Step 8 of 9</div>
          <h1 className="page-title">Sandbox Fixes</h1>
          <p className="helper" style={{ marginTop: 8 }}>
            Review AI-generated recommendations to mitigate bias. Apply fixes to your sandbox environment to simulate their impact.
          </p>
        </div>
      </div>

      <div
        className="card"
        style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>{selected.length} fix{selected.length !== 1 ? 'es' : ''} selected</div>
          <div className="helper">
            {scenarioLoading
              ? 'Running the simulation…'
              : dirty
                ? 'Selection changed — run the simulation to see updated results.'
                : 'Results below reflect the current selection.'}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => handleSimulate(selected)}
          disabled={scenarioLoading || selected.length === 0}
        >
          {scenarioLoading ? 'Running…' : 'Run Simulation'}
        </button>
      </div>

      <div style={{ marginBottom: 40 }}>
        {renderFixGroup('Data Fixes', dataFixes)}
        {renderFixGroup('Model Fixes', modelFixes)}
        {renderFixGroup('Policy Fixes', policyFixes)}
        {recommendResult.length === 0 && <span className="helper">No fixes recommended based on the current results.</span>}
      </div>

      {sandboxResult && sandboxResult.scenarios && (
        <div className="card fade-in" style={{ marginBottom: 24 }}>
          <div className="section-title">Sandbox Comparison Results</div>
          <SandboxComparison scenarios={sandboxResult.scenarios || []} />
          {sandboxResult.recommendation && (
            <p className="helper" style={{ marginTop: 12 }}>
              {sandboxResult.recommendation}
            </p>
          )}
          {sandboxExplain && <ExplainThis payload={sandboxExplain} />}
        </div>
      )}

      {simulateError && (
        <div className="card" style={{ marginBottom: 24, borderColor: 'var(--red)', borderWidth: '1px', borderStyle: 'solid' }}>
          <p style={{ color: 'var(--red)' }}>Simulation error: {simulateError}</p>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
        <button className="btn btn-secondary" onClick={() => navigate('/workflow/step-7')}>
          <ArrowLeft size={16} /> Back
        </button>
        <button className="btn btn-primary" onClick={async () => {
          await advanceStep(9);
          navigate('/workflow/step-9');
        }}>
          Continue to Monitoring <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
