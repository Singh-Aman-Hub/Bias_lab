// Single source of truth for fairness-score bands, matching the backend's risk_from_score:
//   >= 75  good      (green/accent)
//   50-74  moderate  (amber)
//   < 50   poor      (red)
// Use these everywhere instead of ad-hoc 65/70/75 cutoffs so a score means the same thing
// on every screen.

export const SCORE_GOOD = 75;
export const SCORE_MODERATE = 50;

export type ScoreSeverity = 'good' | 'moderate' | 'poor';

export function scoreSeverity(score: number): ScoreSeverity {
  if (score >= SCORE_GOOD) return 'good';
  if (score >= SCORE_MODERATE) return 'moderate';
  return 'poor';
}

/** CSS color for a score. */
export function scoreColor(score: number): string {
  const s = scoreSeverity(score);
  return s === 'good' ? 'var(--accent)' : s === 'moderate' ? 'var(--yellow)' : 'var(--red)';
}

/** Faint translucent background tint matching the score color. */
export function scoreBgTint(score: number): string {
  const s = scoreSeverity(score);
  return s === 'good'
    ? 'rgba(52, 214, 196, 0.1)'
    : s === 'moderate'
      ? 'rgba(242, 169, 59, 0.1)'
      : 'rgba(240, 86, 91, 0.1)';
}

/** Pill class + short label for a binary-ish status display. */
export function scorePill(score: number): { cls: string; label: string } {
  const s = scoreSeverity(score);
  if (s === 'good') return { cls: 'green', label: 'HEALTHY' };
  if (s === 'moderate') return { cls: 'yellow', label: 'NEEDS REVIEW' };
  return { cls: 'red', label: 'CRITICAL' };
}
