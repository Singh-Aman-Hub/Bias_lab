import React from 'react';
import { HelpCircle } from 'lucide-react';
import AnimatedCard from './animations/AnimatedCard';
import AnimatedNumber from './animations/AnimatedNumber';
import ExplainThis from './ExplainThis';
import { useAppContext } from '../context/AppContext';
import { useChat } from '../context/ChatContext';
import type { ModelBiasResult, CounterfactualResult, GroupMetricValue } from '../types';

interface FairnessMetricsPanelProps {
  biasResult: ModelBiasResult | null;
  counterfactualResult: CounterfactualResult | null;
}

interface MetricItemProps {
  title: string;
  value: number | string;
  rawValue?: number | string;
  shortLine: string;                    // one-line contextual summary shown on card
  description: string;                  // description text kept for reference
  thresholds: {
    good: (v: number) => boolean;
    moderate: (v: number) => boolean;
  };
  isPercentage?: boolean;
  index: number;
  metricKey: string;
  domain?: string;
  facts?: Record<string, unknown>;
}

function riskLabel(severity: 'green' | 'amber' | 'red' | 'gray'): string {
  switch (severity) {
    case 'green': return 'Low disparity';
    case 'amber': return 'Moderate disparity';
    case 'red':   return 'High disparity';
    default:      return 'No data';
  }
}

const MetricCard: React.FC<MetricItemProps> = ({
  title, value, rawValue, shortLine, description, thresholds, isPercentage,
  index, metricKey, domain, facts
}) => {
  const { setIsOpen, updateContext } = useChat();
  const numValue = typeof value === 'number' ? value : parseFloat(value as string);
  const numRawValue = typeof rawValue === 'number' ? rawValue : (rawValue ? parseFloat(rawValue as string) : NaN);

  let severity: 'green' | 'amber' | 'red' | 'gray' = 'red';
  if (!isNaN(numValue)) {
    if (thresholds.good(numValue))     severity = 'green';
    else if (thresholds.moderate(numValue)) severity = 'amber';
  } else {
    severity = 'gray';
  }

  const severityColor = {
    green: 'var(--accent)',
    amber: 'var(--yellow)',
    red:   'var(--warning)',
    gray:  'var(--text-secondary)',
  }[severity];

  const displayValue = isNaN(numValue)
    ? 'no data'
    : isPercentage
      ? `${(numValue * 100).toFixed(1)}%`
      : numValue.toFixed(2);

  const statusText = riskLabel(severity);
  const hasRawDiff = !isNaN(numValue) && !isNaN(numRawValue) && Math.abs(numRawValue - numValue) > 0.001;

  return (
    <AnimatedCard
      severity={severity}
      delay={index * 0.08}
      style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: 0 }}
      ariaLabel={`${title}: ${displayValue}, ${statusText}`}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.3 }}>{title}</h4>
        <button
          onClick={() => {
            updateContext('metric', title);
            updateContext('metricValue', displayValue);
            updateContext('facts', facts);
            updateContext('domain', domain);
            setIsOpen(true);
          }}
          title="Ask chatbot about this metric"
          style={{ cursor: 'pointer', color: 'var(--text-secondary)', background: 'none', border: 'none', padding: 0, flexShrink: 0, marginLeft: 6 }}
        >
          <HelpCircle size={15} />
        </button>
      </div>

      {/* Value */}
      <div className="stat-number" style={{ fontSize: '2rem', marginBottom: hasRawDiff ? 2 : 6, lineHeight: 1 }}>
        <AnimatedNumber value={numValue} isPercentage={isPercentage} />
      </div>

      {/* Optional Raw Observed subtext if different */}
      {hasRawDiff && (
        <div style={{
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
          marginBottom: 6,
          fontWeight: 500,
        }}>
          Raw Observed: {isPercentage ? `${(numRawValue * 100).toFixed(1)}%` : numRawValue.toFixed(2)} <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>(incl. low confidence)</span>
        </div>
      )}

      {/* Status badge */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        borderRadius: 5,
        fontSize: '0.78rem',
        fontWeight: 600,
        background: `${severityColor}20`,
        color: severityColor,
        marginBottom: 10,
        alignSelf: 'flex-start',
      }}>
        {statusText}
      </div>

      {/* One-line contextual interpretation */}
      <p style={{
        margin: '0 0 10px',
        fontSize: '0.8rem',
        color: 'var(--text-secondary)',
        lineHeight: 1.5,
        flexGrow: 1,
      }}>
        {shortLine}
      </p>

      {/* Explain this */}
      <ExplainThis
        payload={{
          metric: metricKey,
          label: title,
          value: displayValue,
          interpretation: statusText,
          domain,
          facts,
        }}
      />
    </AnimatedCard>
  );
};

