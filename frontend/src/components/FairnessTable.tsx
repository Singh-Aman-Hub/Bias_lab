import { motion } from 'framer-motion';

type GroupMetrics = Record<string, { approval_rate: number; tpr: number; fpr: number; accuracy: number; sample_size?: number; low_confidence?: boolean }>;

export default function FairnessTable({ data }: { data: GroupMetrics }) {
  const rows = Object.entries(data ?? {});
  const minAccuracy = Math.min(...rows.map(([, metrics]) => metrics.accuracy), 1);
  const minApproval = Math.min(...rows.map(([, metrics]) => metrics.approval_rate), 1);
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Group</th>
          <th>Approval Rate</th>
          <th>TPR</th>
          <th>FPR</th>
          <th>Accuracy</th>
          <th>Samples</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([group, metrics], index) => (
          <motion.tr
            key={group}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            whileHover={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
          >
            <td>
              {group}
              {metrics.low_confidence && (
                <span
                  title={`Only ${metrics.sample_size} samples — too few to measure reliably. Interpret this group's rates with caution.`}
                  style={{ marginLeft: 6, color: 'var(--amber, #d99a2b)', cursor: 'help', fontSize: '0.8rem' }}
                >
                  ⚠ low confidence
                </span>
              )}
            </td>
            <td style={{ color: metrics.approval_rate === minApproval ? 'var(--red)' : undefined }}>{(metrics.approval_rate * 100).toFixed(1)}%</td>
            <td>{(metrics.tpr * 100).toFixed(1)}%</td>
            <td>{(metrics.fpr * 100).toFixed(1)}%</td>
            <td style={{ color: metrics.accuracy === minAccuracy ? 'var(--red)' : undefined }}>{(metrics.accuracy * 100).toFixed(1)}%</td>
            <td style={{ color: 'var(--text-secondary)' }}>{metrics.sample_size ?? '—'}</td>
          </motion.tr>
        ))}
      </tbody>
    </table>
  );
}
