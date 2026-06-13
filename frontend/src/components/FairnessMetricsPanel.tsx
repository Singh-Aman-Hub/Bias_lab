import React from 'react';
import { HelpCircle } from 'lucide-react';
import AnimatedCard from './animations/AnimatedCard';
import AnimatedNumber from './animations/AnimatedNumber';
import ExplainThis from './ExplainThis';
import { useAppContext } from '../context/AppContext';
import type { ModelBiasResult, CounterfactualResult, GroupMetricValue } from '../types';

interface FairnessMetricsPanelProps {
  biasResult: ModelBiasResult | null;
  counterfactualResult: CounterfactualResult | null;
}

interface MetricItemProps {
  title: string;
  value: number | string;
  description: string;
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

const MetricCard: React.FC<MetricItemProps> = ({ title, value, description, thresholds, isPercentage, index, metricKey, domain, facts }) => {
  const numValue = typeof value === 'number' ? value : parseFloat(value as string);
  
  let severity: 'green' | 'amber' | 'red' | 'gray' = 'red';
  let interpretation = 'High disparity';
  
  if (!isNaN(numValue)) {
    if (thresholds.good(numValue)) {
      severity = 'green';
      interpretation = 'Acceptable range';
    } else if (thresholds.moderate(numValue)) {
      severity = 'amber';
      interpretation = 'Moderate disparity';
    }
  } else {
    severity = 'gray';
    interpretation = 'No data';
  }

  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'green': return 'var(--accent)';
      case 'amber': return 'var(--yellow)';
      case 'red': return 'var(--warning)';
      default: return 'var(--text-secondary)';
    }
  };

  const displayValue = isNaN(numValue) ? 'no data' : isPercentage ? `${(numValue * 100).toFixed(1)}%` : numValue.toFixed(2);

  return (
    <AnimatedCard
      severity={severity}
      delay={index * 0.1}
      style={{ padding: '20px' }}
      ariaLabel={`${title}: ${displayValue}, ${interpretation}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{title}</h4>
        <div title={description} style={{ cursor: 'help', color: '#9ca3af' }}>
          <HelpCircle size={16} />
        </div>
      </div>
      
      <div className="stat-number" style={{ fontSize: '2rem', marginBottom: '8px' }}>
        <AnimatedNumber value={numValue} isPercentage={isPercentage} />
      </div>
      
      <div style={{ 
        display: 'inline-block',
        padding: '4px 8px', 
        borderRadius: '4px', 
        fontSize: '0.875rem',
        backgroundColor: `${getSeverityColor(severity)}20`,
        color: getSeverityColor(severity),
        fontWeight: 500
      }}>
        {interpretation}
      </div>

      <ExplainThis
        payload={{
          metric: metricKey,
          label: title,
          value: displayValue,
          interpretation,
          domain,
          facts,
        }}
      />
    </AnimatedCard>
  );
};

export default function FairnessMetricsPanel({ biasResult, counterfactualResult }: FairnessMetricsPanelProps) {
  const { domain } = useAppContext();
  const dpGap = biasResult?.metrics?.demographic_parity_difference ?? NaN;
  const eoGap = biasResult?.metrics?.equal_opportunity_difference ?? NaN;
  const ppGap = biasResult?.metrics?.predictive_parity_difference ?? NaN;
  const accuracy = biasResult?.overall_accuracy ?? NaN;
  const flipRate = counterfactualResult?.flip_rate ?? NaN;
  const diRatio = biasResult?.disparate_impact?.ratio ?? NaN;

  // Grounding facts for the LLM explainer come straight from the computed pipeline output —
  // the model only narrates these, it never recomputes them. We feed each card the slice
  // of per-group numbers relevant to that specific metric.
  const groupPerf = biasResult?.group_performance ?? {};
  const primaryAttr = Object.keys(groupPerf)[0];
  const groups = primaryAttr ? groupPerf[primaryAttr] : {};
  const byGroup = (field: 'approval_rate' | 'tpr' | 'precision') =>
    Object.fromEntries(
      Object.entries(groups as Record<string, GroupMetricValue>)
        .map(([g, m]) => [g, m[field]] as [string, number | null | undefined])
        .filter(([, v]) => v != null)
    );
  const di = biasResult?.disparate_impact;
  const lowConf = (biasResult?.low_confidence_subgroups ?? []).map((s) => `${s.attribute}:${s.group}`);

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h3 className="section-title" style={{ marginBottom: '4px' }}>Multi-Metric Fairness Analysis</h3>
        <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem' }}>
          Fairness cannot be reduced to a single number. These metrics show different perspectives of model behavior across groups.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        <MetricCard
          index={0}
          title="Demographic Parity Gap"
          metricKey="demographic_parity_difference"
          domain={domain}
          facts={{ attribute: primaryAttr, approval_rate_by_group: byGroup('approval_rate'), low_confidence_subgroups: lowConf }}
          value={dpGap}
          description="Difference in selection rates between groups. A value closer to 0 indicates groups are selected at similar rates."
          thresholds={{
            good: (v) => Math.abs(v) <= 0.1,
            moderate: (v) => Math.abs(v) <= 0.2,
          }}
        />
        <MetricCard
          index={1}
          title="Equal Opportunity Gap"
          metricKey="equal_opportunity_difference"
          domain={domain}
          facts={{ attribute: primaryAttr, true_positive_rate_by_group: byGroup('tpr'), low_confidence_subgroups: lowConf }}
          value={eoGap}
          description="Difference in true positive rates between groups. A value closer to 0 indicates qualified individuals from all groups have similar chances."
          thresholds={{
            good: (v) => Math.abs(v) <= 0.1,
            moderate: (v) => Math.abs(v) <= 0.2,
          }}
        />
        <MetricCard
          index={2}
          title="Predictive Parity Gap"
          metricKey="predictive_parity_difference"
          domain={domain}
          facts={{ attribute: primaryAttr, precision_by_group: byGroup('precision'), low_confidence_subgroups: lowConf }}
          description="The other half of the COMPAS debate: does a 'positive' prediction mean the same thing for every group? This is the gap in precision (of those flagged positive, how many truly were) across groups. A value closer to 0 means the score is equally trustworthy for each group. Predictive parity and equal error rates provably trade off — a fair tool reports both."
          value={ppGap}
          thresholds={{
            good: (v) => Math.abs(v) <= 0.1,
            moderate: (v) => Math.abs(v) <= 0.2,
          }}
        />
        <MetricCard
          index={3}
          title="Disparate Impact (80% rule)"
          metricKey="disparate_impact_ratio"
          domain={domain}
          facts={{
            ratio: di?.ratio,
            most_favored: di?.most_favored,
            least_favored: di?.least_favored,
            passes_four_fifths: di?.passes_four_fifths,
            attribute: di?.attribute,
          }}
          value={diRatio}
          isPercentage={true}
          description="EEOC four-fifths rule — the US legal standard. The least-favored group's selection rate divided by the most-favored group's. At or above 80% passes; below 80% is the legal threshold for adverse impact."
          thresholds={{
            good: (v) => v >= 0.8,
            moderate: (v) => v >= 0.6,
          }}
        />
        <MetricCard
          index={4}
          title="Counterfactual Flip Rate"
          metricKey="counterfactual_flip_rate"
          domain={domain}
          facts={{ flip_rate: flipRate, attribute: primaryAttr }}
          value={flipRate}
          isPercentage={true}
          description="Percentage of predictions that change when only the sensitive attribute is modified. A lower flip rate means the model is less reliant on the sensitive attribute."
          thresholds={{
            good: (v) => v <= 0.05,
            moderate: (v) => v <= 0.15,
          }}
        />
        <MetricCard
          index={5}
          title="Overall Accuracy"
          metricKey="overall_accuracy"
          domain={domain}
          facts={{ overall_accuracy: accuracy, overfit_level: biasResult?.overfit?.level }}
          value={accuracy}
          isPercentage={true}
          description="Overall predictive accuracy of the model across all groups."
          thresholds={{
            good: (v) => v >= 0.8,
            moderate: (v) => v >= 0.7,
          }}
        />
      </div>
    </div>
  );
}
