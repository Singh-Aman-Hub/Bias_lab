import { motion } from 'framer-motion';

export interface DisparityGroup {
  name: string;
  value: number;
}

interface DisparityBarProps {
  /** Metric being compared, e.g. "Approval rate" or "Demographic parity". */
  label?: string;
  /** Two or more groups to compare. The lowest is treated as the worst-off. */
  groups: DisparityGroup[];
  /** Domain max. Defaults to 1 (rates) or 100 (scores), auto-detected. */
  max?: number;
  /** Value formatter. Defaults to 2-dp for rates, integer for scores. */
  format?: (v: number) => string;
}

type GapRisk = 'high' | 'med' | 'low';

function gapRisk(gapFraction: number): GapRisk {
  // gapFraction is normalized 0..1 of the domain.
  if (gapFraction >= 0.2) return 'high';
  if (gapFraction >= 0.1) return 'med';
  return 'low';
}

const RISK_VAR: Record<GapRisk, string> = {
  high: 'var(--risk-high)',
  med: 'var(--risk-med)',
  low: 'var(--risk-low)',
};

const RISK_LABEL: Record<GapRisk, string> = {
  high: 'HIGH',
  med: 'MODERATE',
  low: 'LOW',
};

/**
 * The signature "Instrument" visualization: paired group bars with the
 * disparity (gap) between best- and worst-off groups made the focal point.
 */
export default function DisparityBar({ label, groups, max, format }: DisparityBarProps) {
  const valid = (groups ?? []).filter(g => typeof g.value === 'number' && !Number.isNaN(g.value));
  if (valid.length === 0) {
    return <div className="helper" style={{ fontFamily: 'var(--font-mono)' }}>No group data.</div>;
  }

  const values = valid.map(g => g.value);
  const isScore = max ? max > 1 : values.some(v => v > 1);
  const domainMax = max ?? (isScore ? 100 : 1);
  const fmt = format ?? ((v: number) => (isScore ? Math.round(v).toString() : v.toFixed(2)));

  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const gap = hi - lo;
  const gapFraction = domainMax > 0 ? gap / domainMax : 0;
  const risk = gapRisk(gapFraction);
  const riskColor = RISK_VAR[risk];

  const sorted = [...valid].sort((a, b) => b.value - a.value);

  return (
    <div style={{ fontFamily: 'var(--font-mono)' }}>
      {label && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 14,
            gap: 12,
          }}
        >
          <span
            style={{
              fontSize: '0.72rem',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
            }}
          >
            {label}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.7rem',
              letterSpacing: '0.08em',
              color: riskColor,
            }}
          >
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: riskColor }} />
            {RISK_LABEL[risk]} DISPARITY
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sorted.map((g, i) => {
          const pct = domainMax > 0 ? Math.max(0, Math.min(1, g.value / domainMax)) * 100 : 0;
          const isWorst = g.value === lo && lo !== hi;
          const barColor = isWorst ? riskColor : 'var(--accent)';
          return (
            <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  width: 96,
                  flexShrink: 0,
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={g.name}
              >
                {g.name}
              </span>
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  height: 18,
                  background: 'rgba(255,255,255,0.04)',
                  border: '0.5px solid var(--border)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5, delay: i * 0.06, ease: 'easeOut' }}
                  style={{
                    position: 'absolute',
                    inset: '0 auto 0 0',
                    background: barColor,
                    opacity: isWorst ? 0.9 : 0.55,
                  }}
                />
              </div>
              <span
                style={{
                  width: 52,
                  flexShrink: 0,
                  textAlign: 'right',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  color: isWorst ? riskColor : 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {fmt(g.value)}
              </span>
            </div>
          );
        })}
      </div>

      {gap > 0 && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '0.5px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'baseline',
            gap: 8,
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{ letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '0.68rem' }}>Gap</span>
          <span style={{ color: riskColor, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(gap)}</span>
        </div>
      )}
    </div>
  );
}
