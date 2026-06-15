import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import type { SampleFlip } from '../types';

interface CounterfactualFlipProps {
  sampleFlip?: SampleFlip | null;
  totalFlips?: number;
  totalRecordsTested?: number;
  attributeTested?: string;
}

export default function CounterfactualFlip({
  sampleFlip,
  totalFlips = 0,
  totalRecordsTested = 0,
  attributeTested,
}: CounterfactualFlipProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const originalDecision = sampleFlip?.original_prediction ?? sampleFlip?.original_decision ?? '';
  const flippedDecision = sampleFlip?.flipped_prediction ?? sampleFlip?.flipped_decision ?? '';

  useEffect(() => {
    setIsFlipped(false);
    clearTimeout(timerRef.current);
    if (sampleFlip) {
      timerRef.current = setTimeout(() => setIsFlipped(true), 600);
    }
    return () => clearTimeout(timerRef.current);
  }, [sampleFlip]);

  // No flips available — show informative message instead of fake Approved→Rejected.
  if (!sampleFlip || totalFlips === 0) {
    return (
      <div
        style={{
          padding: '20px 24px',
          borderRadius: 10,
          background: 'rgba(100,116,139,0.08)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
          fontSize: '0.9rem',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
          No Decision Flip Sample Available
        </div>
        <div>
          The model returned {totalFlips} decision flip{totalFlips !== 1 ? 's' : ''} out of{' '}
          {totalRecordsTested} tested records
          {attributeTested ? ` for ${attributeTested}` : ''}.
        </div>
        <div style={{ marginTop: 6, fontSize: '0.82rem' }}>
          A 0% flip rate may indicate the model is robust, or that the sensitive attribute is not
          present in the feature set used for prediction.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Group label row */}
      {(sampleFlip.original_value || sampleFlip.flipped_value) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
          }}
        >
          <span
            style={{
              background: 'rgba(53,201,138,0.12)',
              border: '1px solid rgba(53,201,138,0.3)',
              borderRadius: 6,
              padding: '2px 8px',
              color: '#34d399',
              fontWeight: 600,
            }}
          >
            {sampleFlip.original_value}
          </span>
          <span>→</span>
          <span
            style={{
              background: 'rgba(240,86,91,0.12)',
              border: '1px solid rgba(240,86,91,0.3)',
              borderRadius: 6,
              padding: '2px 8px',
              color: '#f87171',
              fontWeight: 600,
            }}
          >
            {sampleFlip.flipped_value}
          </span>
          <span style={{ marginLeft: 6, opacity: 0.7 }}>
            (Record #{sampleFlip.record_id})
          </span>
        </div>
      )}

      <div className="grid-2" style={{ perspective: 1200 }}>
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          className="card"
          style={{ borderColor: 'rgba(53, 201, 138,0.3)', background: 'rgba(53, 201, 138,0.08)' }}
        >
          <div className="kicker">Original decision</div>
          <h3 className="section-title" style={{ fontSize: '1.5rem', marginTop: '12px', textTransform: 'uppercase' }}>
            {originalDecision}
          </h3>
        </motion.div>

        <motion.div
          initial={{ rotateX: -90, opacity: 0 }}
          animate={isFlipped ? { rotateX: 0, opacity: 1 } : { rotateX: -90, opacity: 0 }}
          transition={{ duration: 0.6, type: 'spring', bounce: 0.3 }}
          className="card"
          style={{
            borderColor: 'rgba(240, 86, 91,0.3)',
            background: 'rgba(240, 86, 91,0.08)',
            transformOrigin: 'top center',
          }}
        >
          <div className="kicker" style={{ borderColor: 'rgba(240, 86, 91,0.5)', color: '#fca5a5' }}>
            After flipping sensitive attribute
          </div>
          <h3 className="section-title" style={{ fontSize: '1.5rem', marginTop: '12px', textTransform: 'uppercase' }}>
            {flippedDecision}
          </h3>
        </motion.div>
      </div>
    </div>
  );
}
