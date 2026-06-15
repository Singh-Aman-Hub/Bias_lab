export interface GroupStat {
  group: string;
  count: number;
  share?: number;
  percentage: number;
  approval_rate: number;
  under_represented?: boolean;
  low_confidence?: boolean;
  missing_rate?: number;
}

export interface DataAuditResult {
  group_stats: GroupStat[] | Record<string, Record<string, {
    count: number;
    share: number;
    positive_rate: number;
    missing_rate: number;
    under_represented: boolean;
    low_confidence: boolean;
  }>>;
  column_metadata?: Record<string, { column_type: string; grouping_method: string }>;
  missing_data: Record<string, number>;
  risk_level: string;
  max_gap?: number;
}

export interface ProxyCandidate {
  feature: string;
  correlation: number;
  method: string;
}

export interface ProxyResult {
  proxy_candidates: ProxyCandidate[];
  safe_features: string[];
}

export interface MetricsByGroup {
  group: string;
  demographic_parity: number;
  equal_opportunity: number;
  tpr: number;
  fpr: number;
}

export interface FairnessGaps {
  demographic_parity_difference: number;
  equal_opportunity_difference: number;
  fpr_gap: number;
  // Predictive-parity / calibration lens (the other half of the COMPAS debate). Replaces
  // the dropped fnr_gap, which was identical to equal_opportunity_difference (FNR = 1 - TPR).
  predictive_parity_difference: number;
}

export interface OverfitAssessment {
  train_accuracy: number | null;
  test_accuracy: number | null;
  gap: number | null;
  level: 'none' | 'mild' | 'high' | 'unknown';
  warning: string | null;
}

export interface DisparateImpact {
  ratio: number;
  passes_four_fifths: boolean;
  most_favored: string | null;
  least_favored: string | null;
  most_favored_rate: number | null;
  least_favored_rate: number | null;
  attribute?: string | null;
  by_attribute?: Record<string, DisparateImpact>;
}

export interface SensitiveAttrMeta {
  column_type: 'categorical' | 'continuous';
  grouping_method: string;
  bin_labels: string[];
  num_groups: number;
  min_group_size: number;
  any_low_confidence: boolean;
}

export interface ModelBiasResult {
  fairness_score: number;
  risk_level: string;
  overall_accuracy: number;
  overfit?: OverfitAssessment;
  disparate_impact?: DisparateImpact;
  metrics: FairnessGaps;
  raw_metrics?: FairnessGaps;
  group_performance: Record<string, Record<string, GroupMetricValue>>;
  low_confidence_subgroups?: LowConfidenceSubgroup[];
  min_subgroup_size?: number;
  model_used: string;
  hidden_bias?: HiddenBiasEntry[];
  sensitive_attr_metadata?: Record<string, SensitiveAttrMeta>;
}

export interface LowConfidenceSubgroup {
  attribute: string;
  group: string;
  sample_size: number;
}

export interface GroupMetricValue {
  approval_rate: number;
  // null when the rate is undefined for the group (no actual positives / negatives).
  tpr: number | null;
  fpr: number | null;
  // Precision / PPV — predictive-parity (calibration) lens; null when never flagged positive.
  precision?: number | null;
  accuracy: number;
  sample_size?: number;
  low_confidence?: boolean;
}

export interface HiddenBiasEntry {
  id: string;
  definition: string;
  attributes: Record<string, string>;
  metricDifference: string;
  metricValue: number;
  sampleSize: number;
  metricName: string;
}

export interface ExplanationReason {
  feature: string;
  shap_value: number;
  is_proxy_risk: boolean;
}

export interface ExplanationRecord {
  record_id: number | string;
  decision: string;
  sensitive_attribute: string;
  top_reasons: ExplanationReason[];
  human_explanation: string;
  explanation_type: string;
}

export interface ExplanationPattern {
  pattern_id: string;
  title: string;
  affected_record_count: number;
  decision_type: string;
  risk_type: string;
  risk_level: string;
  confidence: string;
  sensitive_group: string;
  top_drivers: {
    feature: string;
    avg_shap: number;
    direction: string;
  }[];
  proxy_involved: boolean;
  counterfactual_flip_rate: number;
  representative_records: {
    record_id: number | string;
    prediction: string;
    actual: string | null;
    score: number;
    sensitive_group: string;
    top_shap: {
      feature: string;
      value: number;
    }[];
    counterfactual_sensitive?: boolean;
  }[];
  plain_explanation: string;
}

