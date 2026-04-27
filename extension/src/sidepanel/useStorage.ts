import { useEffect } from 'react';
import { useAppStore } from './store';
import {
  initDB,
  getSessions,
  getMessages,
  getMeta,
  saveSession,
  saveMessage,
} from './storage';

export function useStorageSync() {
  const {
    setSessions,
    setActiveSession,
    activeSessionId,
    sessions,
  } = useAppStore();

  // Initialize storage and load data on mount
  useEffect(() => {
    async function init() {
      try {
        await initDB();

        // Load sessions
        const storedSessions = await getSessions();
        setSessions(storedSessions);

        // Load active session ID
        const storedActiveId = await getMeta<string>('activeSessionId');
        if (storedActiveId && storedSessions.some((s) => s.id === storedActiveId)) {
          setActiveSession(storedActiveId);
        }
      } catch (err) {
        console.error('Failed to initialize storage:', err);
      }
    }

    init();
  }, [setSessions, setActiveSession]);

  // Persist active session ID when it changes
  useEffect(() => {
    if (activeSessionId) {
      saveSession({
        id: activeSessionId,
        title: sessions.find((s) => s.id === activeSessionId)?.title || 'Untitled',
        createdAt: sessions.find((s) => s.id === activeSessionId)?.createdAt || Date.now(),
        updatedAt: Date.now(),
      }).catch(console.error);
    }
  }, [activeSessionId, sessions]);

  // Load messages when active session changes
  useEffect(() => {
    async function loadMessages() {
      if (!activeSessionId) return;

      try {
        const messages = await getMessages(activeSessionId);
        // Clear current messages for this session first
        useAppStore.setState((state) => {
          const { [activeSessionId]: _, ...rest } = state.messagesBySession;
          return {
            messagesBySession: {
              ...rest,
              [activeSessionId]: messages.map((m) => ({
                id: m.id,
                role: m.role,
                parts: m.parts,
                status: m.status,
                createdAt: m.createdAt,
              })),
            },
          };
        });
      } catch (err) {
        console.error('Failed to load messages:', err);
      }
    }

    loadMessages();
  }, [activeSessionId]);

  // Save messages to IndexedDB when they change
  useEffect(() => {
    if (!activeSessionId) return;

    const messages = useAppStore.getState().messagesBySession[activeSessionId] || [];
    for (const msg of messages) {
      if (!msg?.id) continue;
      saveMessage({
        id: msg.id,
        sessionId: activeSessionId,
        role: msg.role || 'assistant',
        parts: msg.parts || [],
        status: msg.status,
        createdAt: msg.createdAt || Date.now(),
      }).catch(console.error);
    }
  }, [activeSessionId]);

  // Save session list when sessions change
  useEffect(() => {
    for (const session of sessions) {
      saveSession(session).catch(console.error);
    }
  }, [sessions]);
}