// ── Deterministic one-line interpretation builders ────────────────────────────

function dpShortLine(dpGap: number, primaryAttr: string | undefined, groups: Record<string, GroupMetricValue>): string {
  if (isNaN(dpGap)) return 'Approval rate comparison unavailable.';
  const pct = (dpGap * 100).toFixed(0);
  const attrLabel = primaryAttr ?? 'groups';
  if (dpGap <= 0.05) return `Approval rates differ by only ${pct}pp across ${attrLabel} — very low gap.`;
  if (dpGap <= 0.10) return `Approval rates differ by ${pct}pp across ${attrLabel} — low to moderate gap.`;
  if (dpGap <= 0.20) return `Approval rates differ by ${pct}pp across ${attrLabel} — moderate disparity. Review contributing features.`;
  return `Approval rates differ by ${pct}pp across ${attrLabel} — high disparity. Investigate proxy variables.`;
}

function eoShortLine(eoGap: number, primaryAttr: string | undefined): string {
  if (isNaN(eoGap)) return 'True positive rate comparison unavailable.';
  const pct = (eoGap * 100).toFixed(0);
  const attrLabel = primaryAttr ?? 'groups';
  if (eoGap <= 0.05) return `Qualified applicants are identified at similar rates across ${attrLabel}.`;
  if (eoGap <= 0.10) return `True positive rate gap is ${pct}pp — low to moderate. Check which group is underserved.`;
  if (eoGap <= 0.20) return `True positive rate gap is ${pct}pp — moderate. Some qualified applicants may be missed in one group.`;
  return `True positive rate gap is ${pct}pp — high. One group's qualified applicants are significantly underserved.`;
}

function ppShortLine(ppGap: number, primaryAttr: string | undefined): string {
  if (isNaN(ppGap)) return 'Precision comparison across groups unavailable.';
  const pct = (ppGap * 100).toFixed(0);
  const attrLabel = primaryAttr ?? 'groups';
  if (ppGap <= 0.05) return `A positive prediction carries similar reliability across ${attrLabel}.`;
  if (ppGap <= 0.10) return `Precision gap is ${pct}pp — low to moderate. Positive predictions may be less reliable for one group.`;
  if (ppGap <= 0.20) return `Precision gap is ${pct}pp — moderate. Verify calibration fairness across groups.`;
  return `Precision gap is ${pct}pp — high. A positive prediction means different things for different groups.`;
}

function diShortLine(diRatio: number, mostFavored: string | null | undefined, leastFavored: string | null | undefined): string {
  if (isNaN(diRatio)) return '80% rule comparison unavailable.';
  const pct = (diRatio * 100).toFixed(0);
  if (diRatio >= 0.8) return `${pct}% — passes the EEOC four-fifths (80%) rule. No legal adverse impact signal detected.`;
  if (diRatio >= 0.6) {
    const gLabel = leastFavored ? `"${leastFavored}"` : 'the least-favored group';
    return `${pct}% — below the 80% legal threshold. ${gLabel} receives substantially fewer approvals proportionally.`;
  }
  return `${pct}% — well below the 80% threshold. Significant adverse impact signal. Requires domain validation.`;
}

