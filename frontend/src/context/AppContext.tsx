import React, { createContext, useContext, useState, ReactNode } from 'react';
import { formApi, api } from '../api/client';
import { useAuth } from './AuthContext';
import { buildExplainItems } from '../utils/explainItems';
import type {
  DataAuditResult,
  ProxyResult,
  ModelBiasResult,
  ExplanationRecord,
  CounterfactualResult,
  StressTestResult,
  FixRecommendation,
  SandboxResult,
  MonitoringPayload,
  PipelineFullResult,
  ProjectRecord,
  CustomScenario,
} from '../types';

interface AppState {
  file: File | null;
  modelFile: File | null;
  sensitiveCols: string[];
  targetCol: string;
  positiveLabel: string;
  excludeSensitive: boolean;
  domain: string;
  projectId: string | null;
  modelType: 'file' | 'api';
  apiUrl: string;
  requestFormat: string;
  metricPriority: string;
  auditResult: DataAuditResult | null;
  proxyResult: ProxyResult | null;
  biasResult: ModelBiasResult | null;
  explainResult: ExplanationRecord[] | null;
  explainSummary: string | null;
  counterfactualResult: CounterfactualResult | null;
  stressResult: StressTestResult | null;
  recommendResult: FixRecommendation[] | null;
  sandboxResult: SandboxResult | null;
  monitoringResult: MonitoringPayload | null;
  pipelineResults: PipelineFullResult | null;
  isAnalyzing: boolean;
  analyzeError: string | null;
  projects: ProjectRecord[];
  maxStep: number;
  projectName: string | null;
  taskId: string | null;
  latestMitigationRunId: string | null;
}

interface AppContextType extends AppState {
  setFile: (val: File | null) => void;
  setModelFile: (val: File | null) => void;
  setSensitiveCols: (val: string[]) => void;
  setTargetCol: (val: string) => void;
  setPositiveLabel: (val: string) => void;
  setExcludeSensitive: (val: boolean) => void;
  setDomain: (val: string) => void;
  setProjectId: (val: string | null) => void;
  setModelType: (val: 'file' | 'api') => void;
  setApiUrl: (val: string) => void;
  setRequestFormat: (val: string) => void;
  setMetricPriority: (val: string) => void;
  setAuditResult: (val: DataAuditResult | null) => void;
  setProxyResult: (val: ProxyResult | null) => void;
  setBiasResult: (val: ModelBiasResult | null) => void;
  setExplainResult: (val: ExplanationRecord[] | null) => void;
  setExplainSummary: (val: string | null) => void;
  setCounterfactualResult: (val: CounterfactualResult | null) => void;
  setStressResult: (val: StressTestResult | null) => void;
  setRecommendResult: (val: FixRecommendation[] | null) => void;
  setSandboxResult: (val: SandboxResult | null) => void;
  setMonitoringResult: (val: MonitoringPayload | null) => void;

  runFullAnalysis: () => Promise<void>;

  runModelBias: (customStressScenarios?: CustomScenario[]) => Promise<void>;
  runRecommendFixes: () => Promise<void>;
  runSandboxSimulation: (fixes: string[]) => Promise<void>;
  runMonitoringSimulation: () => Promise<void>;
  getMonitoringData: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  advanceStep: (step: number) => Promise<void>;
  setResultsFromPipeline: (data: PipelineFullResult) => void;

