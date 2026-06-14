import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import App from './App';
import './styles/globals.css';
import { AppProvider } from './context/AppContext';
import { ChatProvider } from './context/ChatContext';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <ChatProvider>
          {/* reducedMotion="user" makes every framer-motion animation respect the OS
              "reduce motion" setting automatically. */}
          <MotionConfig reducedMotion="user">
            <App />
          </MotionConfig>
        </ChatProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
