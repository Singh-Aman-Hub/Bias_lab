import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { ArrowRight, ArrowLeft, AlertTriangle, Shield, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import ExplainThis from '../../components/ExplainThis';
import ChatHelpButton from '../../components/ChatHelpButton';
import { buildExplainItems } from '../../utils/explainItems';
import type { ExplanationPattern } from '../../types';

// ── Compact sensitive group display ───────────────────────────────────────────
function SensitiveGroupDisplay({ rawGroup }: { rawGroup: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!rawGroup) return null;

  const groups = rawGroup.split(' + ').map(g => g.trim()).filter(Boolean);
  const unique = Array.from(new Set(groups));

  if (unique.length === 0) return null;

  // Detect axis names for summary label
  const axes = new Set<string>();
  unique.forEach(g => {
    const parts = g.split(/\s+/);
    if (parts.length >= 2) axes.add(parts[0]);
  });
  const axisLabel = axes.size >= 2 ? Array.from(axes).join(' × ') : axes.size === 1 ? Array.from(axes)[0] : 'Subgroups';
  const summaryLabel = unique.length > 3 ? `Multiple ${axisLabel} groups` : null;

  const shown = expanded ? unique : unique.slice(0, 3);
  const remaining = unique.length - 3;

  return (
    <div style={{ fontSize: '0.85rem', marginTop: 8 }}>
      <span className="helper">Sensitive groups: </span>
      {summaryLabel && !expanded && (
        <strong style={{ color: 'var(--text-primary)', marginRight: 8 }}>{summaryLabel}</strong>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {shown.map((g, i) => (
          <span key={i} className="pill" style={{ fontSize: '0.75rem', backgroundColor: 'var(--bg-tertiary)' }}>{g}</span>
        ))}
        {!expanded && remaining > 0 && (
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 8px', fontSize: '0.75rem' }}
            onClick={() => setExpanded(true)}
          >
            +{remaining} more <ChevronDown size={12} />
          </button>
        )}
        {expanded && unique.length > 3 && (
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 8px', fontSize: '0.75rem' }}
            onClick={() => setExpanded(false)}
          >
            Show less <ChevronUp size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// Helper: turn a raw group string into a readable summary phrase
function groupSummaryPhrase(rawGroup: string): string {
  if (!rawGroup) return '';
  const groups = rawGroup.split(' + ').map(g => g.trim()).filter(Boolean);
  const unique = Array.from(new Set(groups));
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  const axes = new Set<string>();
  unique.forEach(g => { const p = g.split(/\s+/); if (p.length >= 2) axes.add(p[0]); });
  return axes.size >= 2 ? `multiple ${Array.from(axes).join(' × ')} groups` : `multiple ${Array.from(axes)[0] || ''} groups`;
}

// ── Compact SHAP bar for a pattern driver ─────────────────────────
function ShapBar({ feature, avgShap, direction }: { feature: string; avgShap: number; direction: string }) {
  const pct = Math.min(Math.abs(avgShap) * 100, 100);
  const isPositive = avgShap >= 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 3 }}>
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{feature}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: isPositive ? 'var(--green)' : 'var(--red)' }}>
          {isPositive ? '+' : ''}{avgShap.toFixed(3)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="progress-track" style={{ flex: 1, height: 6 }}>
          <div
            className="progress-fill"
            style={{
              width: `${pct}%`,
              background: isPositive
                ? 'linear-gradient(90deg, #35C98A, #6debb5)'
                : 'linear-gradient(90deg, #F0565B, #e77b7d)',
            }}
          />
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', minWidth: 95, textAlign: 'right' }}>
          {direction}
        </span>
      </div>
    </div>
  );
}

// ── Single pattern card ────────────────────────────────────────────────────
function PatternCard({
  pattern,
  explainItem,
}: {
  pattern: ExplanationPattern;
  explainItem: ReturnType<typeof buildExplainItems>[number] | undefined;
}) {
  const [isRecordsOpen, setIsRecordsOpen] = useState(false);

  const confidenceColor = 
    pattern.confidence === 'high' ? 'var(--green)' :
    pattern.confidence === 'moderate' ? 'var(--yellow)' : 'var(--text-secondary)';

  const riskColor = 
    pattern.risk_level === 'high' ? 'var(--red)' :
    pattern.risk_level === 'medium' ? 'var(--yellow)' : 'var(--green)';

  const explanationText = useMemo(() => {
    const evidenceText = pattern.confidence === 'high' 
      ? 'The statistical evidence for this pattern is strong, as it affects multiple records.'
      : pattern.confidence === 'moderate'
      ? 'The statistical evidence is moderate, affecting a small cluster of records.'
      : 'The statistical evidence is limited, as this is an individual high-risk case.';

    const proxyText = pattern.proxy_involved
      ? `This pattern involves a proxy risk: the primary feature '${pattern.top_drivers[0]?.feature}' correlates with sensitive attributes and may be acting as an indirect signal.`
      : 'No high-confidence proxy feature was detected in this specific group.';

    const groupPhrase = groupSummaryPhrase(pattern.sensitive_group);
    const groupSentence = groupPhrase ? `This pattern spans ${groupPhrase}.` : '';
    return `This pattern contains ${pattern.affected_record_count} decision${pattern.affected_record_count !== 1 ? 's' : ''} where the model relied heavily on ${pattern.top_drivers.map(d => d.feature).join(', ')}. ${proxyText} ${groupSentence} This should be reviewed because it represents a recurring model bias risk. ${evidenceText}`;
  }, [pattern]);

  return (
    <div
      className="card"
      style={{
        padding: '24px',
        borderLeft: pattern.proxy_involved ? '3px solid var(--warning)' : '3px solid var(--accent)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle background tint for proxy patterns */}
      {pattern.proxy_involved && (
        <div
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
            background: 'rgba(240, 86, 91, 0.03)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Header row */}
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          marginBottom: 16, borderBottom: '0.5px solid var(--border)', paddingBottom: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--accent)', border: '0.5px solid var(--accent)', padding: '2px 6px', borderRadius: 4 }}>
              {pattern.pattern_id}
            </span>
            <span style={{ fontWeight: 700, fontSize: '1.15rem' }}>{pattern.title}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <span className="pill muted">
              <strong>{pattern.affected_record_count}</strong> record{pattern.affected_record_count !== 1 ? 's' : ''}
            </span>
            <span className="pill" style={{ textTransform: 'capitalize' }}>
              Outcome: <strong>{pattern.decision_type}</strong>
            </span>
            <span className="pill" style={{ textTransform: 'capitalize' }}>
              Risk: <strong style={{ color: riskColor }}>{pattern.risk_level}</strong>
            </span>
            <span className="pill" style={{ textTransform: 'capitalize' }}>
              Confidence: <strong style={{ color: confidenceColor }}>{pattern.confidence}</strong>
            </span>
            {pattern.proxy_involved && (
              <span className="pill red" style={{ fontSize: '0.75rem' }}>Proxy Risk</span>
            )}
          </div>
          {pattern.sensitive_group && (
            <SensitiveGroupDisplay rawGroup={pattern.sensitive_group} />
          )}
        </div>
        <ChatHelpButton
          section={`Pattern: ${pattern.title}`}
          description={`Recurring decision pattern where ${pattern.top_drivers[0]?.feature} is the top driver across ${pattern.affected_record_count} records.`}
        />
      </div>

      <div className="grid-2" style={{ gap: 24 }}>
        {/* Left Column: SHAP feature drivers */}
        <div style={{ borderRight: '0.5px solid var(--border)', paddingRight: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Representative feature drivers (SHAP)
          </div>
          <div className="helper" style={{ marginBottom: 16, fontSize: '0.8rem' }}>
            Averaged SHAP feature influences for records matching this decision pattern.
          </div>
          {pattern.top_drivers.map((d) => (
            <ShapBar key={d.feature} feature={d.feature} avgShap={d.avg_shap} direction={d.direction} />
          ))}
        </div>

        {/* Right Column: Why this pattern may matter */}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9rem', color: 'var(--accent)' }}>
            Why this pattern may matter
          </div>
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              border: '0.5px solid var(--border)',
              padding: 14, borderRadius: 8, marginBottom: 12,
              fontSize: '0.9rem', lineHeight: 1.55, color: 'var(--text-primary)',
            }}
          >
            {explanationText}
          </div>

          {explainItem && <ExplainThis payload={explainItem} />}
        </div>
      </div>

      {/* Expandable representative records */}
      <div style={{ marginTop: 16, borderTop: '0.5px solid var(--border)', paddingTop: 16 }}>
        <button
          className="btn btn-secondary btn-small"
          onClick={() => setIsRecordsOpen((prev) => !prev)}
        >
          {isRecordsOpen ? 'Hide representative records' : 'View representative records'}
        </button>

        {isRecordsOpen && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Representative Records (Showing {pattern.representative_records.length} of {pattern.affected_record_count})
            </div>
            {pattern.representative_records.map((rec) => (
              <div key={rec.record_id} className="card-inset" style={{ padding: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: '0.85rem' }}>
                  <div>
                    <strong>Record ID:</strong> <span style={{ fontFamily: 'var(--font-mono)' }}>{rec.record_id}</span>
                  </div>
                  <div>
                    <strong>Model Prediction:</strong> <span style={{ color: rec.prediction === 'approved' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{rec.prediction}</span>
                  </div>
                  <div>
                    <strong>Actual Outcome:</strong> <span>{rec.actual ?? 'N/A'}</span>
                  </div>
                  <div>
                    <strong>Model Score:</strong> <span style={{ fontFamily: 'var(--font-mono)' }}>{(rec.score * 100).toFixed(1)}%</span>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <strong>Sensitive Group:</strong> <span>{rec.sensitive_group}</span>
                  </div>
                  {rec.counterfactual_sensitive !== undefined && (
                    <div style={{ gridColumn: 'span 2' }}>
                      <strong>Counterfactual Flip Status:</strong>{' '}
                      <span className={`pill ${rec.counterfactual_sensitive ? 'red' : 'green'}`} style={{ fontSize: '0.72rem' }}>
                        {rec.counterfactual_sensitive ? '⚠ Prediction flips if sensitive attributes change' : '✓ Prediction stays stable'}
                      </span>
                    </div>
                  )}
                </div>
                
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Top Feature Influences (SHAP)</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {rec.top_shap.map((ts) => (
                      <span key={ts.feature} className="pill" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                        {ts.feature}: <span style={{ color: ts.value >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{ts.value >= 0 ? '+' : ''}{ts.value.toFixed(3)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Step5Explanations() {
  const { pipelineResults, explainResult, explainSummary, domain, advanceStep } = useAppContext();
  const navigate = useNavigate();

  const patterns = useMemo(
    () => (pipelineResults?.explanation_patterns ?? []) as ExplanationPattern[],
    [pipelineResults]
  );

  const explainItems = useMemo(
    () => buildExplainItems(pipelineResults, domain),
    [pipelineResults, domain]
  );

  const explainSummaryItem = useMemo(
    () => explainItems.find((i) => i.metric === 'explanations_summary'),
    [explainItems]
  );

  const noData = !pipelineResults || (!explainResult?.length && !patterns.length);

  // Dynamic pattern-level manager summary fallback
  const managerSummaryText = useMemo(() => {
    if (explainSummary) return explainSummary;
    if (patterns.length === 0) {
      return "No recurring high-risk decision patterns were detected. The model explanations are shown as individual cases only.";
    }
    const totalFlagged = explainResult?.length ?? 0;
    const firstPattern = patterns[0];
    const proxyCount = patterns.filter(p => p.proxy_involved).length;
    const proxyComment = proxyCount > 0 
      ? `We detected ${proxyCount} proxy-risk pattern(s), suggesting potential indirect bias.`
      : "No high-confidence proxy feature was detected, but repeated dominance of the same feature should be reviewed.";

    if (patterns.length === 1) {
      return `We reviewed ${totalFlagged} flagged decisions and found 1 recurring pattern. The limited number of flagged records suggests weak evidence for broad unfairness, but the pattern is still shown for review.`;
    }

    return `We reviewed ${totalFlagged} flagged decisions and grouped them into ${patterns.length} recurring decision patterns. The strongest pattern was ${firstPattern.title}, affecting ${firstPattern.affected_record_count} records. ${proxyComment}`;
  }, [patterns, explainResult, explainSummary]);

  if (noData) {
    return (
      <div>
        <div className="page-header">
          <div>
            <div className="kicker">Step 5 of 9</div>
            <h1 className="page-title">Explanations</h1>
          </div>
        </div>
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <p className="helper" style={{ marginBottom: 8 }}>
            {pipelineResults
              ? 'No flagged decisions were found for explanation.'
              : 'No analysis data yet. Please run the analysis first.'}
          </p>
          {!pipelineResults && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/workflow/step-2')}>
              Go to Configuration <ArrowRight size={16} />
            </button>
          )}
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 16 }}>
            <button className="btn" onClick={() => navigate('/workflow/step-4')}>
              <ArrowLeft size={16} /> Back
            </button>
            <button className="btn btn-primary" onClick={async () => { await advanceStep(6); navigate('/workflow/step-6'); }}>
              Next: Run Counterfactuals <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalFlagged = explainResult?.length ?? 0;
  const proxyPatterns = patterns.filter((p) => p.proxy_involved).length;
  const uniqueDrivers = new Set(patterns.map((p) => p.top_drivers?.[0]?.feature).filter(Boolean)).size;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="kicker">Step 5 of 9</div>
          <h1 className="page-title">Explanations</h1>
          <p className="page-subtitle">
            Recurring decision patterns grouped by primary feature drivers — understand <em>why</em> the
            model decided, and where bias risk may be concentrated.
          </p>
        </div>
      </div>

      {/* Disclaimer banner */}
      <div style={{
        backgroundColor: 'rgba(240, 86, 91, 0.1)',
        border: '0.5px solid rgba(240, 86, 91, 0.5)',
        borderRadius: 8, padding: 16, marginBottom: 24,
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <AlertTriangle color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} size={20} />
        <div>
          <div style={{ fontWeight: 600, color: 'var(--warning)', marginBottom: 4 }}>Model explanations do not imply fairness</div>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            SHAP explains which features influenced the model. Fairness analysis determines whether those influences create group-level harm. Proxy features marked ⚠ warrant particular attention.
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Flagged Records', value: totalFlagged, icon: <AlertTriangle size={16} /> },
          { label: 'Decision Patterns', value: patterns.length, icon: <Activity size={16} /> },
          { label: 'Proxy-Risk Patterns', value: proxyPatterns, icon: <Shield size={16} style={{ color: proxyPatterns > 0 ? 'var(--warning)' : 'inherit' }} /> },
          { label: 'Unique Top Drivers', value: uniqueDrivers, icon: <Activity size={16} /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ color: 'var(--accent)' }}>{icon}</div>
            <div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{value}</div>
              <div className="helper" style={{ margin: 0, fontSize: '0.8rem' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Manager summary card */}
      <div className="card card-primary" style={{ marginBottom: 20 }}>
        <div className="section-title" style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span>Manager Summary</span>
          <ChatHelpButton
            section="SHAP Explanation Summary"
            description="A plain-English summary of why the model made its decisions, based on SHAP feature importance values."
          />
        </div>
        <p style={{ fontSize: '1.05rem', lineHeight: 1.55, margin: '8px 0 0' }}>{managerSummaryText}</p>
        {explainSummaryItem && <ExplainThis payload={explainSummaryItem} />}
      </div>

      {/* Pattern cards */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-title">
            Decision Patterns ({patterns.length})
          </div>
          <ChatHelpButton
            section="Decision Patterns"
            description="Flagged records grouped by their primary SHAP feature driver. Each card represents a recurring pattern — the same feature consistently pushing decisions in one direction."
          />
        </div>
        <div className="helper" style={{ marginBottom: 16 }}>
          Records with similar feature drivers are grouped into patterns. Each card shows the averaged SHAP breakdown and an explanation of the potential fairness risk, with detailed cases available below.
        </div>

        {patterns.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {patterns.map((pattern) => {
              const metricKey = `pattern_${pattern.pattern_id}`;
              const item = explainItems.find((i) => i.metric === metricKey);
              return (
                <PatternCard
                  key={pattern.pattern_id}
                  pattern={pattern}
                  explainItem={item}
                />
              );
            })}
          </div>
        ) : (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <p className="helper">No recurring patterns detected. All flagged decisions appear to have distinct drivers.</p>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <button className="btn" onClick={() => navigate('/workflow/step-4')}>
          <ArrowLeft size={16} /> Back
        </button>
        <button className="btn btn-primary" onClick={async () => { await advanceStep(6); navigate('/workflow/step-6'); }}>
          Next: Run Counterfactuals <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
