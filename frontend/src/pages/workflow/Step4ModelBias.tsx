import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FairnessTable from '../../components/FairnessTable';
import FairnessMetricsPanel from '../../components/FairnessMetricsPanel';
import HiddenBiasExplorer from '../../components/HiddenBiasExplorer';
import DisparityBar from '../../components/DisparityBar';
import ChatHelpButton from '../../components/ChatHelpButton';
import SensitiveAttrSummaryCard from '../../components/SensitiveAttrSummaryCard';
import { useAppContext } from '../../context/AppContext';
import { ArrowRight, ArrowLeft, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, RefreshCw, Loader } from 'lucide-react';
import { scoreColor } from '../../utils/score';
import { api } from '../../api/client';
import type { SensitiveAttrMeta } from '../../types';

type BinningStrategy = 'auto' | 'equal_width' | 'quantile';

const BINNING_OPTIONS: { value: BinningStrategy; label: string }[] = [
  { value: 'auto', label: 'Auto-bin' },
  { value: 'equal_width', label: 'Equal-width bins' },
  { value: 'quantile', label: 'Quantile bins' },
];

export default function Step4ModelBias() {
  const { pipelineResults, biasResult, counterfactualResult, advanceStep, taskId } = useAppContext();
  const navigate = useNavigate();

  const [binningStrategy, setBinningStrategy] = useState<BinningStrategy>('auto');
  const [isNavigating, setIsNavigating] = useState(false);
  const [regroupLoading, setRegroupLoading] = useState(false);
  const [regroupError, setRegroupError] = useState<string | null>(null);

  // Override group_performance and sensitive_attr_metadata with regroup results when available
  const [regroupData, setRegroupData] = useState<{
    group_performance: Record<string, Record<string, any>>;
    sensitive_attr_metadata: Record<string, SensitiveAttrMeta>;
    low_confidence_subgroups: any[];
  } | null>(null);

  const [showRawBreakdown, setShowRawBreakdown] = useState(false);

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

  // ── Derive active data (regroup override or original) ─────────────────────
  const activeGroupPerf = regroupData?.group_performance ?? biasResult.group_performance ?? {};
  const activeMetadata = regroupData?.sensitive_attr_metadata ?? biasResult.sensitive_attr_metadata ?? {};
  const activeLowConf = regroupData?.low_confidence_subgroups ?? biasResult.low_confidence_subgroups ?? [];

  const availableGroups = Object.keys(activeGroupPerf);
  const displayGroupKey = availableGroups.length > 0 ? availableGroups[0] : null;

  const fairnessScore = typeof biasResult.fairness_score === 'number'
    ? Math.round(biasResult.fairness_score)
    : Math.max(0, Math.round(100 - ((biasResult.metrics?.demographic_parity_difference || 0) * 100)));

  const overfit = biasResult.overfit;
  const showOverfit = overfit && overfit.gap != null && overfit.level !== 'unknown';
  const isOverfit = overfit?.level === 'mild' || overfit?.level === 'high';
  const overfitColor = overfit?.level === 'high' ? 'var(--red)' : overfit?.level === 'mild' ? 'var(--amber, #d99a2b)' : 'var(--accent)';
  const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

  // ── Derive display strings for the active sensitive column ────────────────
  const activeMeta: SensitiveAttrMeta | null = displayGroupKey ? activeMetadata[displayGroupKey] ?? null : null;
  const isContinuous = activeMeta?.column_type === 'continuous';

  const groupTitle = displayGroupKey
    ? `Group Performance: ${displayGroupKey}`
    : 'Group Performance';

  const groupSubtitle = activeMeta
    ? isContinuous
      ? `Grouped by ${displayGroupKey} ranges · ${activeMeta.grouping_method}`
      : `Grouped by category`
    : '';

  // ── Regroup handler ───────────────────────────────────────────────────────
  const handleRegroup = async (strategy: BinningStrategy) => {
    if (!taskId || !displayGroupKey) return;
    setRegroupLoading(true);
    setRegroupError(null);
    try {
      const res = await api.post('/bias/regroup', {
        task_id: taskId,
        sensitive_column: displayGroupKey,
        binning_strategy: strategy,
      });
      setRegroupData({
        group_performance: { [displayGroupKey]: res.data.group_performance[displayGroupKey] ?? {} },
        sensitive_attr_metadata: res.data.sensitive_attr_metadata ?? {},
        low_confidence_subgroups: res.data.low_confidence_subgroups ?? [],
      });
    } catch (e: any) {
      setRegroupError(e.response?.data?.detail ?? 'Regroup failed. Please try again.');
    } finally {
      setRegroupLoading(false);
    }
  };

  const onBinningChange = (strategy: BinningStrategy) => {
    setBinningStrategy(strategy);
    handleRegroup(strategy);
  };

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="kicker">Step 4 of 9</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Model Bias</h1>
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
          <p className="page-subtitle" style={{ marginTop: 8 }}>We evaluated the model across different groups to check for disparate impact.</p>
        </div>
      </div>

      {/* ── Fairness Score ─────────────────────────────────────────────────── */}
      <div className="card section-gap">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="stat-label">Fairness Score</div>
          <ChatHelpButton
            section="Model Fairness Score"
            description="The model's overall fairness score derived from demographic parity, equal opportunity, and other bias metrics."
            extraContext={{ fairness_score: fairnessScore, demographic_parity_gap: biasResult.metrics?.demographic_parity_difference, equal_opportunity_gap: biasResult.metrics?.equal_opportunity_difference }}
          />
        </div>
        <div className="stat-number text-8xl" style={{ color: scoreColor(fairnessScore) }}>
          {fairnessScore}
        </div>
      </div>

      {/* ── Overfit Warning ────────────────────────────────────────────────── */}
      {showOverfit && (
        <div
          className="card section-gap"
          style={{ borderLeft: `4px solid ${overfitColor}`, display: 'flex', gap: 14, alignItems: 'flex-start' }}
        >
          {isOverfit
            ? <AlertTriangle size={20} color={overfitColor} style={{ flexShrink: 0, marginTop: 2 }} />
            : <CheckCircle2 size={20} color={overfitColor} style={{ flexShrink: 0, marginTop: 2 }} />}
          <div style={{ flex: 1 }}>
            <div className="section-title" style={{ marginBottom: 4, color: overfitColor }}>
              {overfit?.level === 'high' ? 'Significant overfitting detected' : overfit?.level === 'mild' ? 'Mild overfitting detected' : 'Model generalizes well'}
            </div>
            <p className="helper" style={{ margin: 0 }}>
              {overfit?.warning ?? `Train ${fmtPct(overfit?.train_accuracy ?? null)} vs Test ${fmtPct(overfit?.test_accuracy ?? null)} (gap ${fmtPct(overfit?.gap ?? null)}). The model performs consistently on unseen data.`}
            </p>
            <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              <span>Train: <strong style={{ color: 'var(--text-primary)' }}>{fmtPct(overfit?.train_accuracy ?? null)}</strong></span>
              <span>Test: <strong style={{ color: 'var(--text-primary)' }}>{fmtPct(overfit?.test_accuracy ?? null)}</strong></span>
              <span>Gap: <strong style={{ color: overfitColor }}>{fmtPct(overfit?.gap ?? null)}</strong></span>
            </div>
          </div>
        </div>
      )}

      <FairnessMetricsPanel biasResult={biasResult} counterfactualResult={counterfactualResult} />

      {/* ── Low-confidence warning ─────────────────────────────────────────── */}
      {activeLowConf.length > 0 && (
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
              {activeLowConf.length} group(s) have fewer than {biasResult.min_subgroup_size ?? 30} samples. Rates for these groups are statistically noisy.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {activeLowConf.map((s: any) => (
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

      {/* ── Group Performance Section ──────────────────────────────────────── */}
      {displayGroupKey && (
        <div className="card" style={{ marginBottom: 16 }}>
          {/* Title row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 2 }}>{groupTitle}</div>
              {groupSubtitle && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{groupSubtitle}</div>
              )}
            </div>
            <ChatHelpButton
              section="Group Performance Table"
              description="Approval rate, TPR, FPR broken down by group for the primary sensitive attribute."
              extraContext={{ sensitive_column: displayGroupKey, column_type: activeMeta?.column_type }}
            />
          </div>

          {/* Sensitive attribute summary card */}
          {activeMeta && (
            <div style={{ marginTop: 14 }}>
              <SensitiveAttrSummaryCard colName={displayGroupKey} meta={activeMeta} />
            </div>
          )}

          {/* Contextual group performance explanation */}
          {activeMeta && (() => {
            const isCat = activeMeta.column_type === 'categorical';
            const numGroups = activeMeta.num_groups;
            const groupEntries = activeGroupPerf[displayGroupKey]
              ? Object.entries(activeGroupPerf[displayGroupKey])
              : [];
            const rates = groupEntries.map(([, m]) => m.approval_rate).filter(v => typeof v === 'number');
            const maxRate = rates.length ? Math.max(...rates) : null;
            const minRate = rates.length ? Math.min(...rates) : null;
            const gapPp = maxRate != null && minRate != null
              ? Math.abs((maxRate - minRate) * 100).toFixed(0)
              : null;
            const gapLabel = gapPp != null
              ? (Number(gapPp) <= 10 ? 'low disparity' : Number(gapPp) <= 20 ? 'moderate disparity' : 'high disparity')
              : null;

            return (
              <div style={{
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(129,140,248,0.06)',
                border: '1px solid rgba(129,140,248,0.18)',
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                marginBottom: 14,
              }}>
                {isCat
                  ? (
                      <>
                        <strong style={{ color: 'var(--text-primary)' }}>{displayGroupKey}</strong> was analysed
                        by category. <strong style={{ color: 'var(--text-primary)' }}>{numGroups} group{numGroups !== 1 ? 's' : ''}</strong> were
                        found with reliable sample sizes.
                        {gapPp != null && (
                          <> The approval-rate gap across groups is <strong style={{ color: 'var(--text-primary)' }}>{gapPp} percentage points</strong>, currently classified as <strong style={{ color: 'var(--text-primary)' }}>{gapLabel}</strong>.</>)}
                      </>
                    )
                  : (
                      <>
                        <strong style={{ color: 'var(--text-primary)' }}>{displayGroupKey}</strong> was detected
                        as a numeric (continuous) sensitive attribute and automatically grouped into ranges before
                        analysis. This prevents tiny exact-value groups from creating noisy fairness warnings.
                        Grouping method: <strong style={{ color: 'var(--text-primary)' }}>{activeMeta.grouping_method}</strong>.
                        {gapPp != null && (
                          <> Approval-rate gap across ranges: <strong style={{ color: 'var(--text-primary)' }}>{gapPp} percentage points</strong> ({gapLabel}).</>)}
                      </>
                    )
                }
              </div>
            );
          })()}

          {/* Binning strategy selector — only for continuous columns */}
          {activeMeta?.column_type === 'continuous' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Binning strategy:</span>
              {BINNING_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onBinningChange(opt.value)}
                  disabled={regroupLoading}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 20,
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: regroupLoading ? 'not-allowed' : 'pointer',
                    background: binningStrategy === opt.value ? 'rgba(129,140,248,0.15)' : 'transparent',
                    border: `1px solid ${binningStrategy === opt.value ? 'rgba(129,140,248,0.5)' : 'var(--border)'}`,
                    color: binningStrategy === opt.value ? '#818cf8' : 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
              {regroupLoading && (
                <RefreshCw size={14} color="var(--text-secondary)" style={{ animation: 'spin 1s linear infinite' }} />
              )}
            </div>
          )}

          {regroupError && (
            <div style={{ color: 'var(--red)', fontSize: '0.82rem', marginBottom: 12 }}>
              ⚠ {regroupError}
            </div>
          )}

          {/* Disparity bar chart */}
          <div style={{ margin: '0 0 24px' }}>
            <DisparityBar
              label={`Approval rate · ${displayGroupKey}`}
              groups={Object.entries(activeGroupPerf[displayGroupKey]).map(
                ([name, m]) => ({ name, value: m.approval_rate })
              )}
            />
          </div>

          {/* Group fairness table */}
          <FairnessTable data={activeGroupPerf[displayGroupKey]} />

          {/* Raw breakdown collapsible (continuous only) */}
          {isContinuous && (
            <div style={{ marginTop: 20 }}>
              <button
                onClick={() => setShowRawBreakdown(v => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '6px 14px',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {showRawBreakdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showRawBreakdown ? 'Hide' : 'View'} raw value breakdown
              </button>
              {showRawBreakdown && (
                <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                  <p style={{ fontSize: '0.78rem', color: 'var(--amber, #d99a2b)', marginBottom: 12 }}>
                    ⚠ Raw value breakdown is diagnostic only. It is not used for final fairness flags unless each group has sufficient sample size (≥30 samples).
                  </p>
                  {/* Show original group_performance if available */}
                  {biasResult.group_performance?.[displayGroupKey] && (
                    <FairnessTable data={biasResult.group_performance[displayGroupKey]} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Hidden Bias ──────────────────────────────────────────────────────── */}
      {biasResult?.hidden_bias && biasResult.hidden_bias.length > 0 && (
        <HiddenBiasExplorer subgroups={biasResult.hidden_bias} />
      )}

      {/* ── Navigation ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <button className="btn" onClick={() => navigate('/workflow/step-3')}>
          <ArrowLeft size={16} /> Back
        </button>
        <button className="btn btn-primary" onClick={async () => {
          setIsNavigating(true);
          try {
            await advanceStep(5);
            navigate('/workflow/step-5');
          } finally {
            setIsNavigating(false);
          }
        }} disabled={isNavigating}>
          {isNavigating && <Loader size={16} style={{ animation: 'spin 1.2s linear infinite' }} />}
          Next: Explore Explanations
          {!isNavigating && <ArrowRight size={16} />}
        </button>
      </div>

      {/* Spin keyframe for regroup loading indicator */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