export interface SampleFlip {
  record_id: number;
  original_value: string;
  flipped_value: string;
  // Legacy keys (backward compat)
  original_decision: string;
  flipped_decision: string;
  // New unified keys
  original_prediction?: string;
  flipped_prediction?: string;
  original_raw_value?: number | string;
  flipped_raw_value?: number | string;
  changed?: boolean;
}

export interface CFBreakdownEntry {
  from_group: string;
  to_group: string;
  tested: number;
  flips: number;
  flip_rate: number;
  /** True if this pair is an adjacent step in the band ordering (e.g. 25-34 → 35-44). */
  adjacent?: boolean;
}

export interface CounterfactualResult {
  // Legacy / preserved fields
  flip_rate: number;
  counterfactual_fairness_score?: number;
  flip_breakdown?: Record<string, { rate: number; flips: number; total: number }>;
  interpretation?: string;
  sample_flips?: SampleFlip[];
  // New enriched fields (optional so old results still type-check)
  attribute_tested?: string;
  sensitive_col?: string;
  was_binned?: boolean;
  binning_strategy?: string;
  total_records_tested?: number;
  total_flips?: number;
  risk_level?: 'low' | 'medium' | 'high' | 'unknown';
  warnings?: string[];
  breakdown?: CFBreakdownEntry[];
}

export interface StressScenario {
  name: string;
  fairness_score: number;
  accuracy: number;
  fairness_drop: number;
  fragile: boolean;
  note: string;
  baseline_fairness_score: number;
  baseline_accuracy: number;
}

export interface StressBaseline {
  fairness_score: number;
  accuracy: number;
}

export interface StressTestResult {
  baseline: StressBaseline;
  scenarios: StressScenario[];
  overall_fragility: string;
}

export interface FixRecommendation {
  fix_id: string;
  title: string;
  description: string;
  category: 'data' | 'model' | 'policy';
  priority: 'high' | 'medium' | 'low';
}

export interface SandboxScenario {
  name: string;
  accuracy: number;
  fairness_score: number;
  risk_level: string;
  notes: string;
}

export interface SandboxResult {
  scenarios: SandboxScenario[];
  recommendation: string;
}

export interface PipelineFullResult {
  data_audit?: DataAuditResult;
  proxy?: ProxyResult;
  model_bias?: ModelBiasResult;
  explanations?: ExplanationRecord[];
  explanation_patterns?: ExplanationPattern[];
  explain_summary?: string;
  counterfactual?: CounterfactualResult;
  counterfactual_by_attribute?: Record<string, CounterfactualResult>;
  stress?: StressTestResult;
  recommendations?: FixRecommendation[];
  sandbox?: SandboxResult;
  scores?: Record<string, number>;
  model_used?: string;
  sensitive_policy?: 'attribute-blind' | 'attribute-aware' | 'user_provided_model';
}

export interface MonitoringEvent {
  id: number;
  timestamp: string;
  fairness_score: number;
  alert_triggered: boolean;
  note: string;
  group_breakdown: Record<string, number>;
}

export interface FairnessFlag {
  id: number;
  record_id: string;
  reason: string;
  flagged_by: string;
  resolved: boolean;
}

export interface DriftRootCause {
  feature: string;
  importance: number;
  description: string;
}

export interface DriftReport {
  drift_detected: boolean;
  drift_score: number;
  root_cause: DriftRootCause[];
  drift_results: {
    root_cause: DriftRootCause[];
  };
}

export interface TrendDataPoint {
  date: string;
  score: number;
}

export interface MonitorDataPoint {
  date: string;
  value: number;
}

export interface MonitoringPayload {
  events: MonitoringEvent[];
  flags: FairnessFlag[];
  drift_report?: DriftReport;
  trend_data?: TrendDataPoint[];
  monitor_data?: MonitorDataPoint[];
}

export interface ProjectRecord {
  id: number;
  name: string;
  domain: string;
  sensitive_columns: string[];
  target_column: string;
  max_step: number;
}

export interface CustomScenario {
  name: string;
  type: string;
  target_group: string;
  sensitive_col: string;
  magnitude: number;
}
