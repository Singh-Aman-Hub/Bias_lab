import { useNavigate } from 'react-router-dom';

export default function Footer() {
  const navigate = useNavigate();

  return (
    <footer className="landing-footer">
      <div className="landing-container">
        <div className="landing-footer-grid">
          <div className="landing-footer-brand">
            <div className="landing-brand">
              <img src="/logo.png" alt="BIAS LAB Logo" className="landing-brand-logo" style={{ width: '32px', height: '32px', marginRight: '10px' }} />
              <span className="landing-brand-text">BIAS</span>
              <span className="landing-brand-tag">LAB</span>
            </div>
            <p className="landing-footer-tagline">
              Algorithmic fairness at enterprise scale.
            </p>
          </div>

          <div className="landing-footer-links">
            <div className="landing-footer-col">
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#how-it-works">How It Works</a>
              <a href="#trust">Methods</a>
            </div>
            <div className="landing-footer-col">
              <h4>Project</h4>
              <a href="https://github.com/Ganesh-0509/Bias-Lab" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="https://github.com/Ganesh-0509/Bias-Lab#readme" target="_blank" rel="noopener noreferrer">Documentation</a>
              <a href="https://github.com/Ganesh-0509/Bias-Lab/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">License (MIT)</a>
            </div>
            <div className="landing-footer-col">
              <h4>Benchmarks</h4>
              <a href="https://archive.ics.uci.edu/dataset/2/adult" target="_blank" rel="noopener noreferrer">UCI Adult Income</a>
              <span>Hiring Decision Dataset</span>
            </div>
          </div>
        </div>

        <div className="landing-footer-bottom">
          <p>© 2026 BIAS.LAB. All rights reserved.</p>
          <button className="btn btn-ghost btn-small" onClick={() => navigate('/dashboard')}>
            Start Your Analysis →
          </button>
        </div>
      </div>
    </footer>
  );
}