function flipShortLine(flipRate: number, primaryAttr: string | undefined): string {
  if (isNaN(flipRate)) return 'Counterfactual flip data unavailable.';
  const pct = (flipRate * 100).toFixed(0);
  const attrLabel = primaryAttr ?? 'the sensitive attribute';
  if (flipRate <= 0.05) return `${pct}% of decisions change when ${attrLabel} is swapped — very low reliance.`;
  if (flipRate <= 0.15) return `${pct}% of decisions flip when ${attrLabel} is swapped — moderate. Review if this is acceptable.`;
  return `${pct}% of decisions flip when ${attrLabel} is swapped — high. The model may rely on this attribute directly.`;
}

function accShortLine(accuracy: number, overfitLevel: string | undefined): string {
  if (isNaN(accuracy)) return 'Accuracy data unavailable.';
  const pct = (accuracy * 100).toFixed(1);
  const suffix = overfitLevel === 'high'
    ? ' Significant overfitting detected — real-world performance may be lower.'
    : overfitLevel === 'mild'
      ? ' Mild overfitting — monitor performance on new data.'
      : '';
  if (accuracy >= 0.9) return `Overall accuracy is ${pct}% — strong predictive performance.${suffix}`;
  if (accuracy >= 0.8) return `Overall accuracy is ${pct}% — good performance.${suffix}`;
  if (accuracy >= 0.7) return `Overall accuracy is ${pct}% — moderate. Consider retraining or better features.${suffix}`;
  return `Overall accuracy is ${pct}% — below typical thresholds. Model may need significant improvement.${suffix}`;
}