  // Plain-English explanation cache (pre-fetched once per analysis).
  getExplanation: (metric: string) => any;
  cacheExplanation: (metric: string, text: any) => void;
  explanationsReady: boolean;
  taskId: string | null;
  latestMitigationRunId: string | null;
  setLatestMitigationRunId: (val: string | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [sensitiveCols, setSensitiveCols] = useState<string[]>([]);
  const [targetCol, setTargetCol] = useState('');
  const [positiveLabel, setPositiveLabel] = useState('');
  const [excludeSensitive, setExcludeSensitive] = useState(false);
  const [domain, setDomain] = useState('loan');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [modelType, setModelType] = useState<'file' | 'api'>('file');
  const [apiUrl, setApiUrl] = useState('');
  const [requestFormat, setRequestFormat] = useState('');
  const [metricPriority, setMetricPriority] = useState('balanced');

  const [auditResult, setAuditResult] = useState<DataAuditResult | null>(null);
  const [proxyResult, setProxyResult] = useState<ProxyResult | null>(null);
  const [biasResult, setBiasResult] = useState<ModelBiasResult | null>(null);
  const [explainResult, setExplainResult] = useState<ExplanationRecord[] | null>(null);
  const [explainSummary, setExplainSummary] = useState<string | null>(null);
  const [counterfactualResult, setCounterfactualResult] = useState<CounterfactualResult | null>(null);
  const [stressResult, setStressResult] = useState<StressTestResult | null>(null);
  const [recommendResult, setRecommendResult] = useState<FixRecommendation[] | null>(null);
  const [sandboxResult, setSandboxResult] = useState<SandboxResult | null>(null);
  const [monitoringResult, setMonitoringResult] = useState<MonitoringPayload | null>(null);

  const [pipelineResults, setPipelineResults] = useState<PipelineFullResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [latestMitigationRunId, setLatestMitigationRunId] = useState<string | null>(null);
  const { user } = useAuth();

  // ── Plain-English explanation cache ─────────────────────────────────────────
  // Filled by a single batch call right after analysis, so each "Explain this" click is
  // an instant cache read instead of a fresh API call. Lazy single calls still fall back
  // (and write here) if the pre-fetch missed or failed.
  const [explanationCache, setExplanationCache] = useState<Record<string, any>>({});
  const [explanationsReady, setExplanationsReady] = useState(false);
  const lastPrefetchSig = React.useRef<string>('');

  const getExplanation = (metric: string) => explanationCache[metric];
  const cacheExplanation = (metric: string, text: any) =>
    setExplanationCache((prev) => ({ ...prev, [metric]: text }));

  const prefetchExplanations = async (result: PipelineFullResult) => {
    setExplanationsReady(false);
    try {
      const items = buildExplainItems(result, domain);
      if (!items.length) { setExplanationsReady(true); return; }
      const res = await api.post('/narrative/explain-batch', { items, project_id: projectId });
      const map = (res.data as { explanations?: Record<string, any> })?.explanations;
      if (map && typeof map === 'object') {
        setExplanationCache((prev) => ({ ...prev, ...map }));
      }
    } catch {
      // Non-fatal: buttons fall back to lazy per-metric calls.
    } finally {
      setExplanationsReady(true);
    }
  };

  // ── Unified pipeline ────────────────────────────────────────────────────────
  const runFullAnalysis = async () => {
    if (!file) return;
    
    // Set analyzing state IMMEDIATELY before any async work.
    // Also clear all previous results so Step3 (and other pages) don't
    // render stale data from a prior run while the new analysis is in flight.
    setIsAnalyzing(true);
    setAnalyzeError(null);
    setPipelineResults(null);
    setAuditResult(null);
    setProxyResult(null);
    setBiasResult(null);
    setExplainResult(null);
    setCounterfactualResult(null);
    setStressResult(null);
    setRecommendResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('sensitive_cols', sensitiveCols.join(','));
      fd.append('target_col', targetCol);
      fd.append('project_id', projectId ?? '0');
      fd.append('metric_priority', metricPriority);
      fd.append('domain', domain);
      if (positiveLabel) fd.append('positive_label', positiveLabel);
      // exclude_sensitive is permanently False on the backend — sensitive columns
      // are always included in training for attribute-aware bias detection.
      // Pass an uploaded custom model so the pipeline uses it instead of the built-in model
      if (modelFile) fd.append('custom_model_file', modelFile);

      // Kick off background task — increased timeout to 60s
      const kickoff = await formApi.post('/pipeline/run-all', fd, { timeout: 60000 });
      const { task_id } = kickoff.data as { task_id: string; status: string };

      api.patch('/user/state', { active_analysis_task: task_id }).catch(() => {});
      
      // Wait 1s for backend to initialize before first poll
      await new Promise(r => setTimeout(r, 1000));
      const data = await pollTaskStatus(task_id);

      setResultsFromPipeline(data);
      await refreshProjects();
      api.patch('/user/state', { active_analysis_task: null }).catch(() => {});
      // Persist the completed task_id for regroup requests
      setTaskId(task_id);
      api.patch('/user/state', { latest_task_id: task_id }).catch(() => {});

    } catch (err) {
      const e = err as { code?: string; message?: string; response?: { data?: { detail?: string } } };
      console.error('Analysis pipeline error:', e);
      const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.includes('timeout');
      const isNetworkIssue = e?.message?.includes('Network Error');
      const message = isTimeout
        ? 'Analysis timed out. The server is taking longer than expected to finalize results. Please check the terminal logs or try again.'
        : isNetworkIssue
          ? 'Cannot reach backend API. Please make sure the backend server is running.'
          : e?.response?.data?.detail || e?.message || 'Analysis failed. Please try again.';
      setAnalyzeError(message);
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const pollTaskStatus = async (task_id: string): Promise<PipelineFullResult> => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const interval = setInterval(async () => {
        // 15 minute overall timeout for the whole analysis
        if (Date.now() - startTime > 900_000) {
          clearInterval(interval);
          reject(new Error('Analysis timed out after 15 minutes'));
          return;
        }
        try {
          // Individual poll timeout increased to 60s
          const poll = await api.get(`/pipeline/status/${task_id}`, { timeout: 60000 });
          const { status, result, error } = poll.data;
          if (status === 'complete') {
            clearInterval(interval);
            resolve(result);
          } else if (status === 'error') {
            clearInterval(interval);
            reject(new Error(error || 'Pipeline failed'));
          }
        } catch (pollErr) {
          const pe = pollErr as { code?: string; message?: string };
          if (pe?.code === 'ECONNABORTED' || pe?.message?.includes('timeout')) {
            clearInterval(interval);
            reject(new Error('Connection timed out while waiting for results. The server may be busy finalizing data.'));
          }
        }
      }, 3000);
    });
  };



  // Cloud user state hydration and active task resumption
  React.useEffect(() => {
    if (user) {
      api.get('/user/state').then(res => {
        const state = res.data;
        if (state.active_project_id && !projectId) {
          setProjectId(state.active_project_id);
        }
        if (state.latest_task_id && !taskId) {
          setTaskId(state.latest_task_id);
        }
        if (state.latest_mitigation_run_id && !latestMitigationRunId) {
          setLatestMitigationRunId(state.latest_mitigation_run_id);
        }
        
        // Resume active task if any
        if (state.active_analysis_task && !pipelineResults && !isAnalyzing) {
          setIsAnalyzing(true);
          pollTaskStatus(state.active_analysis_task)
            .then(data => {
              setResultsFromPipeline(data);
              refreshProjects();
              api.patch('/user/state', { active_analysis_task: null }).catch(() => {});
              setIsAnalyzing(false);
            })
            .catch(err => {
              console.error('Failed to resume task', err);
              api.patch('/user/state', { active_analysis_task: null }).catch(() => {});
              setIsAnalyzing(false);
            });
        }
      }).catch(err => console.error('Failed to load user state', err));
    }
  }, [user]);

  const setResultsFromPipeline = (data: PipelineFullResult) => {
    const result = (data as Record<string, unknown>)?.details ?? (data as Record<string, unknown>)?.result ?? data;
    if (!result) return;

    setAnalyzeError(null);
    setIsAnalyzing(false);

    setAuditResult((result as PipelineFullResult).data_audit ?? null);
    setProxyResult((result as PipelineFullResult).proxy ?? null);
    setBiasResult((result as PipelineFullResult).model_bias ?? null);
    setExplainResult((result as PipelineFullResult).explanations ?? null);
    setExplainSummary((result as PipelineFullResult).explain_summary ?? null);
    setCounterfactualResult((result as PipelineFullResult).counterfactual ?? null);
    setStressResult((result as PipelineFullResult).stress ?? null);
    setRecommendResult((result as PipelineFullResult).recommendations ?? null);
    setPipelineResults(result as PipelineFullResult);

    // Pre-fetch every page's plain-English explanation in one batch call (fire-and-forget).
    // Guard so re-loading the same result (e.g. project auto-load) doesn't re-spend quota.
    const r = result as Record<string, unknown>;
    
    // Check if the backend already cached the explanations in the database
    if (r.explain_batch_cache && typeof r.explain_batch_cache === 'object') {
      setExplanationCache(r.explain_batch_cache as Record<string, any>);
      setExplanationsReady(true);
      return;
    }

    const sig = JSON.stringify({ s: r.scores, m: r.model_used, f: r.fairness_score });
    if (sig !== lastPrefetchSig.current) {
      lastPrefetchSig.current = sig;
      setExplanationCache({});
      void prefetchExplanations(result as PipelineFullResult);
    }
  };


  // ── Legacy helpers (kept for interactive steps) ─────────────────────────────
  const getFormData = () => {
    const fd = new FormData();
    fd.append('project_id', projectId || '');
    fd.append('sensitive_cols', sensitiveCols.join(','));
    fd.append('target_col', targetCol);
    fd.append('metric_priority', metricPriority);
    if (file) fd.append('file', file);
    return fd;
  };

  const runModelBias = async (customStressScenarios?: CustomScenario[]) => {
    if (!file) return;

    const fd = getFormData();
    if (customStressScenarios) {
      fd.append('custom_scenarios', JSON.stringify(customStressScenarios));
    }

    if (modelType === 'api') {
      if (!apiUrl || !requestFormat) {
        throw new Error('API URL and Request Format are required for API endpoint model');
      }
      const apiFd = new FormData();
      apiFd.append('api_url', apiUrl);
      apiFd.append('api_request_format', requestFormat);
      apiFd.append('sensitive_cols', sensitiveCols.join(','));
      apiFd.append('target_col', targetCol);
      apiFd.append('metric_priority', metricPriority);
      apiFd.append('file', file);
      if (customStressScenarios) {
        apiFd.append('custom_scenarios', JSON.stringify(customStressScenarios));
      }
      const biasRes = await formApi.post('/bias/model-from-api', apiFd);
      setBiasResult(biasRes.data);
    } else {
      const biasRes = await formApi.post('/bias/model', fd);
      setBiasResult(biasRes.data);
    }

    const stressRes = await formApi.post('/bias/stress', fd);
    setStressResult(stressRes.data);
  };

  const runRecommendFixes = async () => {
    if (!file) return;
    const payload = {
      audit_result: auditResult,
      proxy_result: proxyResult,
      bias_result: biasResult,
    };
    const res = await api.post('/fixes/recommend', payload);
    setRecommendResult(res.data);
  };

  const runSandboxSimulation = async (fixes: string[]) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('sensitiveCols', sensitiveCols.join(','));
    fd.append('targetCol', targetCol);
    fd.append('metric_priority', metricPriority);
    fd.append('file', file);
    fd.append('strategies', fixes.join(','));
    fd.append('audit_result', JSON.stringify(auditResult));
    fd.append('proxy_result', JSON.stringify(proxyResult));
    fd.append('bias_result', JSON.stringify(biasResult));

    const res = await formApi.post('/fixes/sandbox', fd);
    setSandboxResult(res.data);
  };

  const runMonitoringSimulation = async () => {
    const res = await api.post(`/monitoring/${projectId}/simulate`);
    setMonitoringResult(res.data);
  };

  const getMonitoringData = async () => {
    if (!projectId) return;
    const res = await api.get(`/monitoring/${projectId}`);
    setMonitoringResult(res.data);
  };

  const refreshProjects = async () => {
    try {
      const res = await api.get('/project/list');
      const data = res.data;
      setProjects(Array.isArray(data) ? data : []);
    } catch { }
  };

  const advanceStep = async (step: number) => {
    if (!projectId) return;
    localStorage.setItem(`max_step_${projectId}`, String(
      Math.max(step, parseInt(localStorage.getItem(`max_step_${projectId}`) ?? '1', 10))
    ));
    try {
      const fd = new FormData();
      fd.append('step', step.toString());
      await formApi.patch(`/project/${projectId}/step`, fd);
      await refreshProjects();
    } catch (err) {
      console.error('Failed to advance step', err);
    }
  };

  // ── Persistence & Hydration ────────────────────────────────────────────────

  // 2. Validate projectId still exists after projects load
  React.useEffect(() => {
    if (projects.length > 0 && projectId) {
      const exists = projects.some(p => String(p.id) === String(projectId));
      if (!exists) {
        setProjectId(null);
        if (user) api.patch('/user/state', { active_project_id: null }).catch(() => {});
      }
    }
  }, [projects, projectId, user]);

  // 3. Persist projectId when it changes
  React.useEffect(() => {
    if (user && projectId) {
      api.patch('/user/state', { active_project_id: projectId }).catch(() => {});
    }
  }, [projectId, user]);

  React.useEffect(() => {
    if (user && latestMitigationRunId) {
      api.patch('/user/state', { latest_mitigation_run_id: latestMitigationRunId }).catch(() => {});
    }
  }, [latestMitigationRunId, user]);

  // 3. Auto-load latest results & Navigate to latest step
  React.useEffect(() => {
    if (projectId) {
      // Load results
      api.get(`/project/${projectId}/latest`)
        .then(res => {
          if (res.data.status === 'complete') {
            setResultsFromPipeline(res.data.result);
          }
        })
        .catch(() => { });

      if (projects.length > 0) {
        const p = projects.find(proj => String(proj.id) === String(projectId));
        if (p && p.max_step > 1) {
          // Logic for redirection removed from here to avoid infinite loops
        }
      }
    }
  }, [projectId, projects.length]);

  const currentProject = projects.find(
    p => p.id?.toString() === projectId?.toString()
  );
  const maxStep = Math.min(
    currentProject?.max_step
      ?? parseInt(localStorage.getItem(`max_step_${projectId}`) ?? '1', 10),
    10  // now supports 10 steps including Mitigation
  );
  const projectName = currentProject?.name ?? null;

  React.useEffect(() => {
    if (user) refreshProjects();
  }, [user]);

  return (
    <AppContext.Provider value={{
      file, setFile, modelFile, setModelFile, sensitiveCols, setSensitiveCols, targetCol, setTargetCol, positiveLabel, setPositiveLabel, excludeSensitive, setExcludeSensitive, domain, setDomain, projectId, setProjectId,
      modelType, setModelType, apiUrl, setApiUrl, requestFormat, setRequestFormat,
      metricPriority, setMetricPriority,
      auditResult, setAuditResult, proxyResult, setProxyResult, biasResult, setBiasResult,
      explainResult, setExplainResult, explainSummary, setExplainSummary,
      counterfactualResult, setCounterfactualResult,
      stressResult, setStressResult, recommendResult, setRecommendResult,
      sandboxResult, setSandboxResult, monitoringResult, setMonitoringResult,
      pipelineResults, isAnalyzing, analyzeError,
      projects, maxStep, projectName,
      runFullAnalysis,
      runModelBias, runRecommendFixes, runSandboxSimulation,
      runMonitoringSimulation, getMonitoringData,
      refreshProjects, advanceStep,
      setResultsFromPipeline,
      getExplanation, cacheExplanation, explanationsReady,
      taskId,
      latestMitigationRunId, setLatestMitigationRunId,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
