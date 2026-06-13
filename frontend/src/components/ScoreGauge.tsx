import { scoreColor, scoreSeverity } from '../utils/score';

type ScoreGaugeProps = {
  score: number;
  label?: string;
};

const radius = 54;
const circumference = 2 * Math.PI * radius;

export default function ScoreGauge({ score, label = 'Fairness Score' }: ScoreGaugeProps) {
  const normalized = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - normalized / 100);

  // Shared bands (>=75 good / 50-74 moderate / <50 poor) so the gauge matches every other score.
  const color = scoreColor(normalized);
  const sev = scoreSeverity(normalized);
  const riskLabel = sev === 'good' ? 'Low Risk' : sev === 'moderate' ? 'Moderate Risk' : 'High Risk';

  return (
    <div style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
      <svg
        width="184"
        height="184"
        viewBox="0 0 180 180"
        role="img"
        aria-label={`${label}: ${Math.round(normalized)} out of 100 — ${riskLabel}`}
      >
        <circle cx="90" cy="90" r={radius} stroke="rgba(148,163,184,0.18)" strokeWidth="14" fill="none" />
        <circle
          cx="90"
          cy="90"
          r={radius}
          stroke={color}
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 90 90)"
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
        <text x="90" y="90" textAnchor="middle" dominantBaseline="central" fill="var(--text-primary)" fontSize="36" fontWeight="700">
          {Math.round(normalized)}
        </text>
      </svg>
      <div style={{ display: 'grid', placeItems: 'center', gap: 6 }}>
        <span
          className="pill"
          style={{
            color,
            borderColor: `${color}66`,
            background: `${color}1f`,
            fontSize: '0.72rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '5px 12px'
          }}
        >
          {riskLabel}
        </span>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
    </div>
  );
}
