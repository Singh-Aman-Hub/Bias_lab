import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { Loader } from 'lucide-react';

const ANALYSIS_STAGES = [
  'Saving uploaded dataset',
  'Validating schema and selected columns',
  'Training model and computing fairness metrics',
  'Calculating SHAP values for explanations',
  'Running counterfactual fairness tests',
  'Probing model under stress perturbations',
  'Generating fix recommendations',
  'Finalizing report and preparing dashboard...',
];

export default function AnalysisProgress() {
  const navigate = useNavigate();
  const { isAnalyzing, analyzeError, pipelineResults } = useAppContext();
  const [stageIndex, setStageIndex] = useState(0);
  const isStarted = useRef(false);

  useEffect(() => {
    // Only animate if backend is actually running
    if (!isAnalyzing) return;
    
    isStarted.current = true;
    const interval = setInterval(() => {
      setStageIndex(prev => {
        // Stop at the last stage and wait for backend completion
        if (prev >= ANALYSIS_STAGES.length - 1) return prev;
        return prev + 1;
      });
    }, 4500); // Progress stage every ~4.5s
    
    return () => clearInterval(interval);
  }, [isAnalyzing]);

  useEffect(() => {
    // If backend finishes successfully, navigate to step 3
    if (isStarted.current && !isAnalyzing && !analyzeError && pipelineResults) {
      navigate('/workflow/step-3', { replace: true });
    }
  }, [isAnalyzing, analyzeError, pipelineResults, navigate]);

  if (analyzeError) {
    return (
      <div className="analysis-screen" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="analysis-card" style={{ maxWidth: 500, width: '100%', padding: 32, background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 16, textAlign: 'center' }}>⚠️</div>
          <h2 style={{ color: 'var(--red)', marginBottom: 12, textAlign: 'center' }}>Analysis Failed</h2>
          <p className="helper" style={{ marginBottom: 24, textAlign: 'center' }}>{analyzeError}</p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => navigate('/workflow/step-2')}>Back to Configuration</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-screen" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="analysis-card" style={{ maxWidth: 500, width: '100%', padding: 32, background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div className="analysis-spinner-ring" style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Loader size={28} color="var(--accent)" style={{ animation: 'spin 1.2s linear infinite' }} />
          </div>
          <h2 style={{ margin: 0, marginBottom: 8, fontSize: '1.4rem', color: 'var(--text-primary)' }}>Starting audit pipeline...</h2>
          <p className="helper" style={{ margin: 0 }}>
            Processing your dataset and running fairness algorithms. This may take a minute.
          </p>
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            <span>Status</span>
            <span>Running</span>
          </div>
          <div className="analysis-progress-track" style={{ height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
            <div className="analysis-progress-indeterminate" style={{ height: '100%', background: 'var(--accent)', width: `${((stageIndex + 1) / ANALYSIS_STAGES.length) * 100}%`, transition: 'width 0.5s ease-out' }} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ANALYSIS_STAGES.map((stage, i) => {
            const active = i === stageIndex;
            const completed = i < stageIndex;
            return (
              <div key={stage} className={`analysis-stage ${active ? 'is-active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: active ? 1 : (completed ? 0.6 : 0.3) }}>
                {active ? (
                  <Loader size={16} color="var(--accent)" style={{ animation: 'spin 1.2s linear infinite' }} />
                ) : completed ? (
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontSize: 10, fontWeight: 'bold' }}>✓</div>
                ) : (
                  <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--border)' }} />
                )}
                <span style={{ fontSize: '0.9rem', color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: active ? 500 : 400 }}>
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
