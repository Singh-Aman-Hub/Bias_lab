import { Tag, BarChart2, Users, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { SensitiveAttrMeta } from '../types';

interface SensitiveAttrSummaryCardProps {
  colName: string;
  meta: SensitiveAttrMeta;
}

export default function SensitiveAttrSummaryCard({ colName, meta }: SensitiveAttrSummaryCardProps) {
  const isContinuous = meta.column_type === 'continuous';

  const typeColor = isContinuous ? '#818cf8' : '#34d6c4';
  const typeBg = isContinuous ? 'rgba(129,140,248,0.12)' : 'rgba(52,214,196,0.12)';
  const typeBorder = isContinuous ? 'rgba(129,140,248,0.3)' : 'rgba(52,214,196,0.3)';

  const confidenceOk = !meta.any_low_confidence;

  return (
    <div
      style={{
        background: 'var(--bg-card, #111)',
        border: '1px solid var(--border, rgba(255,255,255,0.08))',
        borderRadius: 14,
        padding: '16px 20px',
        marginBottom: 16,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 24,
        alignItems: 'center',
      }}
    >
      {/* Column name + type badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160 }}>
        <Tag size={16} color="var(--text-secondary)" />
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
            Sensitive Attribute
          </div>
          <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)' }}>{colName}</div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 10px',
            borderRadius: 20,
            fontSize: '0.7rem',
            fontWeight: 700,
            background: typeBg,
            border: `1px solid ${typeBorder}`,
            color: typeColor,
            whiteSpace: 'nowrap',
          }}
        >
          {isContinuous ? '# Continuous' : '≡ Categorical'}
        </span>
      </div>

      <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch', opacity: 0.4 }} />

      {/* Grouping method */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
        <BarChart2 size={15} color="var(--text-secondary)" />
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
            Grouping
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
            {meta.grouping_method}
          </div>
        </div>
      </div>

      <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch', opacity: 0.4 }} />

      {/* Groups count + min size */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
        <Users size={15} color="var(--text-secondary)" />
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
            Groups
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
            {meta.num_groups} groups
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: 6 }}>
              (min {meta.min_group_size} samples)
            </span>
          </div>
        </div>
      </div>

      <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch', opacity: 0.4 }} />

      {/* Confidence */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {confidenceOk
          ? <CheckCircle2 size={15} color="var(--accent, #34d6c4)" />
          : <AlertTriangle size={15} color="var(--amber, #d99a2b)" />}
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
            Confidence
          </div>
          <div style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: confidenceOk ? 'var(--accent, #34d6c4)' : 'var(--amber, #d99a2b)',
          }}>
            {confidenceOk ? 'Reliable' : 'Some low-confidence groups'}
          </div>
        </div>
      </div>
    </div>
  );
}
