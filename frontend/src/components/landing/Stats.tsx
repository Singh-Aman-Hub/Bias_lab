import { motion } from 'framer-motion';

// Verifiable facts about the tool — not fabricated vanity metrics. These line up with the
// Trust section (8 engines, the fairness methods, and the public benchmark datasets).
const stats = [
  { value: '9', label: 'Step Audit Workflow' },
  { value: '8', label: 'Analysis Engines' },
  { value: '6', label: 'Fairness Metrics' },
  { value: '56K+', label: 'Benchmark Records Validated' },
];

export default function Stats() {
  return (
    <section className="landing-stats-section">
      <div className="landing-container">
        <div className="landing-stats-grid">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: i * 0.12 }}
              viewport={{ once: true }}
              className="landing-stat-item"
            >
              <span className="stat-number">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}