import { motion } from 'framer-motion';

// Honest "trust" signals: the established methods this tool actually implements,
// and the public benchmark datasets it validates against. No fabricated logos.
const METHODS = [
  'Demographic Parity',
  'Equal Opportunity',
  'SHAP Explainability',
  'Counterfactual Fairness',
  'Proxy Detection',
  'Stress Testing',
];

export default function Trust() {
  return (
    <section id="trust" className="landing-trust-section">
      <div className="landing-container">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="landing-trust-header"
        >
          <span className="kicker">Grounded in fairness research</span>
          <p className="landing-trust-sub">
            Eight analysis engines built on peer-reviewed fairness metrics — not a black box.
          </p>
        </motion.div>

        <div className="landing-trust-ticker-wrapper">
          <div
            className="landing-trust-ticker"
            style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 16 }}
          >
            {METHODS.map((method) => (
              <div key={method} className="landing-trust-ticker-item">
                <span className="landing-trust-ticker-name" style={{ fontFamily: 'var(--font-mono)' }}>
                  {method}
                </span>
              </div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          viewport={{ once: true }}
          className="card card-primary landing-testimonial"
        >
          <p className="landing-testimonial-text">
            Validated against public fairness benchmarks — the UCI Adult Income dataset
            (1,680 records) and the Hiring Decision Dataset (1,500 records) —
            so you can reproduce every result.
          </p>
          <div className="landing-testimonial-author">
            <span className="landing-testimonial-name">Reproducible by design</span>
            <span className="landing-testimonial-role">scikit-learn · fairlearn · SHAP</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
