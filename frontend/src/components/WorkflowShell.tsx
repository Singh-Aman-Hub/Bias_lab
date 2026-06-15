import { Link, useLocation } from 'react-router-dom';
import React from 'react';
import {
  BarChart3,
  BrainCircuit,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Search,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  Upload,
  Zap,
  LogOut,
} from 'lucide-react';
import ProjectSelector from './ProjectSelector';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

const STEPS = [
  { id: 1, to: '/workflow/step-1', label: 'Upload', icon: Upload },
  { id: 2, to: '/workflow/step-2', label: 'Configure', icon: Settings2 },
  { id: 3, to: '/workflow/step-3', label: 'Data Audit', icon: Search },
  { id: 4, to: '/workflow/step-4', label: 'Model Bias', icon: BarChart3 },
  { id: 5, to: '/workflow/step-5', label: 'Explanations', icon: BrainCircuit },
  { id: 6, to: '/workflow/step-6', label: 'Counterfactual', icon: ShieldCheck },
  { id: 7, to: '/workflow/step-7', label: 'Stress Test', icon: Gauge },
  { id: 8, to: '/workflow/step-8', label: 'Sandbox Fixes', icon: FlaskConical },
  { id: 9, to: '/workflow/mitigation-results', label: 'Mitigation Results', icon: ShieldCheck },
];

export default function WorkflowShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { maxStep, latestMitigationRunId } = useAppContext();
  const { logout } = useAuth();

  const isDashboard = location.pathname === '/dashboard';
  // Fallback to step 1 if not found, unless we are explicitly on the dashboard
  const currentStep = STEPS.find((step) => {
    // For parameterized routes like /workflow/mitigation-results/123
    if (step.to === '/workflow/mitigation-results') {
      return location.pathname.startsWith('/workflow/mitigation-results');
    }
    return location.pathname.includes(step.to);
  }) || STEPS[0];
  
  const currentLabel = isDashboard ? 'Dashboard overview' : currentStep.label;
  const currentMeta = isDashboard ? 'Workspace' : `Step ${currentStep.id} of ${STEPS.length}`;

  return (
    <div className="workflow-shell">
      <aside className="workflow-rail" aria-label="Workflow navigation">
        <Link to="/" className="workflow-rail-brand" aria-label="BIAS LAB home">
          <img src="/logo.png" alt="Logo" style={{ width: '24px', height: '24px' }} />
        </Link>

        <div className="workflow-rail-line" />

        <Link
          to="/dashboard"
          className={`workflow-rail-item ${location.pathname === '/dashboard' ? 'active' : ''}`}
          aria-label="Open dashboard"
          aria-current={location.pathname === '/dashboard' ? 'page' : undefined}
          title="Open dashboard"
        >
          <LayoutDashboard size={17} strokeWidth={1.75} />
        </Link>

        <div className="workflow-rail-line" style={{ height: 1, width: '60%', margin: '0 auto' }} />

        <nav className="workflow-rail-nav">
          {STEPS.map((step) => {
            const Icon = step.icon;
            let isActive = false;
            if (step.to === '/workflow/mitigation-results') {
               isActive = location.pathname.startsWith('/workflow/mitigation-results');
            } else {
               isActive = location.pathname.includes(step.to);
            }
            
            // Mitigation Results requires step 9 (which means maxStep >= 9) 
            const isMitigationResults = step.to === '/workflow/mitigation-results';
            const mitigationRunId = latestMitigationRunId;
            const isLocked = (step.id > maxStep && step.id > 2) || (isMitigationResults && !mitigationRunId);
            // Allow step 1 and 2 always; lock rest until unlocked

            let ariaLabel = `Step ${step.id}: ${step.label}`;
            let titleText = `Step ${step.id}: ${step.label}`;
            
            if (isLocked) {
              if (isMitigationResults) {
                titleText = `Run Sandbox Fixes first`;
                ariaLabel = `${step.label} (locked — run Sandbox Fixes first)`;
              } else {
                titleText = `Complete previous steps to unlock: ${step.label}`;
                ariaLabel = `Step ${step.id}: ${step.label} (locked — complete previous steps to unlock)`;
              }
            }

            return (
              <Link
                key={step.id}
                to={isLocked ? '#' : (isMitigationResults ? `/workflow/mitigation-results/${mitigationRunId}` : step.to)}
                className={`workflow-rail-item ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}`}
                aria-label={ariaLabel}
                aria-current={isActive ? 'page' : undefined}
                aria-disabled={isLocked || undefined}
                // Locked steps are removed from the tab order and ignore keyboard activation,
                // so pointerEvents:none (which only blocks the mouse) isn't a keyboard trap.
                tabIndex={isLocked ? -1 : undefined}
                onClick={isLocked ? (e) => e.preventDefault() : undefined}
                title={titleText}
                style={{
                  opacity: isLocked ? 0.3 : 1,
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  pointerEvents: isLocked ? 'none' : 'auto'
                }}
              >
                <Icon size={17} strokeWidth={1.75} />
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="workflow-content-area">
        <header className="workflow-topbar" style={{ 
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
          padding: '0 32px', height: 72, background: 'rgba(10, 10, 10, 0.8)',
          backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, zIndex: 100
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ProjectSelector />
            <div style={{ width: 1, height: 24, background: 'var(--border)', opacity: 0.3 }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ 
                color: '#fff', fontWeight: 700, fontSize: '0.95rem', letterSpacing: '1.5px', 
                textTransform: 'uppercase', opacity: 0.9 
              }}>
                {currentLabel}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem', letterSpacing: '0.18em', marginTop: 4, textTransform: 'uppercase' }}>
                {currentMeta}
              </div>
            </div>
            
            <div style={{ width: 1, height: 24, background: 'var(--border)', opacity: 0.3 }} />
            
            <button 
              className="btn btn-ghost" 
              onClick={() => logout()}
              title="Sign Out"
              style={{ color: 'var(--text-secondary)', padding: '8px' }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="workflow-main">
          <div className="workflow-frame">{children}</div>
        </main>
      </div>

    </div>
  );
}
