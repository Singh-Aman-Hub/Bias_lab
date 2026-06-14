import React, { useState, useMemo } from 'react';
import { AlertTriangle, Filter, Users, TrendingDown, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface SubgroupBias {
  id: string;
  definition: string;
  attributes: Record<string, string>;
  metricDifference: string;
  metricValue: number;
  sampleSize: number;
  metricName: string;
}

interface HiddenBiasExplorerProps {
  subgroups: SubgroupBias[];
}

/** Try to replace numeric-encoded group labels (0, 1) with readable fallbacks. */
function readableLabel(attrKey: string, value: string): string {
  const v = value.trim();
  // If the value already looks readable (non-numeric) return it directly
  if (isNaN(Number(v)) || v === '') return `${attrKey} = ${v}`;
  // Numeric — annotate clearly rather than showing raw 0/1
  return `${attrKey} Group ${v}`;
}

/** Build a human-readable subgroup definition from the attributes dict. */
function buildDefinition(sg: SubgroupBias): string {
  const parts = Object.entries(sg.attributes)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => readableLabel(k, v));
  return parts.length > 0 ? parts.join(' + ') : sg.definition;
}

function ConfidencePill({ n }: { n: number }) {
  const ok = n >= 30;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 10,
      fontSize: '0.7rem',
      fontWeight: 700,
      background: ok ? 'rgba(52,214,196,0.1)' : 'rgba(217,154,43,0.1)',
      border: `1px solid ${ok ? 'rgba(52,214,196,0.3)' : 'rgba(217,154,43,0.3)'}`,
      color: ok ? 'var(--accent)' : 'var(--amber, #d99a2b)',
    }}>
      <Users size={10} />
      {ok ? 'Reliable' : 'Low confidence'}
    </span>
  );
}

