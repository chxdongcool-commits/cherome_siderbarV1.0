import { create } from 'zustand';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  status?: 'streaming' | 'complete' | 'error';
  createdAt: number;
}

export interface MessagePart {
  type: 'text';
  text: string;
}

interface AppState {
  // Connection
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

  // Session
  activeSessionId: string | null;
  sessions: SessionMeta[];

  // Messages
  messages: Message[];

  // Typing indicator
  isTyping: boolean;

  // Actions
  setConnectionState: (state: AppState['connectionState']) => void;
  setActiveSession: (sessionId: string) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  appendToMessage: (id: string, text: string) => void;
  setTyping: (typing: boolean) => void;
  clearMessages: () => void;
}

interface SessionMeta {
  id: string;
  title: string;
  updatedAt: number;
}

export const useAppStore = create<AppState>((set) => ({
  connectionState: 'disconnected',
  activeSessionId: null,
  sessions: [],
  messages: [],
  isTyping: false,

  setConnectionState: (connectionState) => set({ connectionState }),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    })),

  appendToMessage: (id, text) =>
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== id) return msg;
        const lastPart = msg.parts[msg.parts.length - 1];
        if (lastPart?.type === 'text') {
          return {
            ...msg,
            parts: [
              ...msg.parts.slice(0, -1),
              { type: 'text', text: lastPart.text + text },
            ],
          };
        }
        return {
          ...msg,
          parts: [...msg.parts, { type: 'text' as const, text }],
        };
      }),
    })),

  setTyping: (isTyping) => set({ isTyping }),

  clearMessages: () => set({ messages: [] }),
}));
