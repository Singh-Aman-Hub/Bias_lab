import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatContextType {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  contextData: Record<string, any>;
  setContextData: (data: Record<string, any>) => void;
  updateContext: (key: string, value: any) => void;
  clearMessages: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contextData, setContextData] = useState<Record<string, any>>({});

  const addMessage = (msg: ChatMessage) => {
    setMessages(prev => [...prev, msg]);
  };

  const updateContext = (key: string, value: any) => {
    setContextData(prev => ({ ...prev, [key]: value }));
  };

  const clearMessages = () => {
    setMessages([]);
  };

  return (
    <ChatContext.Provider value={{
      isOpen, setIsOpen, messages, addMessage, contextData, setContextData, updateContext, clearMessages
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
