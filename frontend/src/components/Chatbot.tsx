import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { MessageCircle, X, Send, Loader2, Bot, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { motion, AnimatePresence } from 'framer-motion';

export default function Chatbot() {
  const { isOpen, setIsOpen, messages, addMessage, contextData } = useChat();
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput('');
    addMessage({ role: 'user', content: userMsg });
    setIsLoading(true);

    try {
      const response = await api.post('/chat', {
        messages: [...messages, { role: 'user', content: userMsg }],
        context: contextData
      });

      addMessage({
        role: 'assistant',
        content: response.data.response || 'Sorry, something went wrong.'
      });
    } catch {
      addMessage({ role: 'assistant', content: 'Network error — make sure the backend is running.' });
    } finally {
      setIsLoading(false);
    }
  };

  // Build a readable context summary for the header
  const contextSection = contextData?.section as string | undefined;
  const contextDomain = contextData?.domain as string | undefined;
  const contextFairness = contextData?.overall_fairness_score as number | undefined;

  const headerSubtitle = contextSection
    ? `Asking about: ${contextSection}`
    : 'Ask anything about your audit results';

  return (
    <>
      {/* Floating circular button — always visible bottom-right */}
      <div style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
      }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Close assistant' : 'Open AI Assistant'}
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            background: isOpen
              ? 'linear-gradient(135deg, #475569 0%, #334155 100%)'
              : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 24px rgba(99, 102, 241, 0.45)',
            transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
            transform: isOpen ? 'scale(0.95)' : 'scale(1)',
          }}
        >
          {isOpen ? <X size={22} /> : <MessageCircle size={22} />}
        </button>

        {/* Unread dot when there are messages */}
        {!isOpen && messages.length > 0 && (
          <span style={{
            position: 'absolute',
            top: 2,
            right: 2,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#ef4444',
            border: '2px solid var(--bg-primary, #0f0f0f)',
          }} />
        )}
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            style={{
              position: 'fixed',
              bottom: 92,
              right: 24,
              width: 380,
              maxWidth: 'calc(100vw - 48px)',
              height: 520,
              maxHeight: 'calc(100vh - 120px)',
              background: 'var(--bg-card, #111111)',
              border: '1px solid var(--border, rgba(255,255,255,0.08))',
              borderRadius: 20,
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: 9998,
            }}
          >
            {/* Header */}
            <div style={{
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              padding: '14px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexShrink: 0,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <Bot size={18} color="rgba(255,255,255,0.9)" />
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem' }}>
                    Fairness Assistant
                  </span>
                  {contextFairness !== undefined && (
                    <span style={{
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 20,
                      padding: '1px 8px',
                      fontSize: '0.7rem',
                      color: '#fff',
                      fontWeight: 600,
                    }}>
                      Score: {Math.round(contextFairness)}
                    </span>
                  )}
                </div>
                <p style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '0.72rem',
                  margin: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {headerSubtitle}
                  {contextDomain && ` · ${contextDomain}`}
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', padding: 4, marginLeft: 8 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Context pill — shows when opened from a ? button */}
            {contextSection && (
              <div style={{
                background: 'rgba(99, 102, 241, 0.08)',
                borderBottom: '1px solid rgba(99, 102, 241, 0.15)',
                padding: '8px 14px',
                flexShrink: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={12} color="#818cf8" />
                  <span style={{ fontSize: '0.72rem', color: '#818cf8', fontWeight: 600 }}>
                    Context loaded: {contextSection}
                  </span>
                </div>
                {contextData?.description && (
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary, #6b7280)', margin: '2px 0 0 18px' }}>
                    {String(contextData.description).slice(0, 100)}
                  </p>
                )}
              </div>
            )}

            {/* Messages area */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '14px 14px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', marginTop: 32, padding: '0 16px' }}>
                  <Bot size={32} color="#4f46e5" style={{ margin: '0 auto 12px' }} />
                  <p style={{ color: 'var(--text-primary, #fff)', fontWeight: 600, marginBottom: 6, fontSize: '0.9rem' }}>
                    Hi! I'm your Fairness Assistant
                  </p>
                  <p style={{ color: 'var(--text-secondary, #9ca3af)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    {contextSection
                      ? `I have context about "${contextSection}". Ask me anything about it!`
                      : 'Click any ? icon on a card to load context, or ask me a general question about your audit.'}
                  </p>
                  {/* Quick starter prompts */}
                  <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {['What does this metric mean?', 'Is this result serious?', 'What should I fix first?'].map(q => (
                      <button
                        key={q}
                        onClick={() => { setInput(q); }}
                        style={{
                          background: 'rgba(99, 102, 241, 0.08)',
                          border: '1px solid rgba(99, 102, 241, 0.2)',
                          borderRadius: 20,
                          padding: '6px 14px',
                          fontSize: '0.75rem',
                          color: '#818cf8',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'background 0.15s',
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '82%',
                    padding: '10px 13px',
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    background: msg.role === 'user'
                      ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                      : 'var(--bg-card-inner, rgba(255,255,255,0.05))',
                    border: msg.role === 'user' ? 'none' : '1px solid var(--border, rgba(255,255,255,0.07))',
                    color: msg.role === 'user' ? '#fff' : 'var(--text-primary, #e2e8f0)',
                    fontSize: '0.82rem',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '18px 18px 18px 4px',
                    background: 'var(--bg-card-inner, rgba(255,255,255,0.05))',
                    border: '1px solid var(--border, rgba(255,255,255,0.07))',
                    display: 'flex',
                    gap: 4,
                  }}>
                    {[0, 1, 2].map(d => (
                      <span key={d} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#6366f1',
                        animation: `bounce 0.9s ${d * 0.15}s infinite`,
                      }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            <div style={{
              padding: '10px 12px',
              borderTop: '1px solid var(--border, rgba(255,255,255,0.06))',
              background: 'var(--bg-card, #111111)',
              flexShrink: 0,
            }}>
              <form
                onSubmit={e => { e.preventDefault(); handleSend(); }}
                style={{ display: 'flex', gap: 8, alignItems: 'center' }}
              >
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={contextSection ? `Ask about ${contextSection}…` : 'Ask about your fairness audit…'}
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border, rgba(255,255,255,0.1))',
                    borderRadius: 24,
                    padding: '9px 16px',
                    fontSize: '0.82rem',
                    color: 'var(--text-primary, #fff)',
                    outline: 'none',
                  }}
                  onFocus={e => (e.target.style.borderColor = '#6366f1')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border, rgba(255,255,255,0.1))')}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    border: 'none',
                    background: input.trim() && !isLoading ? '#6366f1' : 'rgba(99,102,241,0.3)',
                    cursor: input.trim() && !isLoading ? 'pointer' : 'default',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background 0.2s',
                  }}
                >
                  {isLoading
                    ? <Loader2 size={16} color="#fff" style={{ animation: 'spin 1s linear infinite' }} />
                    : <Send size={15} color="#fff" style={{ transform: 'translateX(1px)' }} />
                  }
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keyframe for the typing dots + loader spin */}
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
