import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { formApi } from '../../api/client';
import { parseCsvHeader, parseCsvLine } from '../../utils/csv';
import { ArrowRight, ArrowLeft, AlertTriangle, Lightbulb } from 'lucide-react';

// Plan item 10: Auto-suggest sensitive columns from known list
const SENSITIVE_KEYWORDS = ['gender', 'sex', 'race', 'ethnicity', 'caste', 'religion', 'age', 'disability', 'region', 'zipcode', 'zip', 'nationality', 'citizenship', 'marital', 'pregnancy', 'language', 'color', 'colour', 'tribe', 'class', 'income'];



export default function Step2Config() {
  const {
    file,
    modelFile, setModelFile,
    sensitiveCols, setSensitiveCols,
    targetCol, setTargetCol,
    positiveLabel, setPositiveLabel,
    domain, setDomain,
    projectId,
    modelType, setModelType,
    apiUrl, setApiUrl,
    requestFormat, setRequestFormat,
    metricPriority, setMetricPriority,
    runFullAnalysis,
  } = useAppContext();

  const [suggestedSensitiveCols, setSuggestedSensitiveCols] = useState<string[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [targetValues, setTargetValues] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const linesRef = useRef<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!file) {
      navigate('/workflow/step-1');
      return;
    }
    file.text().then(text => {
      const lines = text.trim().split(/\r?\n/);
      linesRef.current = lines;
      const parsedHeaders = parseCsvHeader(text);
      setHeaders(parsedHeaders);
      // Auto-suggest sensitive columns (plan item 10)
      const suggested = parsedHeaders.filter(h =>
        SENSITIVE_KEYWORDS.some(kw => h.toLowerCase().includes(kw))
      );
      setSuggestedSensitiveCols(suggested);
      // Auto-select last column as target if none selected yet
      if (!targetCol && parsedHeaders.length > 0) {
        setTargetCol(parsedHeaders[parsedHeaders.length - 1]);
      }
    });
  }, [file, navigate]);

  // Scan the chosen target column for its distinct values (capped) so we can offer a
  // favorable-outcome selector and warn early if the target isn't binary.
  useEffect(() => {
    const lines = linesRef.current;
    const idx = headers.indexOf(targetCol);
    if (!targetCol || idx < 0 || lines.length < 2) {
      setTargetValues([]);
      return;
    }
    const seen = new Set<string>();
    for (let i = 1; i < lines.length && seen.size <= 50; i++) {
      const cell = (parseCsvLine(lines[i])[idx] ?? '').trim();
      if (cell !== '') seen.add(cell);
    }
    const values = Array.from(seen);
    setTargetValues(values);
    // Clear a stale favorable-outcome choice that no longer belongs to this target.
    if (positiveLabel && !seen.has(positiveLabel)) setPositiveLabel('');
  }, [targetCol, headers]);

  const isBinaryTarget = targetValues.length === 2;
  const isNonBinaryTarget = targetValues.length > 2 || targetValues.length === 1;

  const handleStartAnalysis = async () => {
    setLocalError(null);
    if (!file) {
      setLocalError('Please upload a CSV file first.');
      return;
    }
    if (!projectId) {
      setLocalError('Please select or create a project from the top menu first.');
      return;
    }

    // Persist config — catch 404 gracefully
    try {
      const fd = new FormData();
      fd.append('sensitive_cols', sensitiveCols.join(','));
      fd.append('target_col', targetCol);
      fd.append('domain', domain);
      fd.append('metric_priority', metricPriority);
      await formApi.patch(`/project/${projectId}/config`, fd);
    } catch (configErr) {
      console.warn('Could not persist config, continuing anyway:', configErr);
    }

    // Fire-and-forget — do NOT await. Navigate to step-3 immediately so the
    // AnalysisProgressOverlay renders on top while the backend runs in the background.
    runFullAnalysis();
    navigate('/workflow/step-3');
  };


  return (
    <div>
      <div className="page-header">
        <div>
          <div className="kicker">Step 2 of 9</div>
          <h1 className="page-title">Configuration</h1>
          <p className="page-subtitle">Select the sensitive attributes and define how the model should be accessed.</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="section-title">Sensitive columns</div>
          <p className="helper" style={{ marginBottom: 16 }}>
            Select attributes to audit for bias. We support <strong>Multiple Selection</strong> because bias often overlaps across groups.
          </p>
          
          {/* Selected Chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {sensitiveCols.map(col => (
              <div key={col} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 6, 
                background: 'rgba(52, 214, 196,0.15)', 
                color: 'var(--accent)', 
                padding: '4px 10px', 
                borderRadius: '16px',
                fontSize: '0.85rem',
                fontWeight: 600,
                border: '1px solid rgba(52, 214, 196,0.3)'
              }}>
                {col}
                <button 
                  onClick={() => setSensitiveCols(sensitiveCols.filter(c => c !== col))}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: 'var(--accent)', 
                    cursor: 'pointer', 
                    fontSize: '1rem', 
                    padding: 0,
                    lineHeight: 1,
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  &times;
                </button>
              </div>
            ))}
            {sensitiveCols.length === 0 && <span className="helper">No attributes selected</span>}
          </div>

          {/* Auto-suggest banner (plan item 10) */}
          {suggestedSensitiveCols.filter(s => !sensitiveCols.includes(s)).length > 0 && (
            <div style={{ 
              display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12,
              background: 'rgba(242, 169, 59, 0.08)', border: '1px solid rgba(242, 169, 59, 0.2)',
              borderRadius: 8, padding: '10px 14px'
            }}>
              <Lightbulb size={16} style={{ color: '#F2A93B', flexShrink: 0, marginTop: 2 }} />
              <div>
                <span style={{ fontSize: '0.82rem', color: '#F2A93B', fontWeight: 600 }}>Suggested Sensitive Columns: </span>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>We detected potential sensitive attributes. Click to add:</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {suggestedSensitiveCols.filter(s => !sensitiveCols.includes(s)).map(col => (
                    <button key={col} onClick={() => setSensitiveCols([...sensitiveCols, col])} style={{
                      background: 'rgba(242, 169, 59, 0.12)', border: '1px solid rgba(242, 169, 59, 0.3)',
                      borderRadius: 12, padding: '2px 10px', fontSize: '0.8rem', color: '#F2A93B',
                      cursor: 'pointer', fontWeight: 600
                    }}>
                      + {col}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <select 
            className="select" 
            value="" 
            onChange={(e) => {
              const val = e.target.value;
              if (val && !sensitiveCols.includes(val)) {
                setSensitiveCols([...sensitiveCols, val]);
              }
            }}
          >
            <option value="" disabled>+ Add sensitive attribute...</option>
            {headers
              .filter(h => !sensitiveCols.includes(h))
              .map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
          </select>

          <div style={{ height: 20 }} />

          {/* ── Target column — moved here from right card ── */}
          <div className="section-title">Target column</div>
          <p className="helper" style={{ marginBottom: 8 }}>The column the model predicts (e.g. 'Approved', 'Risk').</p>
          <select
            className="select"
            value={targetCol}
            onChange={(event) => setTargetCol(event.target.value)}
          >
            {headers.map((header) => <option key={header} value={header}>{header}</option>)}
          </select>

          {/* Favorable outcome selector — only meaningful for a binary target */}
          {isBinaryTarget && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title">Favorable outcome</div>
              <p className="helper" style={{ marginBottom: 8 }}>
                Which value is the positive / approved outcome? Drives approval rate, TPR and the fairness gaps.
              </p>
              <select
                className="select"
                value={positiveLabel}
                onChange={(e) => setPositiveLabel(e.target.value)}
              >
                <option value="">Auto-detect (recommended)</option>
                {targetValues.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}

          {/* Non-binary target warning — the audit only supports binary outcomes */}
          {isNonBinaryTarget && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--amber, #d99a2b)' }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <p className="helper" style={{ margin: 0, color: 'inherit' }}>
                {targetValues.length === 1
                  ? `'${targetCol}' has only one value — a fairness audit needs two outcome classes.`
                  : `'${targetCol}' has ${targetValues.length}+ distinct values. This audit measures fairness for binary decisions — pick a column with exactly two outcomes (e.g. approved/denied), or map this to two classes first.`}
              </p>
            </div>
          )}
        </div>

        {/* ── Right card: Project Domain + Fairness Priority ── */}
        <div className="card">
          <div className="section-title">Project Domain</div>
          <p className="helper" style={{ marginBottom: 8 }}>Context-specific benchmarks for the audit.</p>
          <select 
            className="select" 
            value={domain} 
            onChange={(event) => setDomain(event.target.value)}
          >
            {[
              { id: 'loan', name: 'Financial Services / Loans' },
              { id: 'hiring', name: 'Human Resources / Recruitment' },
              { id: 'insurance', name: 'Insurance & Actuarial' },
              { id: 'healthcare', name: 'Healthcare & Diagnostics' },
              { id: 'education', name: 'Education & Admissions' },
              { id: 'criminal_justice', name: 'Public Safety / Law' },
              { id: 'marketing', name: 'Marketing & Personalization' },
              { id: 'other', name: 'General / Custom Domain' }
            ].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>

          <div style={{ height: 24 }} />

          <div className="section-title">Fairness Priority</div>
          <p className="helper" style={{ marginBottom: 12 }}>Choose the metric the forensic engine should prioritize.</p>
          <div style={{ display: 'grid', gap: 12 }}>
            {[
              { id: 'balanced', name: 'Balanced Audit', desc: 'Standard audit balancing fairness and model performance.' },
              { id: 'equal_opportunity_first', name: 'Equal Opportunity', desc: 'Ensures similar True Positive Rates across all groups.' },
              { id: 'demographic_parity_first', name: 'Demographic Parity', desc: 'Ensures the same overall positive outcome rate for all.' }
            ].map(p => (
              <label key={p.id} className={`priority-card ${metricPriority === p.id ? 'active' : ''}`} style={{
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                background: metricPriority === p.id ? 'rgba(52, 214, 196,0.08)' : 'transparent',
                borderColor: metricPriority === p.id ? 'var(--accent)' : 'var(--border)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input 
                    type="radio" 
                    name="priority" 
                    checked={metricPriority === p.id} 
                    onChange={() => setMetricPriority(p.id)}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: metricPriority === p.id ? 'var(--accent)' : 'var(--text-primary)' }}>{p.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>{p.desc}</div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title">Model source</div>
        <div className="helper">Choose whether to use the built-in model pipeline or an external API endpoint.</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio"
              value="file"
              checked={modelType === 'file'}
              onChange={(e) => setModelType(e.target.value as 'file' | 'api')}
            />
            Built-in / File Upload
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio"
              value="api"
              checked={modelType === 'api'}
              onChange={(e) => setModelType(e.target.value as 'file' | 'api')}
            />
            API Endpoint
          </label>
        </div>
      </div>

      {modelType === 'api' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title">API Configuration</div>
          <div className="helper">Configure your model API endpoint for bias analysis.</div>
          <div style={{ marginTop: 12 }}>
            <label className="helper" style={{ display: 'block', marginBottom: 8 }}>Model API URL</label>
            <input
              className="input"
              type="text"
              placeholder="https://api.example.com/predict"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="helper" style={{ display: 'block', marginBottom: 8 }}>Request format template (JSON)</label>
            <textarea
              className="input"
              placeholder={'{"input": "{feature1}", "age": {age}, "score": {score}}'}
              value={requestFormat}
              onChange={(e) => setRequestFormat(e.target.value)}
              style={{ width: '100%', minHeight: 100, fontFamily: 'monospace' }}
            />
            <p className="helper" style={{ marginTop: 8 }}>Use {'{column_name}'} as placeholders for CSV columns</p>
          </div>
        </div>
      )}

      {modelType === 'file' && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title">Model upload (Optional)</div>
          <div className="helper">Upload a .pkl or .joblib file. If skipped, we will train a default RF model automatically.</div>
          <input
            id="model-upload"
            className="input"
            type="file"
            accept=".pkl,.joblib"
            style={{ display: 'none' }}
            onChange={(e) => setModelFile(e.target.files?.[0] ?? null)}
          />
          <label htmlFor="model-upload" className="btn btn-secondary" style={{ marginTop: 12, cursor: 'pointer' }}>
            Browse Files
          </label>
          {modelFile && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="helper" style={{ color: 'var(--accent)' }}>Using model: {modelFile.name}</span>
              <button
                className="btn"
                style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                onClick={() => setModelFile(null)}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <button className="btn" onClick={() => navigate('/workflow/step-1')}>
          <ArrowLeft size={16} /> Back
        </button>
        <button
          className="btn btn-primary"
          onClick={handleStartAnalysis}
          disabled={!file || isNonBinaryTarget || (modelType === 'api' && (!apiUrl || !requestFormat))}
        >
          Start Full Analysis <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
