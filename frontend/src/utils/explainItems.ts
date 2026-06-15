import type { PipelineFullResult, GroupMetricValue, ExplanationPattern } from '../types';
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
    const dpAbs = Math.abs(m.demographic_parity_difference ?? 0);
    const dpVerdict = dpAbs <= 0.1 ? 'Low disparity' : dpAbs <= 0.2 ? 'Moderate disparity' : 'High disparity';
    items.push({ metric: 'demographic_parity_difference', label: 'Demographic Parity Gap', value: m.demographic_parity_difference, domain,
      interpretation: dpVerdict,
      facts: { attribute: dp.attribute, approval_rate_by_group: dp.rates, low_confidence_subgroups: lowConf,
               threshold_low: 0.1, threshold_moderate: 0.2, verdict: dpVerdict } });

    const eo = ratesByGroup(perf, 'tpr');
    const eoAbs = Math.abs(m.equal_opportunity_difference ?? 0);
    const eoVerdict = eoAbs <= 0.1 ? 'Low disparity' : eoAbs <= 0.2 ? 'Moderate disparity' : 'High disparity';
    items.push({ metric: 'equal_opportunity_difference', label: 'Equal Opportunity Gap', value: m.equal_opportunity_difference, domain,
      interpretation: eoVerdict,
      facts: { attribute: eo.attribute, true_positive_rate_by_group: eo.rates, low_confidence_subgroups: lowConf,
               threshold_low: 0.1, threshold_moderate: 0.2, verdict: eoVerdict } });

    const pp = ratesByGroup(perf, 'precision');
    const ppAbs = Math.abs(m.predictive_parity_difference ?? 0);
    const ppVerdict = ppAbs <= 0.1 ? 'Low disparity' : ppAbs <= 0.2 ? 'Moderate disparity' : 'High disparity';
    items.push({ metric: 'predictive_parity_difference', label: 'Predictive Parity Gap', value: m.predictive_parity_difference, domain,
      interpretation: ppVerdict,
      facts: { attribute: pp.attribute, precision_by_group: pp.rates, low_confidence_subgroups: lowConf,
               threshold_low: 0.1, threshold_moderate: 0.2, verdict: ppVerdict } });
  }
  const di = bias?.disparate_impact;
  if (di) {
    const diVerdict = di.ratio >= 0.8 ? 'Passes 80% rule' : di.ratio >= 0.6 ? 'Moderate adverse impact' : 'High adverse impact';
    items.push({ metric: 'disparate_impact_ratio', label: 'Disparate Impact (80% rule)', value: di.ratio, domain,
      interpretation: diVerdict,
      facts: { ratio: di.ratio, most_favored: di.most_favored, least_favored: di.least_favored,
               passes_four_fifths: di.passes_four_fifths, attribute: di.attribute,
               threshold_pass: 0.8, threshold_moderate: 0.6, verdict: diVerdict } });
  }
  if (bias) {
    const accVerdict = bias.overall_accuracy >= 0.8 ? 'Good accuracy' : bias.overall_accuracy >= 0.7 ? 'Moderate accuracy' : 'Below threshold';
    items.push({ metric: 'overall_accuracy', label: 'Overall Accuracy', value: bias.overall_accuracy, domain,
      interpretation: accVerdict,
      facts: { overall_accuracy: bias.overall_accuracy, overfit_level: bias.overfit?.level,
               overfit_gap: bias.overfit?.gap, verdict: accVerdict } });
  }

  // ── Counterfactual (Step 4 card + Step 6) ─────────────────────────────────
  const cf = results.counterfactual;
  if (cf) {
    const flipVerdict = cf.flip_rate <= 0.03 ? 'Low sensitivity' : cf.flip_rate <= 0.10 ? 'Moderate sensitivity' : 'High sensitivity';
    // Top 3 breakdown rows by flip_rate (for LLM context).
    const topBreakdown = (cf.breakdown ?? []).slice(0, 3).map((r) => ({
      from_group: r.from_group,
      to_group: r.to_group,
      flips: r.flips,
      tested: r.tested,
      flip_rate: r.flip_rate,
    }));
    items.push({ metric: 'counterfactual_flip_rate', label: 'Counterfactual Flip Rate', value: cf.flip_rate, domain,
      interpretation: flipVerdict,
      facts: {
        flip_rate: cf.flip_rate,
        interpretation: cf.interpretation,
        flip_breakdown: cf.flip_breakdown,
        attribute_tested: cf.attribute_tested,
        was_binned: cf.was_binned,
        binning_strategy: cf.binning_strategy,
        total_records_tested: cf.total_records_tested,
        total_flips: cf.total_flips,
        risk_level: cf.risk_level,
        warnings: cf.warnings,
        top_breakdown_rows: topBreakdown,
        sample_flip_count: (cf.sample_flips ?? []).length,
        no_flips_found: (cf.total_flips ?? 0) === 0,
        threshold_low: 0.03,
        threshold_medium: 0.10,
        verdict: flipVerdict,
      } });

    // Second batch item: page-level counterfactual explanations for Step 6.
    // The LLM returns 7 sub-fields; the frontend reads them from the cache
    // via getExplanation('counterfactual_page'). No new Gemini call is needed on the page.
    items.push({
      metric: 'counterfactual_page',
      label: 'Counterfactual Testing — Page Explanations',
      value: cf.flip_rate,
      domain,
      interpretation: flipVerdict,
      facts: {
        attribute_tested: cf.attribute_tested,
        was_binned: cf.was_binned,
        binning_strategy: cf.binning_strategy,
        total_records_tested: cf.total_records_tested,
        total_flips: cf.total_flips,
        flip_rate: cf.flip_rate,
        counterfactual_fairness_score: cf.counterfactual_fairness_score,
        risk_level: cf.risk_level,
        top_breakdown_rows: topBreakdown,
        sample_flip_count: (cf.sample_flips ?? []).length,
        warnings: cf.warnings,
        no_flips_found: (cf.total_flips ?? 0) === 0,
        // Special instruction for the LLM — return a nested object with 7 sub-fields
        __output_schema__: 'Return a JSON object with EXACTLY these 7 string fields: page_summary, flip_rate_card_explanation, fairness_score_card_explanation, attribute_flip_breakdown_explanation, sample_flip_explanation, warnings_explanation, recommended_next_steps. Never invent numbers. If a value is 0 or missing, say so plainly.',
      },
    });
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

  // ── Explanations (Step 5) ────────────────────────────────────────
  if (results.explain_summary) {
    items.push({ metric: 'explanations_summary', label: 'Explanation summary', domain,
      facts: { summary: results.explain_summary } });
  }
  // Add one explain item per discovered pattern
  const patterns = results.explanation_patterns as ExplanationPattern[] | undefined;
  if (patterns && patterns.length > 0) {
    for (const pattern of patterns) {
      const repRecord = pattern.representative_records?.[0];
      const topReasons = (repRecord?.top_shap ?? []).map((r) => ({
        feature: r.feature,
        shap_value: r.value,
      }));
      items.push({
        metric: `pattern_${pattern.pattern_id}`,
        label: `Decision pattern: ${pattern.title}`,
        domain,
        interpretation: pattern.proxy_involved ? 'Potential proxy-driven bias' : 'Recurring feature influence',
        facts: {
          feature_driver: pattern.top_drivers?.[0]?.feature ?? 'unknown',
          is_proxy: pattern.proxy_involved,
          record_count: pattern.affected_record_count,
          decision_direction: pattern.decision_type,
          top_reasons: topReasons,
          fallback_explanation: pattern.plain_explanation,
        },
      });
    }
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
