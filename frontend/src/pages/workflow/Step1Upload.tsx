import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { api } from '../../api/client';
import { parseCsvHeader, splitCsvRows, validateCsvFile, validateCsvContent } from '../../utils/csv';
import { ArrowRight, Database, LayoutGrid, AlertTriangle, Info, Loader } from 'lucide-react';

interface DemoDataset {
  name: string;
  display_name: string;
  description: string;
  available: boolean;
  rows: number;
}

export default function Step1Upload() {
  const {
    file, setFile, setSensitiveCols, setTargetCol, setDomain,
    projectId, projects, advanceStep
  } = useAppContext();

  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState<number>(0);
  const [status] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [demoDatasets, setDemoDatasets] = useState<DemoDataset[]>([]);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/datasets').then(res => {
      setDemoDatasets(res.data.datasets.filter((d: DemoDataset) => d.available));
    }).catch(() => { });
  }, []);

  useEffect(() => {
    if (file && headers.length === 0) {
      file.text().then((text) => {
        setRowCount(Math.max(splitCsvRows(text).length - 1, 0));
        setHeaders(parseCsvHeader(text));
      }).catch(console.error);
    }
  }, [file, headers.length]);

  const parseFile = async (selected: File) => {
    // Validate before accepting the file (extension + size), then validate its contents.
    const fileErr = validateCsvFile(selected);
    if (fileErr) { setError(fileErr); return; }
    const text = await selected.text();
    const contentErr = validateCsvContent(text);
    if (contentErr) { setError(contentErr); return; }
    setError(null);
    setFile(selected);
    setRowCount(Math.max(splitCsvRows(text).length - 1, 0));
    setHeaders(parseCsvHeader(text));
  };

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const selected = event.dataTransfer.files[0];
    if (selected) {
      await parseFile(selected);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="kicker">Step 1 of 9</div>
          <h1 className="page-title">Upload Dataset {projectId ? `for ${projects.find(p => String(p.id) === String(projectId))?.name}` : ''}</h1>
          {!projectId && (
            <div className="banner yellow" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <LayoutGrid size={18} />
              <span>Please select or create a project from the top menu before uploading data.</span>
            </div>
          )}
          <p className="page-subtitle">Provide the dataset you want to audit for fairness. We support CSV files.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
          <div>
            <h3 className="section-title">Secure Data Ingestion</h3>
            <p className="helper">Initialize audit sequence with a valid .csv dataset.</p>
            <input
              id="file-upload"
              className="input"
              type="file"
              accept=".csv"
              onChange={(event) => event.target.files?.[0] && parseFile(event.target.files[0])}
              style={{ display: 'none' }}
            />
            <label htmlFor="file-upload" className="btn btn-secondary" style={{ marginTop: 16, cursor: 'pointer' }}>
              Browse Files
            </label>
            {file && !error && (
              <div style={{ marginTop: 16, padding: 12, background: 'rgba(52, 214, 196, 0.1)', borderRadius: 8 }}>
                <strong style={{ color: 'var(--accent)' }}>Loaded {file.name}</strong>
                <p className="helper" style={{ margin: '4px 0 0' }}>Detected {rowCount.toLocaleString()} rows and {headers.length} columns.</p>
              </div>
            )}
            {error && (
              <div style={{ marginTop: 16, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start', background: 'rgba(240, 86, 91, 0.1)', border: '1px solid #F0565B', borderRadius: 8 }}>
                <AlertTriangle size={18} color="#F0565B" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ color: '#F0565B', fontSize: '0.9rem' }}>{error}</span>
              </div>
            )}
            {status && <p className="helper" style={{ marginTop: 8 }}>{status}</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Database size={18} style={{ color: 'var(--accent)' }} />
          <h3 className="section-title" style={{ margin: 0 }}>Quick-Start with Real Data</h3>
          <div title="Datasets with high number of records may not be fully supported on the platform due to deployment resource limits for pipeline audit processing." style={{ cursor: 'help', display: 'flex', color: 'var(--text-secondary)' }}>
            <Info size={16} />
          </div>
        </div>
        <p className="helper" style={{ marginBottom: 16 }}>
          Load a built-in benchmark dataset to demo the platform immediately.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {demoDatasets.map(ds => (
            <div key={ds.name} style={{ flex: 1, minWidth: 300, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column' }}>
              <strong>{ds.display_name}</strong>
              <p className="helper" style={{ margin: '4px 0 16px', flex: 1 }}>
                {ds.rows.toLocaleString()} rows &middot; {ds.description}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  disabled={loadingDemo}
                  onClick={async () => {
                    setLoadingDemo(true);
                    try {
                      const res = await fetch(`/api/datasets/download/${ds.name}`);
                      const csv = await res.text();
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const f = new File([blob], `${ds.name}.csv`, { type: 'text/csv' });
                      setFile(f);
                      setError(null);
                      setRowCount(Math.max(splitCsvRows(csv).length - 1, 0));
                      setHeaders(parseCsvHeader(csv));

                      const targetCol = res.headers.get('X-Dataset-Target-Col') || '';
                      const sensitiveCols = (res.headers.get('X-Dataset-Sensitive-Cols') || '').split(',').filter(Boolean);
                      const domain = res.headers.get('X-Dataset-Domain') || 'general';

                      setTargetCol(targetCol);
                      setSensitiveCols(sensitiveCols);
                      setDomain(domain);
                    } catch (e) {
                      console.error('Failed to load demo dataset', e);
                    } finally {
                      setLoadingDemo(false);
                    }
                  }}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  Select for Analysis
                </button>
                <a
                  href={`/api/datasets/download/${ds.name}`}
                  download={`${ds.name}.csv`}
                  className="btn btn-secondary"
                  style={{ flex: 1, justifyContent: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                >
                  Download CSV
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-primary"
          onClick={async () => {
            setIsNavigating(true);
            try {
              await advanceStep(2);
              navigate('/workflow/step-2');
            } finally {
              setIsNavigating(false);
            }
          }}
          disabled={!file || isNavigating}
        >
          {isNavigating && <Loader size={16} style={{ animation: 'spin 1.2s linear infinite' }} />}
          Next: Configure Attributes
          {!isNavigating && <ArrowRight size={16} />}
        </button>
      </div>
    </div>
  );
}
