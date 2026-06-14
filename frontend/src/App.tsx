import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import WorkflowShell from './components/WorkflowShell';
import PageTransition from './components/animations/PageTransition';
import AnalysisLoading from './components/animations/AnalysisLoading';
import ErrorBoundary from './components/ErrorBoundary';
import { useAppContext } from './context/AppContext';
import { useEffect, useRef } from 'react';
import Chatbot from './components/Chatbot';

const Step1Upload = lazy(() => import('./pages/workflow/Step1Upload'));
const Step2Config = lazy(() => import('./pages/workflow/Step2Config'));
const Step3DataAudit = lazy(() => import('./pages/workflow/Step3DataAudit'));
const Step4ModelBias = lazy(() => import('./pages/workflow/Step4ModelBias'));
const Step5Explanations = lazy(() => import('./pages/workflow/Step5Explanations'));
const Step6Counterfactual = lazy(() => import('./pages/workflow/Step6Counterfactual'));
const Step7StressTest = lazy(() => import('./pages/workflow/Step7StressTest'));
const Step8Sandbox = lazy(() => import('./pages/workflow/Step8Sandbox'));
const Step9Monitoring = lazy(() => import('./pages/workflow/Step9Monitoring'));
const Step10Mitigation = lazy(() => import('./pages/workflow/Step10Mitigation'));
const MitigationResults = lazy(() => import('./pages/workflow/MitigationResults'));

const Dashboard = lazy(() => import('./pages/Dashboard'));
const MonitoringDashboard = lazy(() => import('./pages/MonitoringDashboard'));
const CreateProject = lazy(() => import('./pages/CreateProject'));
const HeroPage = lazy(() => import('./pages/HeroPage'));

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId, projects } = useAppContext();
  const hasResumed = useRef(false);

  useEffect(() => {
    if (projectId && projects.length > 0 && !hasResumed.current && location.pathname !== '/dashboard') {
      const p = projects.find(proj => String(proj.id) === String(projectId));
      if (p && p.max_step > 1) {
        if (location.pathname === '/' || location.pathname.startsWith('/workflow')) {
          const resumeStep = Math.min(p.max_step, 9);
          const targetPath = `/workflow/step-${resumeStep}`;
          if (location.pathname !== targetPath) {
            hasResumed.current = true;
            navigate(targetPath, { replace: true });
          }
        }
      }
    }
  }, [projectId, projects, location.pathname, navigate]);

  return (
    <ErrorBoundary>
      <Chatbot />
      <Routes location={location} key={location.pathname === '/' ? 'root' : 'app'}>
        <Route path="/" element={
          <Suspense fallback={null}><PageTransition locationKey="hero"><HeroPage /></PageTransition></Suspense>
        } />
        
        <Route path="/*" element={
          <WorkflowShell>
            <Suspense fallback={<AnalysisLoading />}>
              <Routes location={location} key={location.pathname}>
                <Route path="/dashboard" element={<PageTransition locationKey="dash"><Dashboard /></PageTransition>} />
                <Route path="/create-project" element={<PageTransition locationKey="create"><CreateProject /></PageTransition>} />

                <Route path="/workflow/step-1" element={<PageTransition locationKey="s1"><Step1Upload /></PageTransition>} />
                <Route path="/workflow/step-2" element={<PageTransition locationKey="s2"><Step2Config /></PageTransition>} />
                <Route path="/workflow/step-3" element={<PageTransition locationKey="s3"><Step3DataAudit /></PageTransition>} />
                <Route path="/workflow/step-4" element={<PageTransition locationKey="s4"><Step4ModelBias /></PageTransition>} />
                <Route path="/workflow/step-5" element={<PageTransition locationKey="s5"><Step5Explanations /></PageTransition>} />
                <Route path="/workflow/step-6" element={<PageTransition locationKey="s6"><Step6Counterfactual /></PageTransition>} />
                <Route path="/workflow/step-7" element={<PageTransition locationKey="s7"><Step7StressTest /></PageTransition>} />
                <Route path="/workflow/step-8" element={<PageTransition locationKey="s8"><Step8Sandbox /></PageTransition>} />
                <Route path="/workflow/step-9" element={<PageTransition locationKey="s9"><Step9Monitoring /></PageTransition>} />
                <Route path="/workflow/step-10" element={<PageTransition locationKey="s10"><Step10Mitigation /></PageTransition>} />
                <Route path="/workflow/mitigation-results/:runId" element={<PageTransition locationKey="mitres"><MitigationResults /></PageTransition>} />
                <Route path="/monitoring" element={<PageTransition locationKey="mon"><MonitoringDashboard /></PageTransition>} />
                
                <Route path="*" element={<Navigate to="/workflow/step-1" replace />} />
              </Routes>
            </Suspense>
          </WorkflowShell>
        } />
      </Routes>
    </ErrorBoundary>
  );
}
