import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import App from './App';
import './styles/globals.css';
import { AppProvider } from './context/AppContext';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        {/* reducedMotion="user" makes every framer-motion animation respect the OS
            "reduce motion" setting automatically. */}
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
