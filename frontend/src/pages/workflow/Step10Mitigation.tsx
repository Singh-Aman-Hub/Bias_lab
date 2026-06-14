import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAppContext } from '../../context/AppContext';
import { ShieldAlert, ArrowRight, Download, CheckCircle, Loader2, Sparkles, FolderPlus } from 'lucide-react';
import AnimatedCard from '../../components/animations/AnimatedCard';
import ChatHelpButton from '../../components/ChatHelpButton';

interface Pattern {
  pattern: Record<string, string>;
  description: string;
  affected_records: number;
  positive_rate: number;
  overall_positive_rate: number;
  disparity: number;
  confidence: string; // plan item 9: confidence level
  explanation?: string;
  isExplaining?: boolean;
}

export default function Step10Mitigation() {
  const { projectId, pipelineResults } = useAppContext();
  // Use the full pipeline result as the "before" baseline for comparison
  const beforeResult = pipelineResults as any;
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loadingPatterns, setLoadingPatterns] = useState(false);
  const [selectedPatterns, setSelectedPatterns] = useState<Record<number, boolean>>({});
  
  const [mitigating, setMitigating] = useState(false);
  const [mitigationTaskId, setMitigationTaskId] = useState<string | null>(null);
  const [mitigatedResult, setMitigatedResult] = useState<any | null>(null);
  
  const [exportingProject, setExportingProject] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) {
      fetchPatterns();
    }
  }, [projectId]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (mitigationTaskId && !mitigatedResult) {
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`http://localhost:8000/api/pipeline/status/${mitigationTaskId}`);
          if (res.data.status === 'complete') {
            setMitigatedResult(res.data.result);
            setMitigating(false);
            clearInterval(interval);
          } else if (res.data.status === 'error') {
            alert('Mitigation failed: ' + res.data.error);
            setMitigating(false);
            clearInterval(interval);
          }
        } catch (error) {
          console.error("Failed to poll mitigation status", error);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [mitigationTaskId, mitigatedResult]);

  const fetchPatterns = async () => {
    setLoadingPatterns(true);
    try {
      const formData = new FormData();
      formData.append('project_id', String(projectId));
      const res = await axios.post('http://localhost:8000/api/patterns/discover', formData);
      setPatterns(res.data.patterns || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingPatterns(false);
    }
  };

  const handleExplain = async (index: number) => {
    const pattern = patterns[index];
    setPatterns(prev => prev.map((p, i) => i === index ? { ...p, isExplaining: true } : p));
    
    try {
      const formData = new FormData();
      formData.append('pattern_description', pattern.description);
      formData.append('affected_records', String(pattern.affected_records));
      
      const res = await axios.post('http://localhost:8000/api/patterns/explain', formData);
      
      setPatterns(prev => prev.map((p, i) => i === index ? { ...p, isExplaining: false, explanation: res.data.explanation } : p));
    } catch (err) {
      setPatterns(prev => prev.map((p, i) => i === index ? { ...p, isExplaining: false, explanation: 'Failed to generate explanation.' } : p));
    }
  };

  const togglePatternSelection = (index: number) => {
    setSelectedPatterns(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const commitMitigation = async () => {
    const selected = patterns.filter((_, i) => selectedPatterns[i]).map(p => p.pattern);
    if (selected.length === 0) {
      alert("Select at least one pattern to mitigate.");
      return;
    }
    
    setMitigating(true);
    setMitigatedResult(null);
    setExportSuccess(null);
    
    try {
      const formData = new FormData();
      formData.append('project_id', String(projectId));
      formData.append('exclude_patterns', JSON.stringify(selected));
      
      const res = await axios.post('http://localhost:8000/api/mitigate/apply', formData);
      setMitigationTaskId(res.data.task_id);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to commit mitigation.");
      setMitigating(false);
    }
  };

  const handleDownloadDataset = () => {
    window.location.href = `http://localhost:8000/api/mitigate/download?project_id=${projectId}`;
  };

  const handleExportProject = async () => {
    setExportingProject(true);
    try {
      const formData = new FormData();
      formData.append('project_id', String(projectId));
      formData.append('new_project_name', `Mitigated Project ${new Date().toISOString().split('T')[0]}`);
      
      const res = await axios.post('http://localhost:8000/api/mitigate/export-as-project', formData);
      setExportSuccess(`Exported successfully as new project ID: ${res.data.new_project_id}`);
    } catch (err: any) {
      alert("Failed to export project: " + err.response?.data?.detail);
    } finally {
      setExportingProject(false);
    }
  };

  const renderComparisonRow = (label: string, oldVal: number, newVal: number, lowerIsBetter: boolean, isPercentage = false) => {
    const diff = newVal - oldVal;
    let isImprovement = false;
    
    if (lowerIsBetter) {
      isImprovement = diff < 0;
    } else {
      isImprovement = diff > 0;
    }
    
    const fmt = (v: number) => isPercentage ? `${(v * 100).toFixed(1)}%` : v.toFixed(2);
    const diffFmt = (v: number) => {
      if (v === 0) return "No change";
      const sign = v > 0 ? "+" : "";
      return isPercentage ? `${sign}${(v * 100).toFixed(1)}%` : `${sign}${v.toFixed(2)}`;
    };

    return (
      <tr className="border-t border-slate-100 dark:border-slate-800">
        <td className="py-3 px-4 text-sm font-medium">{label}</td>
        <td className="py-3 px-4 text-sm text-slate-500">{fmt(oldVal)}</td>
        <td className="py-3 px-4 text-sm font-semibold">{fmt(newVal)}</td>
        <td className="py-3 px-4 text-sm">
          {Math.abs(diff) > 0.001 ? (
            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${isImprovement ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {diffFmt(diff)}
            </span>
          ) : <span className="text-slate-400 text-xs">No change</span>}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="mb-8">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3" style={{ margin: 0 }}>
            <ShieldAlert className="text-indigo-600" size={32} />
            Pattern-Level Bias Review & Mitigation
          </h1>
          <ChatHelpButton section="Pattern-Level Mitigation" description="Review discovered multi-dimensional bias patterns, explain their impact using AI, and commit mitigations by excluding or rebalancing records." />
        </div>
        <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
          Discover intersectional biases hidden in your dataset and choose mitigation strategies.
        </p>
      </div>

      {!mitigatedResult && (
        <AnimatedCard className="p-6 bg-white dark:bg-slate-900">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 className="text-xl font-bold" style={{ margin: 0 }}>Discovered Biased Patterns</h2>
            <ChatHelpButton section="Discovered Biased Patterns" description="Intersectional sub-populations found to have significant disparity gaps. You can explain or exclude them." extraContext={{ patterns }} />
          </div>
          
          {loadingPatterns ? (
            <div className="flex justify-center items-center h-32">
              <Loader2 className="animate-spin text-indigo-500" size={32} />
            </div>
          ) : patterns.length === 0 ? (
            <p className="text-slate-500">No significant bias patterns detected in the dataset.</p>
          ) : (
            <div className="space-y-4">
              {patterns.map((p, i) => (
                <div key={i} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg flex items-center gap-2">
                        <input type="checkbox" checked={!!selectedPatterns[i]} onChange={() => togglePatternSelection(i)} className="w-5 h-5 text-indigo-600 rounded" />
                        {p.description}
                      </h3>
                      <p className="text-sm text-slate-500 mt-1">
                        Affected Records: <strong>{p.affected_records}</strong> | 
                        Disparity Gap: <strong>{(p.disparity * 100).toFixed(1)}%</strong>
                      </p>
                      {/* Plan item 9: Confidence label */}
                      {p.confidence && (
                        <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                          p.confidence === 'High confidence' ? 'bg-green-100 text-green-700'
                          : p.confidence === 'Medium confidence' ? 'bg-yellow-100 text-yellow-700'
                          : p.confidence === 'Low confidence' ? 'bg-orange-100 text-orange-700'
                          : 'bg-red-100 text-red-700'
                        }`}>
                          {p.confidence}
                          {p.confidence === 'Insufficient sample size' && ' — treat with caution'}
                        </span>
                      )}
                    </div>
                    {!p.explanation && !p.isExplaining && (
                      <button onClick={() => handleExplain(i)} className="text-sm text-indigo-600 font-medium hover:underline flex items-center gap-1">
                        <Sparkles size={16} /> Explain Impact
                      </button>
                    )}
                    {p.isExplaining && <Loader2 size={16} className="animate-spin text-indigo-500" />}
                  </div>
                  {p.explanation && (
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded text-sm text-slate-700 dark:text-slate-300">
                      <strong className="block mb-1 text-indigo-600">AI Assessment:</strong>
                      {p.explanation}
                    </div>
                  )}
                </div>
              ))}

              <div className="mt-6 flex justify-end">
                <button
                  onClick={commitMitigation}
                  disabled={mitigating || !Object.values(selectedPatterns).some(v => v)}
                  className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold flex items-center gap-2 hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {mitigating ? <><Loader2 size={20} className="animate-spin" /> Mitigating...</> : 'Commit Mitigations'}
                </button>
              </div>
            </div>
          )}
        </AnimatedCard>
      )}

      {mitigatedResult && beforeResult && (
        <div className="space-y-8 animate-fade-in-up">
          <AnimatedCard className="p-6 bg-white dark:bg-slate-900 border-2 border-indigo-500/20">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 className="text-2xl font-bold flex items-center gap-2" style={{ margin: 0 }}>
                <CheckCircle className="text-green-500" /> Mitigation Results
              </h2>
              <ChatHelpButton section="Mitigation Comparison" description="Compare the fairness scores, demographic parity, equal opportunity, and accuracy before vs. after the mitigation was applied." extraContext={{ mitigated_results: mitigatedResult }} />
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50">
                    <th className="py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Metric</th>
                    <th className="py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Original Model</th>
                    <th className="py-3 px-4 font-semibold text-indigo-600 dark:text-indigo-400">Mitigated Model</th>
                    <th className="py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {renderComparisonRow(
                    "Overall Fairness Score",
                    beforeResult.fairness_score || 0,
                    mitigatedResult.fairness_score || 0,
                    false, // higher is better
                    false
                  )}
                  {renderComparisonRow(
                    "Demographic Parity Gap",
                    beforeResult.model_bias?.metrics?.demographic_parity_difference || 0,
                    mitigatedResult.model_bias?.metrics?.demographic_parity_difference || 0,
                    true, // lower is better
                    false
                  )}
                  {renderComparisonRow(
                    "Equal Opportunity Gap",
                    beforeResult.model_bias?.metrics?.equal_opportunity_difference || 0,
                    mitigatedResult.model_bias?.metrics?.equal_opportunity_difference || 0,
                    true, // lower is better
                    false
                  )}
                  {renderComparisonRow(
                    "Model Accuracy",
                    beforeResult.model_bias?.overall_accuracy || 0,
                    mitigatedResult.model_bias?.overall_accuracy || 0,
                    false, // higher is better
                    true
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="mt-8 flex flex-wrap gap-4">
              <button onClick={handleDownloadDataset} className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-white px-5 py-2.5 rounded-lg font-medium transition-colors">
                <Download size={18} /> Download New Dataset
              </button>
              
              <button onClick={handleExportProject} disabled={exportingProject} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50">
                {exportingProject ? <Loader2 size={18} className="animate-spin" /> : <FolderPlus size={18} />}
                Export as New Project
              </button>
            </div>
            
            {exportSuccess && (
              <div className="mt-4 p-3 bg-green-50 text-green-700 rounded text-sm">
                {exportSuccess}
              </div>
            )}
          </AnimatedCard>
        </div>
      )}
    </div>
  );
}
