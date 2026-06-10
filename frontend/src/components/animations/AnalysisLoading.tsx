import { motion } from 'framer-motion';

const ENGINES = [
  'Data auditing...',
  'Detecting proxy features...',
  'Training classifier model...',
  'Analyzing model bias...',
  'Computing SHAP explanations...',
  'Running counterfactual tests...',
  'Executing stress tests...',
  'Generating fix recommendations...',
];

export default function AnalysisLoading() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 400,
      gap: 32,
      padding: 48,
    }}>
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        <motion.div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid rgba(52, 214, 196, 0.15)',
            borderTopColor: 'var(--accent)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          style={{
            position: 'absolute',
            inset: 8,
            borderRadius: '50%',
            border: '2px solid rgba(52, 214, 196, 0.1)',
            borderBottomColor: 'var(--accent)',
          }}
          animate={{ rotate: -360 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      <div style={{ textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: 8 }}>
          Running full analysis pipeline
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          This takes a few seconds for most datasets
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320 }}>
        {ENGINES.map((label, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.4, duration: 0.3 }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 0',
            }}
          >
            <motion.div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--accent)',
                flexShrink: 0,
              }}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.4 }}
            />
            <span style={{
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-body)',
            }}>
              {label}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
