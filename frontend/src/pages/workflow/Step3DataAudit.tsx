import { useMemo, useState } from 'react';
import ExplainThis from '../../components/ExplainThis';
import ChatHelpButton from '../../components/ChatHelpButton';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { scoreColor } from '../../utils/score';
import { buildExplainItems } from '../../utils/explainItems';
import type { DataAuditResult, ProxyResult } from '../../types';

export default function Step3DataAudit() {
  const { pipelineResults, auditResult: audit, proxyResult: proxy, domain, advanceStep } = useAppContext();
  const navigate = useNavigate();
  const explainItems = useMemo(() => buildExplainItems(pipelineResults, domain), [pipelineResults, domain]);
  const auditExplain = explainItems.find((i) => i.metric === 'data_audit_overall');
  const proxyExplain = explainItems.find((i) => i.metric === 'data_audit_proxy');

  const auditData = audit as DataAuditResult & { under_represented_groups?: string[]; risk_reason?: string };

  // Backend risk_level is "Red" | "Yellow" | "Green"; map to human-readable severity.
  const RISK_LABEL: Record<string, string> = { Red: 'High', Yellow: 'Moderate', Green: 'Low' };
  const riskWord = RISK_LABEL[audit?.risk_level ?? ''] ?? audit?.risk_level ?? 'Unknown';

  const fairnessScore = useMemo(() => {
    // Prefer the authoritative data-bias score computed by the pipeline.
    const fromPipeline = (pipelineResults as unknown as { scores?: { data_bias_score?: number } })?.scores?.data_bias_score;
    if (typeof fromPipeline === 'number') return fromPipeline;
    if (!audit) return 0;
    const base = audit.risk_level === 'Red' ? 48 : audit.risk_level === 'Yellow' ? 70 : 88;
    return Math.max(0, Math.min(100, base - (Object.keys(audit.missing_data || {}).length * 2)));
  }, [audit, pipelineResults]);

  // Tab state for selecting which sensitive column to view in the table
  const sensitiveCols = useMemo(() => {
    return audit?.group_stats ? Object.keys(audit.group_stats as Record<string, any>) : [];
  }, [audit]);

  const [activeCol, setActiveCol] = useState<string>('');
  const currentCol = activeCol || sensitiveCols[0] || '';

  // Table sorting state
  const [sortField, setSortField] = useState<'group' | 'count' | 'share' | 'positive_rate'>('count');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo(() => {
    if (!audit?.group_stats || !currentCol) return [];
    const groupStats = audit.group_stats as Record<string, any>;
    if (!groupStats[currentCol]) return [];
    
    const stats = groupStats[currentCol];
    if (Array.isArray(stats)) {
      return stats.map((s: any) => ({
        group: s.group,
        count: s.count ?? 0,
        share: s.share ?? s.percentage ?? 0,
        positive_rate: s.approval_rate ?? s.positive_rate ?? 0,
        under_represented: !!s.under_represented,
        low_confidence: !!s.low_confidence,
      }));
    }
    
    return Object.entries(stats).map(([group, val]: [string, any]) => ({
      group,
      count: val.count ?? 0,
      share: val.share ?? val.percentage ?? 0,
      positive_rate: val.positive_rate ?? val.approval_rate ?? 0,
      under_represented: !!val.under_represented,
      low_confidence: !!val.low_confidence,
    }));
  }, [audit, currentCol]);

  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'group') {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, sortField, sortDirection]);

  const handleSort = (field: 'group' | 'count' | 'share' | 'positive_rate') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const proxyFeatures = (proxy as ProxyResult & { proxy_features?: Array<{ feature: string; proxy_score?: number; cluster_proxy_score?: number; combined_score?: number; correlated_with?: string; related_sensitive?: string; warning?: string }> })?.proxy_features ?? [];

  if (!pipelineResults || !audit || !proxy) {
    return (
      <div>
        <div className="page-header">
          <div>
            <div className="kicker">Step 3 of 9</div>
            <h1 className="page-title">Data Audit</h1>
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

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="kicker">Step 3 of 9</div>
          <h1 className="page-title">Data Audit</h1>
          <p className="page-subtitle">We analyzed your dataset for representation bias and missing data before modeling.</p>
        </div>
      </div>

      <div className={`banner ${audit.risk_level.toLowerCase()}`} style={{ marginBottom: 16 }}>
        <h2 className="section-title" style={{ margin: 0 }}>{riskWord} risk detected</h2>
        <p className="helper" style={{ color: 'inherit' }}>{auditData.risk_reason}</p>
      </div>

      <div className="card section-gap">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="stat-label">Data Fairness Score</div>
          <ChatHelpButton section="Data Fairness Score" description="An aggregate score combining representation gaps, missing data, and proxy feature pressure." extraContext={{ fairness_score: fairnessScore, risk_level: audit.risk_level, max_gap: audit.max_gap }} />
        </div>
        <div className="stat-number text-8xl" style={{ color: scoreColor(fairnessScore) }}>
          {fairnessScore}
        </div>
        <p className="helper">Representation, missingness, and proxy-feature pressure combined into one forensic score.</p>
        {auditExplain && <ExplainThis payload={auditExplain} />}
      </div>

      {/* Group Representation section */}
      <div className="card section-gap">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div className="section-title" style={{ margin: 0 }}>Group Representation & Approval Rates</div>
            <p className="helper" style={{ marginTop: 4 }}>
              Distribution and favorable outcome rates across subgroups of selected sensitive attributes.
            </p>
          </div>
          <ChatHelpButton
            section="Under-Represented Groups"
            description="Groups that have fewer than 30 samples or make up less than 5% of the dataset. Findings for these groups may be statistically unreliable."
            extraContext={{ sensitive_column: currentCol }}
          />
        </div>

        {/* Tab switcher for multiple sensitive columns */}
        {sensitiveCols.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {sensitiveCols.map((col) => {
              const isActive = col === currentCol;
              const meta = audit?.column_metadata?.[col];
              return (
                <button
                  key={col}
                  className="btn btn-small"
                  style={{
                    backgroundColor: isActive ? 'var(--accent-soft)' : 'rgba(255, 255, 255, 0.02)',
                    borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                    color: isActive ? 'var(--accent-strong)' : 'var(--text-secondary)',
                  }}
                  onClick={() => {
                    setActiveCol(col);
                    setSortField('count');
                    setSortDirection('desc');
                  }}
                >
                  {col}
                  {meta?.column_type === 'continuous' && (
                    <span style={{ marginLeft: 6, fontSize: '0.65rem', opacity: 0.7, textTransform: 'uppercase' }}>
                      Binned
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Processing Details */}
        {audit?.column_metadata?.[currentCol] && (
          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.01)',
            border: '0.5px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 12px',
            marginBottom: 16,
            fontSize: '0.82rem',
            display: 'flex',
            gap: 16,
            color: 'var(--text-secondary)'
          }}>
            <div>
              Type: <strong style={{ color: 'var(--text-primary)' }}>{audit.column_metadata[currentCol].column_type}</strong>
            </div>
            <div style={{ width: 1, backgroundColor: 'var(--border)' }} />
            <div>
              Grouping: <strong style={{ color: 'var(--text-primary)' }}>{audit.column_metadata[currentCol].grouping_method}</strong>
            </div>
          </div>
        )}

        {/* Sortable Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('group')}>
                  Group Value {sortField === 'group' ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }} onClick={() => handleSort('count')}>
                  Sample Count (n) {sortField === 'count' ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'right' }} onClick={() => handleSort('share')}>
                  Dataset Share {sortField === 'share' ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th style={{ cursor: 'pointer', userSelect: 'none', width: '35%' }} onClick={() => handleSort('positive_rate')}>
                  Positive/Approval Rate {sortField === 'positive_rate' ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const sharePct = ((row.share ?? 0) * 100).toFixed(1);
                const positivePct = Math.round((row.positive_rate ?? 0) * 100);
                return (
                  <tr key={row.group}>
                    <td style={{ fontWeight: 600 }}>{row.group}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{row.count.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{sharePct}%</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', minWidth: 40 }}>{positivePct}%</span>
                        <div className="progress-track" style={{ height: 6, flex: 1, minWidth: 60 }}>
                          <div
                            className="progress-fill"
                            style={{
                              width: `${positivePct}%`,
                              background: row.low_confidence 
                                ? 'linear-gradient(90deg, var(--text-muted), var(--border))'
                                : 'linear-gradient(90deg, var(--accent), #e9be95)'
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {row.low_confidence && (
                          <span className="pill yellow" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                            Low Confidence
                          </span>
                        )}
                        {row.under_represented && (
                          <span className="pill red" style={{ fontSize: '0.7rem', padding: '2px 8px', borderColor: 'rgba(242, 100, 50, 0.4)', background: 'rgba(242, 100, 50, 0.1)', color: '#f26432' }}>
                            Under-represented
                          </span>
                        )}
                        {!row.low_confidence && !row.under_represented && (
                          <span className="pill green" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                            Reliable
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16, fontSize: '0.78rem', color: 'var(--text-secondary)', flexWrap: 'wrap', borderTop: '0.5px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pill green" style={{ pointerEvents: 'none', padding: '1px 6px', fontSize: '0.65rem' }}>Reliable</span>
            <span>Group has ≥ 30 samples and ≥ 5% dataset share.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pill yellow" style={{ pointerEvents: 'none', padding: '1px 6px', fontSize: '0.65rem' }}>Low Confidence</span>
            <span>Sample size &lt; 30 (excluded from top-level gap calculations).</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="pill red" style={{ pointerEvents: 'none', padding: '1px 6px', fontSize: '0.65rem', borderColor: 'rgba(242, 100, 50, 0.4)', background: 'rgba(242, 100, 50, 0.1)', color: '#f26432' }}>Under-represented</span>
            <span>Dataset share &lt; 5% (high risk of sampling bias).</span>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        {/* Missing Data table */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="section-title">Missing data</div>
            <ChatHelpButton section="Missing Data" description="Columns with missing values. High missingness can introduce bias if it correlates with sensitive attributes." />
          </div>
          <table className="table">
            <thead><tr><th>Column</th><th>% Missing</th><th>Severity</th></tr></thead>
            <tbody>
              {Object.entries(audit.missing_data || {}).map(([column, value]) => (
                <tr key={column}>
                  <td>{column}</td>
                  <td>{(value * 100).toFixed(1)}%</td>
                  <td><span className={`pill ${value > 0.1 ? 'red' : value > 0.05 ? 'yellow' : 'green'}`}>{value > 0.1 ? 'High' : value > 0.05 ? 'Moderate' : 'Low'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Proxy risk section */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="section-title">Proxy risk</div>
            <ChatHelpButton section="Proxy Feature Risk" description="Features that are highly correlated with sensitive attributes and may act as indirect proxies, introducing hidden bias." extraContext={{ proxy_features: proxyFeatures.map((f: any) => f.feature) }} />
          </div>
          <div className="helper">Features that highly correlate with sensitive attributes.</div>
          <div className="notice-list" style={{ marginTop: 12 }}>
            {proxyFeatures.map((feature: { feature: string; proxy_score?: number; cluster_proxy_score?: number; combined_score?: number; correlated_with?: string; related_sensitive?: string; warning?: string }) => {
              const score = feature.proxy_score ?? feature.cluster_proxy_score ?? feature.combined_score ?? 0;
              const clamped = Math.max(0, Math.min(1, score));
              const pct = Math.round(clamped * 100);
              const correlatedWith = feature.correlated_with ?? feature.related_sensitive ?? 'sensitive attribute';
              return (
                <div className="notice" key={feature.feature}>
                  <strong>{feature.feature}</strong>
                  <div className="helper">Correlated with {correlatedWith}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '10px 0 6px' }}>
                    <span className="helper" style={{ margin: 0 }}>Correlation strength</span>
                    <strong style={{ fontSize: '0.95rem', color: pct >= 70 ? 'var(--red)' : pct >= 50 ? 'var(--yellow)' : 'var(--accent)' }}>{pct}%</strong>
                  </div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${clamped * 100}%` }} /></div>
                  <div className="helper" style={{ marginTop: 8 }}>{feature.warning}</div>
                </div>
              );
            })}
            {proxyFeatures.length === 0 && (
              <div className="notice">
                <span className="helper">No high-confidence proxy features were detected for this dataset.</span>
              </div>
            )}
          </div>
          {proxyExplain && proxyFeatures.length > 0 && <ExplainThis payload={proxyExplain} />}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <button className="btn" onClick={() => navigate('/workflow/step-2')}>
          <ArrowLeft size={16} /> Back
        </button>
        <button className="btn btn-primary" onClick={async () => {
          await advanceStep(4);
          navigate('/workflow/step-4');
        }}>
          Next: Analyze Model Bias <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
