// Static, motion-free hero shown when WebGL is unavailable or the user prefers reduced
// motion. Keeps the headline message and the primary call-to-action reachable without the
// Three.js scene.
export default function HeroStatic({ navigate }: { navigate: (path: string) => void }) {
  return (
    <div
      className="hero-viewport"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#0F1115', padding: 24,
      }}
    >
      <div className="hero-panel" style={{ maxWidth: 720, textAlign: 'center' }}>
        <h1 className="hero-title">INTEGRITY AT SCALE.</h1>
        <p className="hero-brief">
          AI is a mirror of your data. We ensure that mirror isn&apos;t distorted. Audit,
          explain, and correct algorithmic bias before you deploy.
        </p>
        <div className="cta-wrapper" style={{ marginTop: 28 }}>
          <button type="button" className="cta-enter" onClick={() => navigate('/dashboard')}>
            ENTER PLATFORM
          </button>
        </div>
      </div>
    </div>
  );
}
