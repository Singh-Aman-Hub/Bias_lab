import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import CounterfactualFlip from '../../components/CounterfactualFlip';
import ScoreGauge from '../../components/ScoreGauge';
import Toast, { useToast, errMsg } from '../../components/Toast';
import ExplainThis from '../../components/ExplainThis';
import ChatHelpButton from '../../components/ChatHelpButton';
import { useAppContext } from '../../context/AppContext';
import { api } from '../../api/client';
import { buildExplainItems } from '../../utils/explainItems';
import {
  ArrowRight, ArrowLeft, AlertTriangle, AlertCircle,
  Info, ChevronDown, ChevronUp, Loader
} from 'lucide-react';
import type { CounterfactualResult, CFBreakdownEntry } from '../../types';

// ── Risk badge ────────────────────────────────────────────────────────────
function RiskBadge({ level }: { level?: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    high:    { label: 'HIGH RISK',   color: '#f87171', bg: 'rgba(240,86,91,0.12)' },
    medium:  { label: 'MEDIUM RISK', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    low:     { label: 'LOW RISK',    color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
    unknown: { label: 'UNKNOWN',     color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' },
  };
  const s = map[level ?? 'unknown'] ?? map.unknown;
  return (
    <span style={{
      fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em',
      padding: '3px 10px', borderRadius: 20,
      color: s.color, background: s.bg, border: `1px solid ${s.color}44`,
    }}>
      {s.label}
    </span>
  );
}

// ── LLM text strip ────────────────────────────────────────────────────────
function CFExplainStrip({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '8px 0 0' }}>
      {text}
    </p>
  );
}

// ── Single breakdown row card ─────────────────────────────────────────────
function BreakdownRow({ entry }: { entry: CFBreakdownEntry & { adjacent?: boolean } }) {
  const pct = (entry.flip_rate * 100).toFixed(1);
  const barColor =
    entry.flip_rate >= 0.10 ? '#f87171'
    : entry.flip_rate >= 0.03 ? '#f59e0b'
    : '#34d399';

  return (
    <div
      className="notice"
      style={entry.flips === 0 ? { opacity: 0.55 } : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong style={{ fontSize: '0.85rem' }}>
          {entry.from_group} → {entry.to_group}
        </strong>
        {entry.flips > 0 && (
          <span style={{
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
            padding: '2px 7px', borderRadius: 12,
            color: barColor, background: `${barColor}1a`, border: `1px solid ${barColor}44`,
          }}>
            {pct}%
          </span>
        )}
      </div>
      <div className="progress-track" style={{ margin: '6px 0' }}>
        <div
          className="progress-fill"
          style={{ width: `${Math.max(entry.flip_rate * 100, entry.flips > 0 ? 2 : 0)}%`, background: barColor }}
        />
      </div>
      <div className="helper" style={{ fontSize: '0.78rem' }}>
        {entry.flips === 0
          ? `No flips · ${entry.tested} tested`
          : `${entry.flips} flip${entry.flips !== 1 ? 's' : ''} / ${entry.tested} tested · Rate ${pct}%`}
      </div>
    </div>
  );
}

export default function Step6Counterfactual() {
  const {
    pipelineResults,
    sensitiveCols,
    counterfactualResult,
    projectId,
    domain,
    advanceStep,
    getExplanation,
  } = useAppContext();

  const [sensitiveCol, setSensitiveCol] = useState(sensitiveCols[0] || 'gender');
  const [showAllPairs, setShowAllPairs] = useState(false);
  const { toast, showToast, clear } = useToast();
  const navigate = useNavigate();
  const [isNavigating, setIsNavigating] = useState(false);

  // ── Derive result ─────────────────────────────────────────────────────────
  const cfResult: CounterfactualResult | null =
    pipelineResults?.counterfactual_by_attribute?.[sensitiveCol] ??
    counterfactualResult ??
    null;

  // ── LLM cache ─────────────────────────────────────────────────────────────
  const flipRateExplain = useMemo(
    () => buildExplainItems(pipelineResults, domain).find((i) => i.metric === 'counterfactual_flip_rate'),
    [pipelineResults, domain]
  );
  const pageExplain = getExplanation('counterfactual_page') as Record<string, string> | undefined;

  // ── No data guard ─────────────────────────────────────────────────────────
  if (!pipelineResults || !counterfactualResult) {
    return (
      <div>
        <div className="page-header">
          <div>
            <div className="kicker">Step 6 of 9</div>
            <h1 className="page-title">Counterfactual Testing</h1>
          </div>
        </div>
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <p className="helper" style={{ marginBottom: 24 }}>No analysis data yet. Please run the analysis first.</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
            <button className="btn" onClick={() => navigate('/workflow/step-5')}><ArrowLeft size={16} /> Back</button>
            <button className="btn btn-primary" onClick={() => navigate('/workflow/step-2')}>
              Go to Configuration <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Missing attribute guard ───────────────────────────────────────────────
  if (!cfResult) {
    return (
      <div>
        <div className="page-header"><div>
          <div className="kicker">Step 6 of 9</div>
          <h1 className="page-title">Counterfactual Testing</h1>
        </div></div>
        <div className="card" style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: 'var(--amber)' }}>
            <AlertCircle size={18} />
            <strong>No counterfactual result found for "{sensitiveCol}"</strong>
          </div>
          <p className="helper">No counterfactual result is available for this attribute. Please re-run the audit or select another sensitive attribute.</p>
          <select className="select" value={sensitiveCol} onChange={(e) => setSensitiveCol(e.target.value)} style={{ width: 220, marginTop: 16 }}>
            {sensitiveCols.map((col) => <option key={col} value={col}>{col}</option>)}
          </select>
        </div>
      </div>
    );
  }

  // ── Extract values ────────────────────────────────────────────────────────
  const {
    flip_rate,
    counterfactual_fairness_score,
    interpretation,
    sample_flips = [],
    attribute_tested,
    was_binned,
    binning_strategy,
    total_records_tested = 0,
    total_flips = 0,
    risk_level,
    warnings = [],
    breakdown = [],
  } = cfResult;

  const attributeMismatch = attribute_tested && attribute_tested !== sensitiveCol;

  // ── Breakdown split: adjacent first, then non-zero non-adjacent, then zero non-adjacent ──
  type BreakdownRowWithAdj = CFBreakdownEntry & { adjacent?: boolean };
  const allRows = breakdown as BreakdownRowWithAdj[];

  const adjacentRows = allRows.filter((r) => r.adjacent);
  const nonAdjacentNonZero = allRows.filter((r) => !r.adjacent && r.flips > 0);
  const nonAdjacentZero = allRows.filter((r) => !r.adjacent && r.flips === 0);

  // Main section: adjacent + any non-adjacent with non-zero flips (up to 3)
  const mainRows: BreakdownRowWithAdj[] = [
    ...adjacentRows,
    ...nonAdjacentNonZero.slice(0, 3),
  ];
  const allPairsRows: BreakdownRowWithAdj[] = [
    ...adjacentRows,
    ...nonAdjacentNonZero,
    ...nonAdjacentZero,
  ];

  const allZero = total_flips === 0 && total_records_tested > 0;
  const firstSampleFlip = total_flips > 0 && sample_flips.length > 0 ? sample_flips[0] : undefined;

  // ── Chat context builder ──────────────────────────────────────────────────
  const cfChatContext = (cardId: string, cardTitle: string, extraExplanation?: string) => ({
    module: 'Counterfactual Testing',
    page: 'Step 6',
    card_id: cardId,
    card_title: cardTitle,
    attribute_tested: attribute_tested ?? sensitiveCol,
    was_binned,
    binning_strategy,
    metrics: { total_records_tested, total_flips, flip_rate, fairness_score: counterfactual_fairness_score, risk_level },
    explanation: extraExplanation,
    warnings,
    suggested_questions: [
      'Why is the flip rate important?',
      'Does 0% flip rate prove the model is fair?',
      'How should I interpret this result?',
      'What should I check next?',
    ],
  });

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="kicker">Step 6 of 9</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Counterfactual Testing</h1>
            {pipelineResults?.sensitive_policy && (
              <span style={{
                fontSize: '0.72rem', fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                background: pipelineResults.sensitive_policy === 'attribute-aware' ? 'rgba(52,211,153,0.15)' : 'rgba(245,158,11,0.15)',
                color: pipelineResults.sensitive_policy === 'attribute-aware' ? '#10b981' : '#f59e0b',
                border: `1px solid ${pipelineResults.sensitive_policy === 'attribute-aware' ? 'rgba(52,211,153,0.3)' : 'rgba(245,158,11,0.3)'}`,
              }}>
                Model policy: {pipelineResults.sensitive_policy === 'attribute-aware' ? 'Attribute-aware audit model' : 'Attribute-blind production simulation'}
              </span>
            )}
          </div>
          <p className="helper" style={{ marginTop: 8 }}>
            Analyze if individual predictions flip when only the sensitive attribute is changed.
            This verifies the model isn't using the sensitive attribute as a direct decision driver.
          </p>
        </div>
        <ChatHelpButton
          section="Counterfactual Testing — Page Overview"
          description={pageExplain?.page_summary}
          extraContext={cfChatContext('page_summary', 'Counterfactual Testing Overview', pageExplain?.page_summary)}
        />
      </div>

      {pipelineResults?.sensitive_policy === 'attribute-blind' && (
        <div className="card" style={{ marginBottom: 20, padding: '12px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 4 }}>
            <AlertTriangle size={16} /> Attribute-blind mode
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            This model was trained without the selected sensitive attribute. Direct counterfactual flips may not change predictions. Use proxy analysis and group metrics to inspect indirect bias.
          </div>
        </div>
      )}


      {/* ── LLM page summary ─────────────────────────────────────────── */}
      {pageExplain?.page_summary && (
        <div className="card" style={{ marginBottom: 20, padding: '12px 16px', background: 'rgba(52,214,196,0.04)', border: '1px solid rgba(52,214,196,0.15)' }}>
          <CFExplainStrip text={pageExplain.page_summary} />
        </div>
      )}

      {/* ── Attribute selector ───────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="section-title">Select Attribute for Counterfactual Test</div>
            <div className="helper">Which attribute should we "flip" to test model robustness?</div>
          </div>
          <select className="select" value={sensitiveCol} onChange={(e) => setSensitiveCol(e.target.value)} style={{ width: 200 }}>
            {sensitiveCols.map((col) => <option key={col} value={col}>{col}</option>)}
          </select>
        </div>
        {attribute_tested && (
          <div style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Backend-confirmed: <strong style={{ color: 'var(--text-primary)' }}>{attribute_tested}</strong>
            {was_binned && (
              <span style={{ marginLeft: 8 }}>
                · Tested using <strong>{binning_strategy === 'age_bands' ? 'age group bands' : 'equal-width bins'}</strong>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Mismatch warning ─────────────────────────────────────────── */}
      {attributeMismatch && (
        <div className="card" style={{ marginBottom: 20, padding: '10px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', gap: 10, color: '#f59e0b', fontSize: '0.85rem' }}>
          <AlertTriangle size={16} />
          Displayed result is for <strong style={{ margin: '0 4px' }}>{attribute_tested}</strong>, but
          <strong style={{ margin: '0 4px' }}>{sensitiveCol}</strong> is selected. Please re-run or refresh.
        </div>
      )}

      {/* ── Backend warnings ──────────────────────────────────────────── */}
      {warnings.length > 0 && (
        <div className="card" style={{ marginBottom: 20, padding: '12px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b', fontWeight: 600 }}>
              <AlertTriangle size={15} /> Warnings
            </div>
            <ChatHelpButton section="Counterfactual Warnings" extraContext={cfChatContext('warnings', 'Counterfactual Warnings', pageExplain?.warnings_explanation)} />
          </div>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 4 }}>• {w}</div>
          ))}
          <CFExplainStrip text={pageExplain?.warnings_explanation} />
        </div>
      )}

      {/* ── Metric cards ─────────────────────────────────────────────── */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        {/* Flip rate card */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="section-title">Decision Flip Rate</div>
            <ChatHelpButton
              section="Counterfactual Flip Rate"
              description="The percentage of decisions that change when only the sensitive attribute band is changed."
              extraContext={cfChatContext('flip_rate_card', 'Decision Flip Rate', pageExplain?.flip_rate_card_explanation)}
            />
          </div>
          <div className="stat-number">{(flip_rate * 100).toFixed(1)}%</div>
          <div className="helper" style={{ marginBottom: 10 }}>
            of decisions flip when changing {attribute_tested ?? sensitiveCol}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <RiskBadge level={risk_level} />
            <span className="helper" style={{ fontSize: '0.78rem' }}>
              {total_flips} flip{total_flips !== 1 ? 's' : ''} / {total_records_tested} tested
            </span>
          </div>

          {/* 0% caution block */}
          {allZero && (
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: 8,
              background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)',
              fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55,
            }}>
              <strong style={{ color: '#f59e0b', display: 'block', marginBottom: 4 }}>
                ⚠ Interpret with caution
              </strong>
              A 0% flip rate means this test did not observe prediction changes after changing{' '}
              {attribute_tested ?? sensitiveCol} bands. This does not prove the model is unbiased —
              it only means the counterfactual test did not detect direct decision sensitivity to{' '}
              {attribute_tested ?? sensitiveCol}. The model may still be influenced by correlated
              proxy features.
            </div>
          )}

          <CFExplainStrip text={pageExplain?.flip_rate_card_explanation} />
          {flipRateExplain && <ExplainThis payload={flipRateExplain} />}
        </div>

        {/* Fairness score gauge */}
        <div className="card" style={{ display: 'grid', placeItems: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
            <div className="section-title" style={{ fontSize: '0.85rem' }}>Counterfactual Fairness</div>
            <ChatHelpButton
              section="Counterfactual Fairness Score"
              extraContext={cfChatContext('fairness_score_card', 'Counterfactual Fairness Score', pageExplain?.fairness_score_card_explanation)}
            />
          </div>
          <ScoreGauge score={counterfactual_fairness_score ?? Math.round(100 - flip_rate * 100)} />
          <div className="helper" style={{ marginTop: 8 }}>Counterfactual Fairness Score</div>
          <CFExplainStrip text={pageExplain?.fairness_score_card_explanation} />
        </div>
      </div>

      {/* ── Decision Flip Example ────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="section-title">Decision Flip Example</div>
          <ChatHelpButton
            section="Counterfactual Decision Flip Example"
            extraContext={cfChatContext('sample_flip_card', 'Decision Flip Example', pageExplain?.sample_flip_explanation)}
          />
        </div>
        <CounterfactualFlip
          sampleFlip={firstSampleFlip ?? null}
          totalFlips={total_flips}
          totalRecordsTested={total_records_tested}
          attributeTested={attribute_tested ?? sensitiveCol}
        />
        {interpretation && <p className="helper" style={{ marginTop: 12 }}>{interpretation}</p>}
        <CFExplainStrip text={pageExplain?.sample_flip_explanation} />
      </div>

      {/* ── Breakdown ────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div>
            <div className="section-title">Attribute Group Flip Breakdown</div>
            <div className="helper" style={{ marginTop: 4 }}>
              {was_binned
                ? 'Adjacent age-band transitions shown first. High-risk non-adjacent transitions included below.'
                : 'Group transitions sorted by flip rate.'}
            </div>
          </div>
          <ChatHelpButton
            section="Counterfactual Flip Breakdown"
            description="Shows how many records flip when the sensitive attribute group is changed."
            extraContext={cfChatContext('breakdown', 'Attribute Group Flip Breakdown', pageExplain?.attribute_flip_breakdown_explanation)}
          />
        </div>

        <CFExplainStrip text={pageExplain?.attribute_flip_breakdown_explanation} />

        {allRows.length === 0 ? (
          <div className="helper" style={{ marginTop: 12 }}>No group-level breakdown available for this attribute.</div>
        ) : allZero ? (
          <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 8, background: 'rgba(100,116,139,0.07)', border: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <Info size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            No age-band transition caused a decision flip in this audit. All {total_records_tested} tested records
            returned the same prediction regardless of which age band was applied.
          </div>
        ) : (
          <div className="grid-2" style={{ marginTop: 12 }}>
            {mainRows.map((entry, i) => (
              <BreakdownRow key={i} entry={entry} />
            ))}
          </div>
        )}

        {/* Expandable: all pairwise tests */}
        {allPairsRows.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '0.8rem', padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => setShowAllPairs((v) => !v)}
            >
              {showAllPairs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showAllPairs ? 'Hide' : 'View'} all pairwise tests ({allPairsRows.length})
            </button>

            {showAllPairs && (
              <div style={{ marginTop: 12 }}>
                <div className="helper" style={{ marginBottom: 8, fontSize: '0.78rem' }}>
                  All group-pair comparisons including zero-flip results. Dimmed rows had no flips.
                </div>
                <div className="grid-2">
                  {allPairsRows.map((entry, i) => (
                    <BreakdownRow key={i} entry={entry} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Individual record flips ───────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="section-title" style={{ marginBottom: 12 }}>Individual Record Flips</div>
        {sample_flips.length === 0 || total_flips === 0 ? (
          <div className="helper" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Info size={14} />
            No individual flips identified for the current attribute selection.
            {total_records_tested > 0 && ` (${total_records_tested} records tested)`}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  {['Record ID', 'Group Change', 'Original', 'After Flip', 'Action'].map((h) => (
                    <th key={h} style={{ padding: '12px 8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample_flips.map((flip, i) => {
                  const origDecision = flip.original_prediction ?? flip.original_decision;
                  const flipDecision = flip.flipped_prediction ?? flip.flipped_decision;
                  const isFlipped = origDecision !== flipDecision;
                  return (
                    <tr key={i} style={{ borderBottom: '0.5px solid var(--border)', backgroundColor: isFlipped ? 'rgba(240,86,91,0.08)' : 'transparent' }}>
                      <td style={{ padding: '12px 8px', fontWeight: 500 }}>#{flip.record_id}</td>
                      <td style={{ padding: '12px 8px' }}><em>{flip.original_value}</em> → <em>{flip.flipped_value}</em></td>
                      <td style={{ padding: '12px 8px' }}><span className="pill muted" style={{ textTransform: 'uppercase' }}>{origDecision}</span></td>
                      <td style={{ padding: '12px 8px' }}><span className={`pill ${isFlipped ? 'red' : 'muted'}`} style={{ textTransform: 'uppercase' }}>{flipDecision}</span></td>
                      <td style={{ padding: '12px 8px' }}>
                        <button className="btn btn-small" onClick={async () => {
                          const reason = window.prompt('Enter reason for flagging this decision:');
                          if (!reason) return;
                          if (!projectId) { showToast('Select a project before flagging.', 'error'); return; }
                          try {
                            await api.post('/monitoring/flag', { project_id: parseInt(projectId), record_id: String(flip.record_id), reason });
                            showToast(`Record #${flip.record_id} flagged for review.`, 'success');
                          } catch (err) {
                            showToast(errMsg(err, 'Could not flag this decision.'), 'error');
                          }
                        }}>🚩 Flag</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Recommended next steps ───────────────────────────────────── */}
      {pageExplain?.recommended_next_steps && (
        <div className="card" style={{ marginBottom: 24, padding: '14px 16px', background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)' }}>
          <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: 6, color: '#818cf8' }}>Recommended Next Steps</div>
          <CFExplainStrip text={pageExplain.recommended_next_steps} />
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
        <button className="btn btn-secondary" onClick={() => navigate('/workflow/step-5')}><ArrowLeft size={16} /> Back</button>
        <button className="btn btn-primary" onClick={async () => { 
          setIsNavigating(true);
          try {
            await advanceStep(7); navigate('/workflow/step-7'); 
          } finally {
            setIsNavigating(false);
          }
        }} disabled={isNavigating}>
          {isNavigating && <Loader size={16} style={{ animation: 'spin 1.2s linear infinite' }} />}
          Continue to Stress Test
          {!isNavigating && <ArrowRight size={16} />}
        </button>
      </div>

      <Toast toast={toast} onClose={clear} />
    </div>
  );
}