export default function FairnessMetricsPanel({ biasResult, counterfactualResult }: FairnessMetricsPanelProps) {
  const { domain } = useAppContext();

  const dpGap  = biasResult?.metrics?.demographic_parity_difference ?? NaN;
  const eoGap  = biasResult?.metrics?.equal_opportunity_difference  ?? NaN;
  const ppGap  = biasResult?.metrics?.predictive_parity_difference  ?? NaN;
  const accuracy = biasResult?.overall_accuracy ?? NaN;
  const flipRate = counterfactualResult?.flip_rate ?? NaN;
  const diRatio  = biasResult?.disparate_impact?.ratio ?? NaN;

  const dpRawGap = biasResult?.raw_metrics?.demographic_parity_difference ?? NaN;
  const eoRawGap = biasResult?.raw_metrics?.equal_opportunity_difference  ?? NaN;
  const ppRawGap = biasResult?.raw_metrics?.predictive_parity_difference  ?? NaN;

  const groupPerf  = biasResult?.group_performance ?? {};
  const primaryAttr = Object.keys(groupPerf)[0];
  const groups = primaryAttr
    ? (groupPerf[primaryAttr] as Record<string, GroupMetricValue>)
    : ({} as Record<string, GroupMetricValue>);

  const byGroup = (field: 'approval_rate' | 'tpr' | 'precision') =>
    Object.fromEntries(
      Object.entries(groups)
        .map(([g, m]) => [g, m[field]] as [string, number | null | undefined])
        .filter(([, v]) => v != null)
    );

  const di      = biasResult?.disparate_impact;
  const lowConf = (biasResult?.low_confidence_subgroups ?? []).map((s) => `${s.attribute}:${s.group}`);

  const cards: MetricItemProps[] = [
    {
      index: 0,
      title: 'Demographic Parity Gap',
      metricKey: 'demographic_parity_difference',
      domain,
      value: dpGap,
      rawValue: dpRawGap,
      shortLine: dpShortLine(dpGap, primaryAttr, groups),
      description: 'Difference in selection rates between groups.',
      thresholds: { good: (v) => Math.abs(v) <= 0.1, moderate: (v) => Math.abs(v) <= 0.2 },
      facts: { attribute: primaryAttr, approval_rate_by_group: byGroup('approval_rate'), low_confidence_subgroups: lowConf },
    },
    {
      index: 1,
      title: 'Equal Opportunity Gap',
      metricKey: 'equal_opportunity_difference',
      domain,
      value: eoGap,
      rawValue: eoRawGap,
      shortLine: eoShortLine(eoGap, primaryAttr),
      description: 'Difference in true positive rates between groups.',
      thresholds: { good: (v) => Math.abs(v) <= 0.1, moderate: (v) => Math.abs(v) <= 0.2 },
      facts: { attribute: primaryAttr, true_positive_rate_by_group: byGroup('tpr'), low_confidence_subgroups: lowConf },
    },
    {
      index: 2,
      title: 'Predictive Parity Gap',
      metricKey: 'predictive_parity_difference',
      domain,
      value: ppGap,
      rawValue: ppRawGap,
      shortLine: ppShortLine(ppGap, primaryAttr),
      description: 'Precision gap: does a positive prediction carry equal reliability for every group?',
      thresholds: { good: (v) => Math.abs(v) <= 0.1, moderate: (v) => Math.abs(v) <= 0.2 },
      facts: { attribute: primaryAttr, precision_by_group: byGroup('precision'), low_confidence_subgroups: lowConf },
    },
    {
      index: 3,
      title: 'Disparate Impact (80% rule)',
      metricKey: 'disparate_impact_ratio',
      domain,
      value: diRatio,
      isPercentage: true,
      shortLine: diShortLine(diRatio, di?.most_favored, di?.least_favored),
      description: 'EEOC four-fifths rule — least-favored group selection rate / most-favored.',
      thresholds: { good: (v) => v >= 0.8, moderate: (v) => v >= 0.6 },
      facts: {
        ratio: di?.ratio,
        most_favored: di?.most_favored,
        least_favored: di?.least_favored,
        passes_four_fifths: di?.passes_four_fifths,
        attribute: di?.attribute,
      },
    },
    {
      index: 4,
      title: 'Counterfactual Flip Rate',
      metricKey: 'counterfactual_flip_rate',
      domain,
      value: flipRate,
      isPercentage: true,
      shortLine: flipShortLine(flipRate, primaryAttr),
      description: 'Share of predictions that change when only the sensitive attribute is modified.',
      thresholds: { good: (v) => v <= 0.05, moderate: (v) => v <= 0.15 },
      facts: { flip_rate: flipRate, attribute: primaryAttr },
    },
    {
      index: 5,
      title: 'Overall Accuracy',
      metricKey: 'overall_accuracy',
      domain,
      value: accuracy,
      isPercentage: true,
      shortLine: accShortLine(accuracy, biasResult?.overfit?.level),
      description: 'Overall predictive accuracy of the model across all groups.',
      thresholds: { good: (v) => v >= 0.8, moderate: (v) => v >= 0.7 },
      facts: { overall_accuracy: accuracy, overfit_level: biasResult?.overfit?.level },
    },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h3 className="section-title" style={{ marginBottom: 4 }}>Multi-Metric Fairness Analysis</h3>
        <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.88rem' }}>
          Fairness cannot be reduced to a single number. These six metrics show different perspectives of model behaviour across groups.
          Thresholds used: low disparity ≤10pp, moderate ≤20pp, above 20pp = high disparity. Disparate impact: 80% rule (EEOC).
        </p>
      </div>

      {/*
        3×2 responsive grid:
        Desktop  → 3 columns
        Tablet   → 2 columns  (≤ 900px)
        Mobile   → 1 column   (≤ 560px)
        Inline media queries not supported in JSX style props, so we use a CSS class
        or a grid with auto-fit that naturally wraps. We use CSS custom properties to
        get controlled breakpoints via a wrapper class set in index.css.
      */}
      <div className="fairness-grid">
        {cards.map((card) => (
          <MetricCard key={card.metricKey} {...card} />
        ))}
      </div>
    </div>
  );
}
