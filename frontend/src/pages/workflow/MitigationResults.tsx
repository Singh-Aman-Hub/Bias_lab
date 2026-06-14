import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, CheckCircle, TrendingUp, TrendingDown, Minus, Loader } from 'lucide-react';
import { api } from '../../api/client';
import ChatHelpButton from '../../components/ChatHelpButton';

export default function MitigationResults() {
  const { runId } = useParams();
  const [searchParams] = useSearchParams();
  const taskId = searchParams.get('taskId');
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Your sandbox fix is running. We are creating a new dataset version and rerunning the audit pipeline.');
  const [results, setResults] = useState<any>(null);
  const [llmExplanation, setLlmExplanation] = useState<any>(null);
  const [llmLoading, setLlmLoading] = useState(false);

  useEffect(() => {
    if (!runId) return;

    let intervalId: any;

    const pollStatus = async () => {
      try {
        if (!taskId) {
          // If no taskId, assume we just want the result
          fetchResult();
          return;
        }

        const res = await api.get(`/mitigation/status/${taskId}`);
        if (res.data.status === 'completed') {
          clearInterval(intervalId);
          fetchResult();
        } else if (res.data.status === 'failed' || res.data.status === 'error') {
          clearInterval(intervalId);
          setError(res.data.message || 'Sandbox fix failed during audit rerun.');
          setLoading(false);
        }
      } catch (err: any) {
        clearInterval(intervalId);
        setError(err.response?.data?.detail || err.message);
        setLoading(false);
      }
    };

    const fetchResult = async () => {
      try {
        setStatusText('Preparing before-vs-after comparison...');
        const res = await api.get(`/mitigation/result/${runId}`);
        setResults(res.data);
        setLoading(false);
        fetchExplanation(res.data);
      } catch (err: any) {
        setError(err.response?.data?.detail || err.message);
        setLoading(false);
      }
    };

    if (taskId) {
      intervalId = setInterval(pollStatus, 3000);
      pollStatus(); // initial check
    } else {
      fetchResult();
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [runId, taskId]);

  const fetchExplanation = async (resultData: any) => {
    setLlmLoading(true);
    try {
      const res = await api.post('/narrative/explain-mitigation', {
        mitigation_run_id: resultData.mitigation_run_id,
        removed_records_count: resultData.removed_records_count,
        retention_percentage: resultData.retention_percentage,
        original_summary: resultData.original_summary,
        mitigated_summary: resultData.mitigated_summary
      });
      if (res.data.status === 'ok' && res.data.mitigation_results && Object.keys(res.data.mitigation_results).length > 0) {
        setLlmExplanation(res.data.mitigation_results);
      } else {
        throw new Error("Empty or failed LLM response");
      }
    } catch (e) {
      console.warn("LLM explanation failed, falling back to deterministic explanation", e);
      
      // Deterministic Fallback
      const o = resultData.original_summary;
      const m = resultData.mitigated_summary;
      
      const fairnessChange = m.fairness_score - o.fairness_score;
      const accChange = (m.accuracy - o.accuracy) * 100;
      
      let summaryText = `Mitigation excluded ${resultData.removed_records_count} records. `;
      if (fairnessChange > 0) summaryText += `Fairness improved by ${fairnessChange.toFixed(1)} points. `;
      else summaryText += `Fairness did not improve. `;
      
      let accText = `Accuracy changed by ${accChange.toFixed(1)}%.`;
      if (fairnessChange > 0 && accChange < -2.0) {
          accText += " There is a notable trade-off between the fairness gains and model accuracy.";
      }
      
      setLlmExplanation({
          summary: summaryText,
          fairness_change_explanation: `The fairness score went from ${o.fairness_score.toFixed(1)} to ${m.fairness_score.toFixed(1)}. Demographic parity gap changed from ${o.demographic_parity_gap.toFixed(3)} to ${m.demographic_parity_gap.toFixed(3)}.`,
          accuracy_tradeoff_explanation: accText,
          remaining_risks: m.fairness_score < 80 ? "The fairness score remains below optimal levels." : "No critical fairness risks identified.",
          recommended_next_steps: "Review the dataset changes and consider deploying the mitigated dataset if the trade-offs are acceptable."
      });
    } finally {
      setLlmLoading(false);
    }
  };

  const handleDownload = () => {
    window.open(`${api.defaults.baseURL}/mitigation/download/${runId}`, '_blank');
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: 60, textAlign: 'center', marginTop: 40 }}>
        <Loader size={32} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 24px', color: 'var(--accent)' }} />
        <h2 style={{ marginBottom: 16 }}>Running Sandbox Fix</h2>
        <p className="helper">{statusText}</p>
        <ul style={{ textAlign: 'left', display: 'inline-block', marginTop: 24, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
          <li style={{ marginBottom: 8 }}><CheckCircle size={14} style={{ display: 'inline', color: 'var(--green)', marginRight: 8}}/> Creating mitigated dataset copy</li>
          <li style={{ marginBottom: 8 }}><CheckCircle size={14} style={{ display: 'inline', color: 'var(--green)', marginRight: 8}}/> Excluding selected pattern records</li>
          <li style={{ marginBottom: 8 }}><CheckCircle size={14} style={{ display: 'inline', color: 'var(--green)', marginRight: 8}}/> Saving new dataset version</li>
          <li style={{ marginBottom: 8 }}><Loader size={14} style={{ display: 'inline', color: 'var(--accent)', animation: 'spin 1s linear infinite', marginRight: 8}}/> Retraining model on mitigated dataset</li>
          <li style={{ marginBottom: 8 }}><span style={{ display: 'inline-block', width: 14, marginRight: 8 }}/> Rerunning fairness audit</li>
        </ul>
      </div>
    );
  }

  if (error || !results) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', borderColor: 'var(--red)' }}>
        <h2 style={{ marginBottom: 16, color: 'var(--red)' }}>Sandbox fix failed</h2>
        <p style={{ marginBottom: 24 }}>{error}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/workflow/step-8')}>Return to Sandbox Fixes</button>
      </div>
    );
  }

  const o = results.original_summary;
  const m = results.mitigated_summary;

  const getDeltaIcon = (orig: number, newV: number, isHigherBetter: boolean) => {
    if (orig === newV) return <Minus size={16} style={{ color: 'var(--text-secondary)' }} />;
    const improved = isHigherBetter ? newV > orig : newV < orig;
    if (improved) return <TrendingUp size={16} style={{ color: 'var(--green)' }} />;
    return <TrendingDown size={16} style={{ color: 'var(--red)' }} />;
  };

  const formatDelta = (orig: number, newV: number) => {
    const d = newV - orig;
    if (d === 0) return '0.00';
    return (d > 0 ? '+' : '') + d.toFixed(2);
  };

  const getOverallResult = () => {
    if (m.fairness_score > o.fairness_score && m.accuracy >= o.accuracy - 0.05) return "Improved";
    if (m.fairness_score > o.fairness_score && m.accuracy < o.accuracy - 0.05) return "Improved with accuracy trade-off";
    if (m.fairness_score <= o.fairness_score) return "Mixed or Worse";
    return "No major change";
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="kicker">Step 9 of 10</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Mitigation Results</h1>
            <ChatHelpButton section="Mitigation Results" description="View before and after comparison of your bias mitigation. Understand trade-offs between fairness and accuracy." />
          </div>
          <p className="helper" style={{ marginTop: 8 }}>
            Before-vs-after comparison between the original audit and the mitigated audit.
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleDownload} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Download size={16} /> Download Mitigated Dataset
        </button>
      </div>

      <div className="card" style={{ marginBottom: 24, display: 'flex', gap: 40, flexWrap: 'wrap' }}>
        <div>
          <span className="helper">Status</span>
          <div style={{ fontWeight: 600, color: 'var(--green)' }}>Mitigation completed</div>
        </div>
        <div>
          <span className="helper">Rows excluded</span>
          <div style={{ fontWeight: 600 }}>{results.removed_records_count} ({o.dataset_rows} → {m.dataset_rows})</div>
        </div>
        <div>
          <span className="helper">Dataset retained</span>
          <div style={{ fontWeight: 600 }}>{results.retention_percentage.toFixed(1)}%</div>
        </div>
        <div>
          <span className="helper">Fairness change</span>
          <div style={{ fontWeight: 600, color: m.fairness_score >= o.fairness_score ? 'var(--green)' : 'var(--red)' }}>
            {formatDelta(o.fairness_score, m.fairness_score)} (now {m.fairness_score.toFixed(1)})
          </div>
        </div>
        <div>
          <span className="helper">Accuracy change</span>
          <div style={{ fontWeight: 600, color: m.accuracy >= o.accuracy ? 'var(--green)' : 'var(--amber)' }}>
            {formatDelta(o.accuracy * 100, m.accuracy * 100)}% (now {(m.accuracy * 100).toFixed(1)}%)
          </div>
        </div>
        <div>
          <span className="helper">Overall Result</span>
          <div style={{ fontWeight: 600, color: 'var(--accent)' }}>{getOverallResult()}</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 32 }}>
        <div className="card">
          <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 16 }}>Original Audit</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Dataset rows</span> <strong>{o.dataset_rows}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Fairness score</span> <strong>{o.fairness_score.toFixed(1)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Overall accuracy</span> <strong>{(o.accuracy * 100).toFixed(1)}%</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Demographic parity gap</span> <strong>{o.demographic_parity_gap.toFixed(3)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Equal opportunity gap</span> <strong>{o.equal_opportunity_gap.toFixed(3)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Disparate impact ratio</span> <strong>{o.disparate_impact.toFixed(3)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Counterfactual flip rate</span> <strong>{(o.counterfactual_flip_rate * 100).toFixed(1)}%</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Decision patterns count</span> <strong>{o.decision_patterns_count}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Proxy risk score</span> <strong>{o.proxy_risk_score.toFixed(3)}</strong></div>
          </div>
        </div>

        <div className="card" style={{ backgroundColor: 'rgba(52, 214, 196, 0.02)', borderColor: 'rgba(52, 214, 196, 0.2)' }}>
          <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 16, color: 'var(--accent)' }}>After Sandbox Fix</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Dataset rows</span> <strong>{m.dataset_rows}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Fairness score</span> <strong>{m.fairness_score.toFixed(1)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Overall accuracy</span> <strong>{(m.accuracy * 100).toFixed(1)}%</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Demographic parity gap</span> <strong>{m.demographic_parity_gap.toFixed(3)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Equal opportunity gap</span> <strong>{m.equal_opportunity_gap.toFixed(3)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Disparate impact ratio</span> <strong>{m.disparate_impact.toFixed(3)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Counterfactual flip rate</span> <strong>{(m.counterfactual_flip_rate * 100).toFixed(1)}%</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Decision patterns count</span> <strong>{m.decision_patterns_count}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Proxy risk score</span> <strong>{m.proxy_risk_score.toFixed(3)}</strong></div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 32 }}>
        <h3 style={{ marginBottom: 16 }}>Metric Changes</h3>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              <th style={{ paddingBottom: 8 }}>Metric</th>
              <th style={{ paddingBottom: 8 }}>Before</th>
              <th style={{ paddingBottom: 8 }}>After</th>
              <th style={{ paddingBottom: 8 }}>Change</th>
              <th style={{ paddingBottom: 8 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Fairness score', b: o.fairness_score, a: m.fairness_score, higherBetter: true },
              { label: 'Overall accuracy', b: o.accuracy * 100, a: m.accuracy * 100, higherBetter: true },
              { label: 'Demographic parity gap', b: o.demographic_parity_gap, a: m.demographic_parity_gap, higherBetter: false },
              { label: 'Equal opportunity gap', b: o.equal_opportunity_gap, a: m.equal_opportunity_gap, higherBetter: false },
              { label: 'Predictive parity gap', b: o.predictive_parity_gap, a: m.predictive_parity_gap, higherBetter: false },
              { label: 'Disparate impact ratio', b: o.disparate_impact, a: m.disparate_impact, higherBetter: true }, // Ratio closer to 1 is better usually, let's treat higher (up to 1) as better
              { label: 'Counterfactual flip rate', b: o.counterfactual_flip_rate * 100, a: m.counterfactual_flip_rate * 100, higherBetter: false },
              { label: 'Decision patterns count', b: o.decision_patterns_count, a: m.decision_patterns_count, higherBetter: false },
              { label: 'Proxy risk score', b: o.proxy_risk_score, a: m.proxy_risk_score, higherBetter: false },
            ].map((row, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 0' }}>{row.label}</td>
                <td style={{ padding: '12px 0' }}>{row.b.toFixed(2)}</td>
                <td style={{ padding: '12px 0' }}>{row.a.toFixed(2)}</td>
                <td style={{ padding: '12px 0', color: row.higherBetter ? (row.a > row.b ? 'var(--green)' : row.a < row.b ? 'var(--red)' : 'var(--text-secondary)') : (row.a < row.b ? 'var(--green)' : row.a > row.b ? 'var(--red)' : 'var(--text-secondary)') }}>
                  {formatDelta(row.b, row.a)}
                </td>
                <td style={{ padding: '12px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {getDeltaIcon(row.b, row.a, row.higherBetter)}
                    {row.a === row.b ? 'No change' : (row.higherBetter ? (row.a > row.b ? 'Improved' : 'Worse') : (row.a < row.b ? 'Improved' : 'Worse'))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 16 }}>Explanation Summary</h3>
        {llmLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Loader size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)', margin: '0 auto 12px' }} />
            <div className="helper">Generating AI explanation of the mitigation trade-offs...</div>
          </div>
        ) : llmExplanation ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Summary</strong>
              <p style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{llmExplanation.summary}</p>
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Fairness Change</strong>
              <p style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{llmExplanation.fairness_change_explanation}</p>
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Accuracy Trade-off</strong>
              <p style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{llmExplanation.accuracy_tradeoff_explanation}</p>
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Remaining Risks</strong>
              <p style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{llmExplanation.remaining_risks}</p>
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Recommended Next Steps</strong>
              <p style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{llmExplanation.recommended_next_steps}</p>
            </div>
          </div>
        ) : (
          <p className="helper">AI explanation unavailable. Check your API key or network connection.</p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
        <button className="btn btn-secondary" onClick={() => navigate('/workflow/step-8')}>
          <ArrowLeft size={16} /> Back to Sandbox Fixes
        </button>
      </div>
    </div>
  );
}
