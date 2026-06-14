import React from 'react';
import { HelpCircle } from 'lucide-react';
import { useChat } from '../context/ChatContext';
import { useAppContext } from '../context/AppContext';

interface ChatHelpButtonProps {
  /** The section or card title this button relates to */
  section: string;
  /** A brief description of what this section shows */
  description?: string;
  /** Any extra key-value data to pass as context (e.g. metric values) */
  extraContext?: Record<string, any>;
  /** Optional inline style override */
  style?: React.CSSProperties;
  /** Size of the icon, default 16 */
  size?: number;
}

/**
 * Universal ? help button.
 * On click, it:
 *  1. Collects current dataset + project context from AppContext
 *  2. Merges with the card-specific context
 *  3. Opens the chatbot pre-loaded with that context
 */
export default function ChatHelpButton({ section, description, extraContext, style, size = 16 }: ChatHelpButtonProps) {
  const { setIsOpen, setContextData } = useChat();
  const { 
    pipelineResults, sensitiveCols, targetCol, domain, projectId,
    auditResult, biasResult
  } = useAppContext();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Build rich context from all available data
    const datasetContext: Record<string, any> = {
      section,
      description: description || `The user is asking about: ${section}`,
      domain,
      target_column: targetCol,
      sensitive_columns: sensitiveCols,
      project_id: projectId,
    };

    // Attach pipeline summary if available
    if (pipelineResults) {
      const p = pipelineResults as any;
      datasetContext['overall_fairness_score'] = p.fairness_score;
      datasetContext['decision'] = p.decision;
      datasetContext['data_bias_score'] = p.scores?.data_bias_score;
      datasetContext['model_bias_score'] = p.scores?.model_bias_score;
      datasetContext['proxy_risk_score'] = p.scores?.proxy_risk_score;
    }

    // Attach audit summary
    if (auditResult) {
      const auditAny = auditResult as any;
      datasetContext['max_approval_gap'] = auditAny.max_gap;
      datasetContext['risk_level'] = auditResult.risk_level;
    }

    // Attach key bias metrics if available
    if (biasResult) {
      datasetContext['demographic_parity_gap'] = biasResult.metrics?.demographic_parity_difference;
      datasetContext['equal_opportunity_gap'] = biasResult.metrics?.equal_opportunity_difference;
      datasetContext['overall_accuracy'] = biasResult.overall_accuracy;
    }

    // Merge card-specific extra context
    if (extraContext) {
      Object.assign(datasetContext, extraContext);
    }

    setContextData(datasetContext);
    setIsOpen(true);
  };

  return (
    <button
      onClick={handleClick}
      title={`Ask AI about: ${section}`}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--text-secondary, #9ca3af)',
        padding: '2px',
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: '50%',
        transition: 'color 0.2s, opacity 0.2s',
        opacity: 0.7,
        ...style
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6366f1'; (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary, #9ca3af)'; (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; }}
      aria-label={`Help: ${section}`}
    >
      <HelpCircle size={size} />
    </button>
  );
}
