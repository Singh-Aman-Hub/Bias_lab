import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Flag } from 'lucide-react';

type GroupMetrics = Record<
  string,
  {
    approval_rate: number;
    tpr: number | null;
    fpr: number | null;
    accuracy: number;
    sample_size?: number;
    low_confidence?: boolean;
  }
>;

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const sign = (v: number) => (v >= 0 ? `+${(v * 100).toFixed(1)}%` : `${(v * 100).toFixed(1)}%`);

export default function FairnessTable({ data }: { data: GroupMetrics }) {
  const rows = Object.entries(data ?? {});

  // Reference group = highest approval rate among non-low-confidence groups ONLY
  const validRows = rows.filter(([, m]) => !m.low_confidence && m.sample_size && m.sample_size >= 30);
  const referenceRow = validRows.length > 0
    ? validRows.reduce((a, b) => a[1].approval_rate >= b[1].approval_rate ? a : b)
    : null;
  const referenceRate = referenceRow ? referenceRow[1].approval_rate : null;
  const referenceName = referenceRow ? referenceRow[0] : null;

  // Sort: reference first, then by approval rate descending
  const sortedRows = [...rows].sort(([aName, a], [bName, b]) => {
    if (referenceName) {
      if (aName === referenceName) return -1;
      if (bName === referenceName) return 1;
    }
    return b.approval_rate - a.approval_rate;
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Group / Range</th>
            <th>Samples</th>
            <th>Approval Rate</th>
            <th>TPR</th>
            <th>FPR</th>
            <th title="Difference in approval rate from the reference (highest-approval) group">
              Gap vs Ref
            </th>
            <th>Confidence</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(([group, metrics], index) => {
            const isRef = referenceName != null && group === referenceName;
            const isLowConf = !!metrics.low_confidence;

            // Low-confidence rows do not drive gap calculations or have gap vs reference
            const gap = referenceRate != null && !isRef && !isLowConf
              ? metrics.approval_rate - referenceRate
              : null;

            const disparity = isLowConf
              ? 'diagnostic'
              : gap != null && Math.abs(gap) > 0.20
                ? 'high'
                : gap != null && Math.abs(gap) > 0.10
                  ? 'moderate'
                  : 'none';

            const gapColor = disparity === 'high'
              ? 'var(--red, #f87171)'
              : disparity === 'moderate'
                ? 'var(--amber, #d99a2b)'
                : 'var(--accent, #34d6c4)';

            return (
              <motion.tr
                key={group}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: index * 0.04 }}
                whileHover={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
                style={{
                  ...(isRef ? { borderLeft: '3px solid var(--accent, #34d6c4)' } : {}),
                  opacity: isLowConf ? 0.65 : 1,
                  fontStyle: isLowConf ? 'italic' : 'normal',
                }}
              >
                {/* Group name */}
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={isLowConf ? { color: 'var(--text-secondary)' } : undefined}>{group}</span>
                    {isRef && (
                      <span
                        title="Reference group (highest approval rate)"
                        style={{
                          fontSize: '0.65rem',
                          padding: '1px 6px',
                          borderRadius: 10,
                          background: 'rgba(52,214,196,0.12)',
                          border: '1px solid rgba(52,214,196,0.3)',
                          color: 'var(--accent, #34d6c4)',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        REF
                      </span>
                    )}
                    {isLowConf && (
                      <span
                        title={`Only ${metrics.sample_size} samples — too few to measure reliably.`}
                        style={{ color: 'var(--amber, #d99a2b)', cursor: 'help', fontSize: '0.75rem' }}
                      >
                        ⚠ low confidence
                      </span>
                    )}
                  </div>
                </td>

                {/* Samples */}
                <td style={{ color: 'var(--text-secondary)' }}>{metrics.sample_size ?? '—'}</td>

                {/* Approval Rate */}
                <td style={isLowConf ? { color: 'var(--text-secondary)' } : { fontWeight: 600 }}>
                  {pct(metrics.approval_rate)}
                </td>

                {/* TPR / FPR */}
                <td style={isLowConf ? { color: 'var(--text-secondary)' } : undefined}>{pct(metrics.tpr)}</td>
                <td style={isLowConf ? { color: 'var(--text-secondary)' } : undefined}>{pct(metrics.fpr)}</td>

                {/* Gap vs Reference */}
                <td>
                  {isRef ? (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>
                  ) : gap != null ? (
                    <span style={{ color: gapColor, fontWeight: 600, fontSize: '0.88rem' }}>
                      {sign(gap)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>
                  )}
                </td>

                {/* Confidence */}
                <td>
                  {isLowConf
                    ? <AlertTriangle size={14} color="var(--amber, #d99a2b)" />
                    : <CheckCircle2 size={14} color="var(--accent, #34d6c4)" />}
                </td>

                {/* Flag */}
                <td>
                  {isLowConf ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '2px 7px',
                        borderRadius: 10,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: 'var(--text-secondary, #94a3b8)',
                        fontSize: '0.7rem',
                        fontWeight: 500,
                      }}
                    >
                      Diagnostic only
                    </span>
                  ) : (
                    <>
                      {disparity === 'high' && !isRef && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            padding: '2px 7px',
                            borderRadius: 10,
                            background: 'rgba(248,113,113,0.12)',
                            border: '1px solid rgba(248,113,113,0.3)',
                            color: 'var(--red, #f87171)',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                          }}
                        >
                          <Flag size={10} /> High
                        </span>
                      )}
                      {disparity === 'moderate' && !isRef && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            padding: '2px 7px',
                            borderRadius: 10,
                            background: 'rgba(217,154,43,0.12)',
                            border: '1px solid rgba(217,154,43,0.3)',
                            color: 'var(--amber, #d99a2b)',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                          }}
                        >
                          Moderate
                        </span>
                      )}
                    </>
                  )}
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