export default function HiddenBiasExplorer({ subgroups }: HiddenBiasExplorerProps) {
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);

  const availableAttributes = useMemo(() => {
    const keys = new Set<string>();
    subgroups.forEach(sg => Object.keys(sg.attributes).forEach(k => keys.add(k)));
    return Array.from(keys);
  }, [subgroups]);

  const toggleAttribute = (attr: string) => {
    setSelectedAttributes(prev =>
      prev.includes(attr) ? prev.filter(a => a !== attr) : [...prev, attr]
    );
  };

  const filteredSubgroups = useMemo(() => {
    let filtered = subgroups;
    if (selectedAttributes.length > 0) {
      filtered = subgroups.filter(sg =>
        selectedAttributes.some(attr => Object.keys(sg.attributes).includes(attr))
      );
    }
    return filtered.sort((a, b) => Math.abs(b.metricValue) - Math.abs(a.metricValue));
  }, [subgroups, selectedAttributes]);

  const worstSubgroup = filteredSubgroups.length > 0 ? filteredSubgroups[0] : null;
  const topBiased = filteredSubgroups.slice(0, 5);

  if (subgroups.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      {/* Section header */}
      <div style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <TrendingDown size={20} color="var(--warning)" />
          Hidden Bias Explorer
        </h3>

        {/* Explanation callout */}
        <div style={{
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(129,140,248,0.07)',
          border: '1px solid rgba(129,140,248,0.2)',
          fontSize: '0.83rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.55,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}>
          <Info size={15} color="#818cf8" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Group-level fairness metrics can hide subgroup-level issues. This section checks
            <strong style={{ color: 'var(--text-primary)' }}> intersectional groups</strong> — for example,
            Gender combined with Age Range — to find smaller subgroups that may receive significantly
            different outcomes compared to the overall approval rate.
            <span style={{ display: 'block', marginTop: 4, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
              ⚠ Subgroups with fewer than 30 samples are marked "low confidence" and should be interpreted cautiously.
            </span>
          </span>
        </div>
      </div>

      {/* Worst subgroup highlight */}
      {worstSubgroup && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            backgroundColor: 'rgba(240, 86, 91, 0.1)',
            border: '1px solid rgba(240, 86, 91, 0.4)',
            borderRadius: 10,
            padding: 18,
            marginBottom: 20,
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
          }}
        >
          <AlertTriangle color="var(--warning)" size={18} style={{ marginTop: 3, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 4, fontSize: '0.88rem' }}>
              Highest Intersectional Risk
            </div>
            <div style={{ fontSize: '1rem', color: 'var(--text-primary)', fontWeight: 600, marginBottom: 6 }}>
              {buildDefinition(worstSubgroup)}
            </div>
            <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Approval gap vs overall:{' '}
              <strong style={{ color: worstSubgroup.metricValue < 0 ? 'var(--warning)' : 'var(--accent)' }}>
                {worstSubgroup.metricDifference}
              </strong>
              {' '}— this subgroup's approval rate is {Math.abs(worstSubgroup.metricValue * 100).toFixed(0)} percentage
              point{Math.abs(worstSubgroup.metricValue * 100).toFixed(0) === '1' ? '' : 's'}{' '}
              {worstSubgroup.metricValue < 0 ? 'below' : 'above'} the overall average.
              This may indicate a subgroup-level pattern and{' '}
              <strong>should be reviewed</strong> — it is not conclusive proof of discrimination on its own.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <ConfidencePill n={worstSubgroup.sampleSize} />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                n = {worstSubgroup.sampleSize} samples
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Attribute filter */}
      {availableAttributes.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Filter size={14} color="var(--text-secondary)" />
            <span style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Filter by attribute:
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {availableAttributes.map(attr => (
              <button
                key={attr}
                onClick={() => toggleAttribute(attr)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 16,
                  border: `1px solid ${selectedAttributes.includes(attr) ? 'rgba(52,214,196,0.6)' : 'var(--border)'}`,
                  backgroundColor: selectedAttributes.includes(attr) ? 'rgba(52,214,196,0.1)' : 'rgba(255,255,255,0.02)',
                  color: selectedAttributes.includes(attr) ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  fontWeight: selectedAttributes.includes(attr) ? 700 : 400,
                  transition: 'all 0.15s',
                }}
              >
                {attr.charAt(0).toUpperCase() + attr.slice(1)}
              </button>
            ))}
            {selectedAttributes.length > 0 && (
              <button
                onClick={() => setSelectedAttributes([])}
                style={{ padding: '4px 12px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.82rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Top {Math.min(5, topBiased.length)} most affected subgroups
        </div>

        {topBiased.length === 0 ? (
          <div className="helper">No subgroups match the selected filters.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Subgroup</th>
                  <th
                    style={{ padding: '10px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}
                    title="Difference in approval rate compared to the overall average"
                  >
                    Approval Gap vs Overall ↕
                  </th>
                  <th style={{ padding: '10px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Samples</th>
                  <th style={{ padding: '10px 8px', color: 'var(--text-secondary)', fontWeight: 600 }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {topBiased.map((sg, idx) => {
                    const isNeg = sg.metricValue < 0;
                    const label = buildDefinition(sg);
                    return (
                      <motion.tr
                        key={sg.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2, delay: idx * 0.05 }}
                        style={{ borderBottom: '1px solid var(--border)' }}
                      >
                        <td style={{ padding: '10px 8px', fontWeight: 500, color: 'var(--text-primary)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 22,
                              height: 22,
                              borderRadius: '50%',
                              backgroundColor: idx === 0 ? 'rgba(240,86,91,0.15)' : 'rgba(255,255,255,0.04)',
                              color: idx === 0 ? 'var(--warning)' : 'var(--text-secondary)',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              flexShrink: 0,
                            }}>
                              {idx + 1}
                            </span>
                            {label}
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '2px 8px',
                            borderRadius: 8,
                            fontWeight: 700,
                            fontSize: '0.82rem',
                            background: isNeg ? 'rgba(248,113,113,0.1)' : 'rgba(52,214,196,0.1)',
                            border: `1px solid ${isNeg ? 'rgba(248,113,113,0.3)' : 'rgba(52,214,196,0.3)'}`,
                            color: isNeg ? 'var(--red, #f87171)' : 'var(--accent)',
                          }}>
                            {sg.metricDifference}
                          </span>
                        </td>
                        <td style={{ padding: '10px 8px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                          {sg.sampleSize}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <ConfidencePill n={sg.sampleSize} />
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
