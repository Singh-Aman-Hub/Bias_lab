import type { PipelineFullResult, GroupMetricValue } from '../types';
import type { ExplainPayload } from '../components/ExplainThis';

/**
 * Single source of truth for every metric that can be explained, across all pages.
 * Used by (a) the one-shot pre-fetch after analysis and (b) each page's "Explain this"
 * button — both reference the same `metric` id, so the button reads the pre-fetched cache.
 *
 * Every value/fact here comes straight from the deterministic pipeline output. The LLM only
 * narrates these — it never recomputes them.
 */

function ratesByGroup(
  perf: Record<string, Record<string, GroupMetricValue>> | undefined,
  field: 'approval_rate' | 'tpr' | 'precision'
): { attribute?: string; rates: Record<string, number> } {
  if (!perf) return { rates: {} };
  const attribute = Object.keys(perf)[0];
  if (!attribute) return { rates: {} };
  const rates: Record<string, number> = {};
  for (const [g, m] of Object.entries(perf[attribute])) {
    const v = m[field];
    if (typeof v === 'number') rates[g] = v;
  }
  return { attribute, rates };
}

export function buildExplainItems(
  results: PipelineFullResult | null,
  domain: string
): ExplainPayload[] {
  if (!results) return [];
  const items: ExplainPayload[] = [];

  // ── Model Bias (Step 4) ───────────────────────────────────────────────────
  const bias = results.model_bias;
  const perf = bias?.group_performance;
  const lowConf = (bias?.low_confidence_subgroups ?? []).map((s) => `${s.attribute}:${s.group}`);
  const m = bias?.metrics;
  if (m) {
    const dp = ratesByGroup(perf, 'approval_rate');
    items.push({ metric: 'demographic_parity_difference', label: 'Demographic Parity Gap', value: m.demographic_parity_difference, domain,
      facts: { attribute: dp.attribute, approval_rate_by_group: dp.rates, low_confidence_subgroups: lowConf } });
    const eo = ratesByGroup(perf, 'tpr');
    items.push({ metric: 'equal_opportunity_difference', label: 'Equal Opportunity Gap', value: m.equal_opportunity_difference, domain,
      facts: { attribute: eo.attribute, true_positive_rate_by_group: eo.rates, low_confidence_subgroups: lowConf } });
    const pp = ratesByGroup(perf, 'precision');
    items.push({ metric: 'predictive_parity_difference', label: 'Predictive Parity Gap', value: m.predictive_parity_difference, domain,
      facts: { attribute: pp.attribute, precision_by_group: pp.rates, low_confidence_subgroups: lowConf } });
  }
  const di = bias?.disparate_impact;
  if (di) {
    items.push({ metric: 'disparate_impact_ratio', label: 'Disparate Impact (80% rule)', value: di.ratio, domain,
      facts: { ratio: di.ratio, most_favored: di.most_favored, least_favored: di.least_favored, passes_four_fifths: di.passes_four_fifths, attribute: di.attribute } });
  }
  if (bias) {
    items.push({ metric: 'overall_accuracy', label: 'Overall Accuracy', value: bias.overall_accuracy, domain,
      facts: { overall_accuracy: bias.overall_accuracy, overfit_level: bias.overfit?.level } });
  }

  // ── Counterfactual (Step 4 card + Step 6) ─────────────────────────────────
  const cf = results.counterfactual;
  if (cf) {
    items.push({ metric: 'counterfactual_flip_rate', label: 'Counterfactual Flip Rate', value: cf.flip_rate, domain,
      facts: { flip_rate: cf.flip_rate, interpretation: cf.interpretation, flip_breakdown: cf.flip_breakdown } });
  }

  // ── Data Audit (Step 3) ───────────────────────────────────────────────────
  const audit = results.data_audit as
    | (PipelineFullResult['data_audit'] & { risk_reason?: string; max_gap?: number; under_represented_groups?: string[] })
    | undefined;
  if (audit) {
    items.push({ metric: 'data_audit_overall', label: 'Data Fairness (data audit)', value: audit.risk_level, domain,
      facts: { risk_level: audit.risk_level, reason: audit.risk_reason, max_approval_gap: audit.max_gap, under_represented_groups: audit.under_represented_groups, data_bias_score: results.scores?.data_bias_score } });
  }
  const proxyFeatures = (results.proxy as unknown as { proxy_features?: Array<{ feature: string; proxy_score?: number; correlated_with?: string }> })?.proxy_features;
  if (proxyFeatures && proxyFeatures.length) {
    const top = proxyFeatures[0];
    items.push({ metric: 'data_audit_proxy', label: 'Top proxy feature', value: top.feature, domain,
      facts: { feature: top.feature, correlation: top.proxy_score, correlated_with: top.correlated_with } });
  }

  // ── Explanations (Step 5) ─────────────────────────────────────────────────
  if (results.explain_summary) {
    items.push({ metric: 'explanations_summary', label: 'Explanation summary', domain,
      facts: { summary: results.explain_summary } });
  }

  // ── Stress Test (Step 7) ──────────────────────────────────────────────────
  const stress = results.stress;
  if (stress) {
    const fragile = (stress.scenarios ?? []).filter((s) => s.fragile).map((s) => s.name);
    items.push({ metric: 'stress_overall', label: 'Stress-test robustness', value: stress.overall_fragility, domain,
      facts: { overall_fragility: stress.overall_fragility, baseline_fairness: stress.baseline?.fairness_score, fragile_scenarios: fragile } });
  }

  return items;
}
