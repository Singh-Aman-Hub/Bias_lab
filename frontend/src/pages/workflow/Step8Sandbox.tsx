import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, CheckCircle, Info, Loader, AlertTriangle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { api } from '../../api/client';
import ChatHelpButton from '../../components/ChatHelpButton';

interface MitigationPattern {
  pattern_id: string;
  title: string;
  affected_record_count: number;
  decision_type: string;
  risk_type: string;
  risk_level: string;
  confidence: string;
  sensitive_group: string;
  top_drivers: Array<{ feature: string; avg_shap: number; direction: string }>;
  proxy_involved: boolean;
  plain_explanation: string;
  representative_records: Array<any>;
  record_ids?: string[] | number[];
}

interface CandidatesResponse {
  audit_run_id: number;
  project_id: number;
  original_dataset_rows: number;
  patterns: MitigationPattern[];
  candidate_record_count: number;
  recommendations: {
    status: string;
    message: string;
  };
}

export default function Step8Sandbox() {
  const { projectId, advanceStep, file, pipelineResults } = useAppContext();
  const navigate = useNavigate();

  const auditRunId = (pipelineResults as any)?.audit_run_id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidatesData, setCandidatesData] = useState<CandidatesResponse | null>(null);
  
  const [selectedPatternIds, setSelectedPatternIds] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedExpl, setExpandedExpl] = useState<Record<string, boolean>>({});
  const [expandedReps, setExpandedReps] = useState<Record<string, boolean>>({});
  const [showLowImpact, setShowLowImpact] = useState(false);
  
  const [applying, setApplying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'All' | 'Recommended to Test' | 'Use Caution' | 'Low Expected Impact' | 'Not Advised' | 'Individual Cases'>('All');

  useEffect(() => {
    if (!auditRunId) return;
    setLoading(true);
    api.get(`/mitigation/candidates/${auditRunId}`)
      .then(res => {
        setCandidatesData(res.data);
        // Pre-select recommended? (Optional, let's keep it empty by default to prevent accidental data loss)
      })
      .catch(err => {
        setError(err.response?.data?.detail || "Failed to load mitigation candidates.");
      })
      .finally(() => setLoading(false));
  }, [auditRunId]);

  if (!file) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <h2 style={{ marginBottom: 16 }}>No dataset uploaded</h2>
        <p className="helper" style={{ marginBottom: 24 }}>Please go back and upload a dataset to begin.</p>
        <button className="btn btn-primary" onClick={() => navigate('/workflow/step-1')}>Go to Upload</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', marginTop: 40 }}>
        <Loader size={32} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 24px', color: 'var(--accent)' }} />
        <h2>Loading decision patterns...</h2>
        <p className="helper">Fetching mitigation candidates based on your recent audit.</p>
      </div>
    );
  }

  if (error || !candidatesData || candidatesData.patterns.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div className="kicker">Step 8 of 10</div>
          <h1 className="page-title">Sandbox Fixes</h1>
          <p className="helper">Review flagged decision patterns and choose which records should be excluded.</p>
        </div>
        <div className="card empty-state">
          <h3 style={{ marginBottom: 8 }}>No Patterns Available</h3>
          <p className="helper">{error || "No mitigation-ready decision patterns were found. The current audit did not produce enough evidence for record-exclusion mitigation."}</p>
        </div>
      </div>
    );
  }

  const handleTogglePattern = (patternId: string) => {
    setSelectedPatternIds(prev => 
      prev.includes(patternId) ? prev.filter(p => p !== patternId) : [...prev, patternId]
    );
  };

  // Unique record IDs selected via a Set to avoid double-counting overlap
  const getSelectedRecords = () => {
    const selectedRecords = new Set<string>();
    candidatesData.patterns.forEach(p => {
      if (selectedPatternIds.includes(p.pattern_id)) {
        if (p.record_ids) {
          p.record_ids.forEach(id => selectedRecords.add(String(id)));
        }
      }
    });
    return Array.from(selectedRecords);
  };

  // Use actual original_dataset_rows from the API (never fall back to pattern-level fields)
  const originalRows = candidatesData.original_dataset_rows ?? 0;

  const exactIds = getSelectedRecords();
  // Count unique selected record IDs; fall back to summing pattern.affected_record_count
  // only if record_ids arrays are absent from every selected pattern
  const hasExactIds = exactIds.length > 0 || selectedPatternIds.every(id => {
    const p = candidatesData.patterns.find(x => x.pattern_id === id);
    return p && p.record_ids && p.record_ids.length === 0;
  });
  let selectedRecordCount = 0;
  if (exactIds.length > 0) {
    selectedRecordCount = exactIds.length;
  } else {
    selectedPatternIds.forEach(id => {
      const p = candidatesData.patterns.find(x => x.pattern_id === id);
      if (p) selectedRecordCount += p.affected_record_count;
    });
  }

  const rowsAfterExclusion = originalRows > 0 ? Math.max(0, originalRows - selectedRecordCount) : 0;
  const retentionPercentage = originalRows > 0 ? (rowsAfterExclusion / originalRows) * 100 : 100;
  const dataLossRisk = retentionPercentage < 90 ? 'High' : (retentionPercentage < 95 ? 'Moderate' : 'Low');

  const handleConfirmApply = async () => {
    setApplying(true);
    try {
      const recordIds = exactIds.length > 0 ? exactIds : [];
      const res = await api.post('/mitigation/apply', {
        project_id: Number(projectId),
        audit_run_id: Number(auditRunId),
        selected_pattern_ids: selectedPatternIds,
        selected_record_ids: recordIds,
        strategy: 'exclude_records'
      });
      
      const mitigationRunId = res.data.mitigation_run_id;
      const taskId = res.data.task_id;
      localStorage.setItem('latest_mitigation_run_id', String(mitigationRunId));
      await advanceStep(9);
      navigate(`/workflow/mitigation-results/${mitigationRunId}?taskId=${taskId}`);
    } catch (err: any) {
      alert("Failed to apply mitigation: " + (err.response?.data?.detail || err.message));
      setApplying(false);
      setShowConfirm(false);
    }
  };

  // --- Categorise patterns using the 4-tier label logic ---
  // Retention impact is estimated per-pattern to determine the label before a run.
  const categorizedPatterns = candidatesData.patterns.map(p => {
    const patternRecCount = p.record_ids ? p.record_ids.length : p.affected_record_count;
    const retIfSelected = originalRows > 0 ? ((originalRows - patternRecCount) / originalRows) * 100 : 100;

    // Not Advised: would make dataset unsafe (< 90 % retention) OR individual-case with low confidence
    const wouldBreachSafety = retIfSelected < 90;
    // Low Expected Impact: very few records affected (≤ 2)
    const isLowImpact = patternRecCount <= 2;
    // Use Caution: retention 90–95 %, or spans multiple intersectional groups
    const groups = p.sensitive_group.split(' + ').filter(Boolean);
    const isMultiGroup = groups.length > 3;
    const retBetween90and95 = retIfSelected >= 90 && retIfSelected < 95;

    let category: 'Recommended to Test' | 'Use Caution' | 'Low Expected Impact' | 'Not Advised' | 'Individual Cases';
    let recLabel: string;
    let recColor: string;
    let recReason: string;

    if (wouldBreachSafety) {
      category = 'Not Advised';
      recLabel = 'Not Advised';
      recColor = 'var(--red)';
      recReason = 'Removing this pattern would reduce dataset retention below 90%, making the rerun unreliable.';
    } else if (isLowImpact) {
      category = 'Low Expected Impact';
      recLabel = 'Low Expected Impact';
      recColor = 'var(--text-secondary)';
      recReason = 'Very few records affected; the expected fairness improvement from excluding this pattern is likely small.';
    } else if (retBetween90and95 || isMultiGroup) {
      category = 'Use Caution';
      recLabel = 'Use Caution';
      recColor = 'var(--amber)';
      recReason = isMultiGroup
        ? 'This pattern spans multiple sensitive/intersectional groups. Exclusion may affect representation.'
        : `Estimated retention after exclusion: ${retIfSelected.toFixed(1)}%. Review before confirming.`;
    } else {
      category = 'Recommended to Test';
      recLabel = 'Recommended to Test';
      recColor = 'var(--green)';
      recReason = 'Dataset retention stays above 95% and no safety threshold is breached. Safe to test in sandbox.';
    }

    return { ...p, category, recLabel, recColor, recReason };
  });

  const lowImpactPatterns = categorizedPatterns.filter(p => p.category === 'Low Expected Impact');
  const individualCasePatterns = categorizedPatterns.filter(p => p.affected_record_count <= 1);

  const TABS = ['All', 'Recommended to Test', 'Use Caution', 'Low Expected Impact', 'Not Advised', 'Individual Cases'] as const;

  const filteredPatterns = activeTab === 'All'
    ? categorizedPatterns
    : activeTab === 'Individual Cases'
    ? categorizedPatterns.filter(p => p.affected_record_count <= 1)
    : categorizedPatterns.filter(p => p.category === activeTab);

  const sectionTitle: Record<string, string> = {
    'All': 'All Patterns',
    'Recommended to Test': 'Recommended Patterns',
    'Use Caution': 'Caution Patterns',
    'Low Expected Impact': 'Low-Impact Patterns',
    'Not Advised': 'Not-Advised Patterns',
    'Individual Cases': 'Individual Cases',
  };

  const PatternCard = ({ p }: { p: any }) => {
    const isSelected = selectedPatternIds.includes(p.pattern_id);
    const isMuted = p.category === 'Not Advised' || p.category === 'Low Expected Impact';

    const recIcon = p.category === 'Recommended to Test' ? <CheckCircle size={14} />
      : p.category === 'Use Caution' ? <AlertCircle size={14} />
      : p.category === 'Low Expected Impact' ? <Info size={14} />
      : <AlertTriangle size={14} />;

    let shortExpl = `This pattern involves ${p.affected_record_count} ${p.affected_record_count === 1 ? 'record' : 'records'}. `;
    if (p.counterfactual_flip_rate === 0) {
      shortExpl += "Counterfactual flip rate is 0%, so this pattern did not show direct demographic flip sensitivity.";
    } else {
      shortExpl += `Counterfactual flip rate is ${(p.counterfactual_flip_rate * 100).toFixed(1)}%.`;
    }

    const groups = p.sensitive_group.split(' + ');
    const isMultipleGroups = groups.length > 3;
    const groupSummary = isMultipleGroups ? "Multiple subgroups" : p.sensitive_group;

    return (
      <div className={`card ${isSelected ? 'selected' : ''}`} style={{ marginBottom: 16, padding: 16, border: isSelected ? '2px solid var(--accent)' : isMuted ? '1px solid var(--border)' : undefined, opacity: (!isSelected && isMuted) ? 0.85 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1rem' }}>{p.title}</h3>
            <span className="helper" style={{ fontSize: '0.85rem' }}>{p.pattern_id} · {p.affected_record_count} {p.affected_record_count === 1 ? 'record' : 'records'} affected</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className={`pill ${p.risk_level === 'high' ? 'red' : 'amber'}`}>{p.risk_level.toUpperCase()} RISK</span>
            <span className="pill gray">{p.confidence.toUpperCase()} CONFIDENCE</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', color: isSelected ? 'var(--accent)' : 'var(--text-primary)' }}>
              <input type="checkbox" checked={isSelected} onChange={() => handleTogglePattern(p.pattern_id)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              Include
            </label>
          </div>
        </div>

        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 12 }}>
          {shortExpl}
        </p>

        <div style={{ backgroundColor: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 16, fontSize: '0.85rem', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: p.recColor, whiteSpace: 'nowrap' }}>
            {recIcon} <strong style={{ textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '0.75rem' }}>{p.recLabel}</strong>
          </div>
          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            Excludes {p.affected_record_count} {p.affected_record_count === 1 ? 'record' : 'records'}. Creates a new dataset copy.
          </div>
          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <div style={{ color: 'var(--text-secondary)' }}>{p.recReason}</div>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem' }}>
          <button className="btn btn-ghost" style={{ padding: 0, color: 'var(--text-secondary)' }} onClick={() => setExpandedGroups(prev => ({...prev, [p.pattern_id]: !prev[p.pattern_id]}))}>
            Affected groups: {groupSummary} {isMultipleGroups && !expandedGroups[p.pattern_id] && ` (+${groups.length - 3} more)`} <ChevronDown size={14} />
          </button>
          <button className="btn btn-ghost" style={{ padding: 0, color: 'var(--text-secondary)' }} onClick={() => setExpandedExpl(prev => ({...prev, [p.pattern_id]: !prev[p.pattern_id]}))}>
            {expandedExpl[p.pattern_id] ? 'Hide' : 'View'} detailed explanation <ChevronDown size={14} />
          </button>
          <button className="btn btn-ghost" style={{ padding: 0, color: 'var(--text-secondary)' }} onClick={() => setExpandedReps(prev => ({...prev, [p.pattern_id]: !prev[p.pattern_id]}))}>
            {expandedReps[p.pattern_id] ? 'Hide' : 'View'} representative records <ChevronDown size={14} />
          </button>
        </div>

        {expandedGroups[p.pattern_id] && isMultipleGroups && (
          <div style={{ marginTop: 12, padding: 12, backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {groups.map((g: string, i: number) => <span key={i} className="pill" style={{ backgroundColor: 'var(--bg-secondary)' }}>{g}</span>)}
            </div>
          </div>
        )}

        {expandedExpl[p.pattern_id] && (
          <div style={{ marginTop: 12, padding: 12, backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
            {p.plain_explanation}
          </div>
        )}

        {expandedReps[p.pattern_id] && (
          <div style={{ marginTop: 12 }}>
            <table style={{ width: '100%', fontSize: '0.85rem', textAlign: 'left', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  <th style={{ paddingBottom: 6, width: '15%' }}>Record ID</th>
                  <th style={{ paddingBottom: 6, width: '20%' }}>Decision (Score)</th>
                  <th style={{ paddingBottom: 6, width: '25%' }}>Sensitive Group</th>
                  <th style={{ paddingBottom: 6 }}>Top Driver</th>
                </tr>
              </thead>
              <tbody>
                {p.representative_records.slice(0, 3).map((rec: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 0' }}>{rec.record_id}</td>
                    <td style={{ padding: '8px 0' }}>{rec.prediction} ({rec.score.toFixed(2)})</td>
                    <td style={{ padding: '8px 0' }}>{rec.sensitive_group}</td>
                    <td style={{ padding: '8px 0' }}>
                      {rec.top_shap && rec.top_shap[0] ? (
                        <span className="pill" style={{ padding: '2px 6px', fontSize: '0.75rem', backgroundColor: 'var(--bg-secondary)' }}>
                          {rec.top_shap[0].feature}: {rec.top_shap[0].value}
                        </span>
                      ) : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ paddingBottom: 100 }}>
      <div className="page-header">
        <div>
          <div className="kicker">Step 8 of 10</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Sandbox Fixes</h1>
            <ChatHelpButton section="Sandbox Fixes" description="Review decision patterns and simulate mitigation by excluding specific records to test fairness improvements." />
          </div>
          <p className="helper" style={{ marginTop: 8 }}>
            Review flagged decision patterns and choose which records should be excluded from a new mitigated dataset version.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24, padding: '12px 16px', backgroundColor: 'rgba(234, 179, 8, 0.05)', borderColor: 'rgba(234, 179, 8, 0.2)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Info size={16} style={{ color: 'var(--amber)' }} />
        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--amber)' }}>Sandbox fixes create a new dataset copy.</strong> The original dataset remains unchanged.
        </span>
      </div>

      <div className="card" style={{ marginBottom: 32, padding: 20 }}>
        <h3 style={{ marginBottom: 16, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary)' }}>Mitigation Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          <div><div className="helper">Original Rows</div><div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{originalRows}</div></div>
          <div><div className="helper">Patterns Found</div><div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{candidatesData.patterns.length}</div></div>
          <div><div className="helper">Selected Patterns</div><div style={{ fontSize: '1.5rem', fontWeight: 600, color: selectedPatternIds.length > 0 ? 'var(--accent)' : undefined }}>{selectedPatternIds.length}</div></div>
          <div><div className="helper">Selected Records</div><div style={{ fontSize: '1.5rem', fontWeight: 600, color: selectedRecordCount > 0 ? 'var(--accent)' : undefined }}>{selectedRecordCount}</div></div>
          <div><div className="helper">Retention</div><div style={{ fontSize: '1.5rem', fontWeight: 600, color: dataLossRisk === 'High' ? 'var(--red)' : 'var(--green)' }}>{retentionPercentage.toFixed(1)}%</div></div>
        </div>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 32, fontSize: '0.9rem' }}>
          <div><span className="helper">Rows after exclusion:</span> <strong style={{ color: 'var(--text-primary)' }}>{rowsAfterExclusion}</strong></div>
          <div>
            <span className="helper">Data-loss risk:</span> <strong style={{ color: dataLossRisk === 'High' ? 'var(--red)' : dataLossRisk === 'Moderate' ? 'var(--amber)' : 'var(--green)' }}>{dataLossRisk}</strong>
          </div>
        </div>
      </div>

      <p className="helper" style={{ marginBottom: 16 }}>
        Patterns below are grouped from the Explanation page. Selecting a pattern excludes its associated records only from a new dataset copy, then the audit can be rerun for comparison.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 8, flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            className={`btn ${activeTab === tab ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(tab as any)}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            {tab}{tab === 'Individual Cases' ? ` (${categorizedPatterns.filter(p => p.affected_record_count <= 1).length})` : ''}
          </button>
        ))}
      </div>

      {filteredPatterns.length === 0 ? (
        <div className="card empty-state" style={{ padding: 40, textAlign: 'center' }}>
          <p className="helper">No patterns match the selected filter.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: 16, fontSize: '1rem', color: 'var(--text-primary)' }}>
            {sectionTitle[activeTab] ?? 'All Patterns'}
          </h3>
          {filteredPatterns.map(p => <PatternCard key={p.pattern_id} p={p} />)}
        </div>
      )}

      {/* Sticky Bottom Bar */}
      <div style={{
        position: 'fixed', bottom: 0, left: 240, right: 0, height: 72, 
        backgroundColor: 'rgba(10, 10, 10, 0.95)', backdropFilter: 'blur(12px)', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', zIndex: 100
      }}>
        <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          <div><div className="helper" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>Selected Patterns</div><div style={{ fontWeight: 600 }}>{selectedPatternIds.length}</div></div>
          <div><div className="helper" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>Records</div><div style={{ fontWeight: 600 }}>{selectedRecordCount}</div></div>
          <div><div className="helper" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>Retention</div><div style={{ fontWeight: 600, color: dataLossRisk === 'High' ? 'var(--red)' : 'var(--green)' }}>{retentionPercentage.toFixed(1)}%</div></div>
          <div><div className="helper" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>Risk</div><div style={{ fontWeight: 600, color: dataLossRisk === 'High' ? 'var(--red)' : dataLossRisk === 'Moderate' ? 'var(--amber)' : 'var(--green)' }}>{dataLossRisk}</div></div>
        </div>
        <div>
          {selectedPatternIds.length === 0 ? (
            <span className="helper" style={{ marginRight: 16, fontSize: '0.9rem' }}>Select at least one pattern to continue.</span>
          ) : null}
          <button className="btn btn-primary" disabled={selectedPatternIds.length === 0} onClick={() => setShowConfirm(true)}>
            Generate Mitigated Dataset & Rerun Audit
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ maxWidth: 500, width: '100%', padding: 24, border: '1px solid var(--border)', backgroundColor: '#111' }}>
            <h2 style={{ marginBottom: 16 }}>Confirm Mitigation</h2>
            <div style={{ marginBottom: 24, backgroundColor: 'var(--bg-tertiary)', padding: 16, borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span className="helper">Selected Patterns:</span> <strong>{selectedPatternIds.length}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span className="helper">Selected Records:</span> <strong>{selectedRecordCount}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span className="helper">Rows after exclusion:</span> <strong>{rowsAfterExclusion}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span className="helper">Retention:</span> <strong style={{ color: dataLossRisk === 'High' ? 'var(--red)' : 'var(--text-primary)' }}>{retentionPercentage.toFixed(1)}%</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="helper">Data-loss Risk:</span> <strong style={{ color: dataLossRisk === 'High' ? 'var(--red)' : dataLossRisk === 'Moderate' ? 'var(--amber)' : 'var(--green)' }}>{dataLossRisk}</strong></div>
            </div>
            <p className="helper" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Info size={16} /> The original dataset will remain unchanged.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-ghost" onClick={() => setShowConfirm(false)} disabled={applying}>Cancel</button>
              <button className="btn btn-primary" onClick={handleConfirmApply} disabled={applying}>
                {applying ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                Confirm & Run Sandbox Fix
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
