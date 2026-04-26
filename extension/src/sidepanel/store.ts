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

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface AppState {
  // Connection
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

  // Session
  activeSessionId: string | null;
  sessions: SessionMeta[];

  // Messages (keyed by sessionId for multi-session support)
  messagesBySession: Record<string, Message[]>;

  // Typing indicator
  isTyping: boolean;

  // Actions
  setConnectionState: (state: AppState['connectionState']) => void;
  setActiveSession: (sessionId: string | null) => void;
  addSession: (session: SessionMeta) => void;
  updateSession: (sessionId: string, updates: Partial<SessionMeta>) => void;
  setSessions: (sessions: SessionMeta[]) => void;

  // Message actions
  getCurrentMessages: () => Message[];
  addMessage: (message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  appendToMessage: (sessionId: string, messageId: string, text: string) => void;
  clearMessages: (sessionId?: string) => void;

  setTyping: (typing: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  connectionState: 'disconnected',
  activeSessionId: null,
  sessions: [],
  messagesBySession: {},
  isTyping: false,

  setConnectionState: (connectionState) => set({ connectionState }),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
    })),

  updateSession: (sessionId, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates } : s
      ),
    })),

  setSessions: (sessions) => set({ sessions }),

  getCurrentMessages: () => {
    const state = get();
    if (!state.activeSessionId) return [];
    return state.messagesBySession[state.activeSessionId] || [];
  },

  addMessage: (message) =>
    set((state) => {
      const sessionId = state.activeSessionId;
      if (!sessionId) return state;

      const sessionMessages = state.messagesBySession[sessionId] || [];
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...sessionMessages, message],
        },
      };
    }),

  updateMessage: (sessionId, messageId, updates) =>
    set((state) => {
      const sessionMessages = state.messagesBySession[sessionId] || [];
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: sessionMessages.map((msg) =>
            msg.id === messageId ? { ...msg, ...updates } : msg
          ),
        },
      };
    }),

  appendToMessage: (sessionId, messageId, text) =>
    set((state) => {
      const sessionMessages = state.messagesBySession[sessionId] || [];
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: sessionMessages.map((msg) => {
            if (msg.id !== messageId) return msg;
            const lastPart = msg.parts[msg.parts.length - 1];
            if (lastPart?.type === 'text') {
              return {
                ...msg,
                parts: [
                  ...msg.parts.slice(0, -1),
                  { type: 'text' as const, text: lastPart.text + text },
                ],
              };
            }
            return {
              ...msg,
              parts: [...msg.parts, { type: 'text' as const, text }],
            };
          }),
        },
      };
    }),

  clearMessages: (sessionId) =>
    set((state) => {
      if (sessionId) {
        const { [sessionId]: _, ...rest } = state.messagesBySession;
        return { messagesBySession: rest };
      }
      return { messagesBySession: {} };
    }),

  setTyping: (isTyping) => set({ isTyping }),
}));
