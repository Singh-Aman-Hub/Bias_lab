import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import App from './App';
import './styles/globals.css';
import { AppProvider } from './context/AppContext';
import { ChatProvider } from './context/ChatContext';
import { AuthProvider } from './context/AuthContext';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <ChatProvider>
            {/* reducedMotion="user" makes every framer-motion animation respect the OS
                "reduce motion" setting automatically. */}
            <MotionConfig reducedMotion="user">
              <App />
            </MotionConfig>
          </ChatProvider>
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

