import { useEffect, useRef, useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppStore, type Message } from './store';
import { useStorageSync } from './useStorage';
import './styles.css';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export function App() {
  const {
    connectionState,
    activeSessionId,
    sessions,
    isTyping,
    setConnectionState,
    setActiveSession,
    addSession,
    updateSession,
    setSessions,
    getCurrentMessages,
    addMessage,
    updateMessage,
    appendToMessage,
    setTyping,
  } = useAppStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize storage and sync with IndexedDB
  useStorageSync();

  // Sync messages when active session changes
  useEffect(() => {
    setMessages(getCurrentMessages());
  }, [activeSessionId, getCurrentMessages]);

  // Keep messages in sync with store
  useEffect(() => {
    const interval = setInterval(() => {
      setMessages(getCurrentMessages());
    }, 100);
    return () => clearInterval(interval);
  }, [getCurrentMessages]);

  const handleGatewayEvent = useCallback((event: string, payload: unknown) => {
    const p = payload as { sessionKey?: string; runId?: string; seq?: number; state?: string; message?: unknown; errorMessage?: string; sessionId?: string };
    const state = useAppStore.getState();

    switch (event) {
      case 'session.message.start': {
        const sessionKey = p.sessionKey || state.activeSessionId;
        if (!sessionKey) break;
        setTyping(true);
        break;
      }

      case 'session.message.delta': {
        const sessionKey = p.sessionKey || state.activeSessionId;
        if (!sessionKey) break;

        const messageContent = p.message as { parts?: { type: string; text?: string }[]; content?: { type: string; text?: string }[] } | undefined;
        const parts = messageContent?.parts || messageContent?.content || [];
        const text = parts
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('') || '';
        if (!text) break;

        const sessionMessages = state.messagesBySession[sessionKey] || [];
        let lastMsg: Message | undefined;
        for (let i = sessionMessages.length - 1; i >= 0; i--) {
          if (sessionMessages[i].status === 'streaming') {
            lastMsg = sessionMessages[i];
            break;
          }
        }

        if (lastMsg) {
          updateMessage(sessionKey, lastMsg.id, { parts: [{ type: 'text', text }] });
        } else {
          const msgId = p.runId || crypto.randomUUID();
          const msg: Message = {
            id: msgId,
            role: 'assistant',
            parts: [{ type: 'text', text }],
            status: 'streaming',
            createdAt: Date.now(),
          };
          addMessage(msg);
        }
        break;
      }

      case 'session.message.end': {
        const sessionKey = p.sessionKey || state.activeSessionId;
        if (!sessionKey) break;

        const sessionMessages = state.messagesBySession[sessionKey] || [];
        let lastMsg: Message | undefined;
        for (let i = sessionMessages.length - 1; i >= 0; i--) {
          if (sessionMessages[i].status === 'streaming') {
            lastMsg = sessionMessages[i];
            break;
          }
        }
        if (lastMsg) {
          updateMessage(sessionKey, lastMsg.id, { status: 'complete' });
        }
        setTyping(false);
        break;
      }

      case 'chat': {
        const sessionKey = p.sessionKey || state.activeSessionId;
        if (!sessionKey) break;

        const chatState = p.state as 'delta' | 'final' | 'aborted' | 'error' | undefined;
        const messageContent = p.message as { parts?: { type: string; text?: string }[]; content?: { type: string; text?: string }[] } | undefined;

        if (chatState === 'delta') {
          // Extract all text from content (snapshot mode - each delta has full text)
          const parts = messageContent?.parts || messageContent?.content || [];
          const text = parts
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('') || '';
          if (!text) break;

          const currentState = useAppStore.getState();
          const sessionMessages = currentState.messagesBySession[sessionKey] || [];
          // Find streaming message without mutating array
          let lastMsg: Message | undefined;
          for (let i = sessionMessages.length - 1; i >= 0; i--) {
            if (sessionMessages[i].status === 'streaming') {
              lastMsg = sessionMessages[i];
              break;
            }
          }

          if (lastMsg) {
            // Snapshot mode: REPLACE text instead of append
            updateMessage(sessionKey, lastMsg.id, {
              parts: [{ type: 'text', text }],
            });
          } else {
            const msgId = p.runId || crypto.randomUUID();
            const msg: Message = {
              id: msgId,
              role: 'assistant',
              parts: [{ type: 'text', text }],
              status: 'streaming',
              createdAt: Date.now(),
            };
            addMessage(msg);
          }
        } else if (chatState === 'final') {
          const currentState = useAppStore.getState();
          const sessionMessages = currentState.messagesBySession[sessionKey] || [];
          let lastMsg: Message | undefined;
          for (let i = sessionMessages.length - 1; i >= 0; i--) {
            if (sessionMessages[i].status === 'streaming') {
              lastMsg = sessionMessages[i];
              break;
            }
          }
          if (lastMsg) {
            updateMessage(sessionKey, lastMsg.id, { status: 'complete' });
          }
          setTyping(false);
        } else if (chatState === 'error' || chatState === 'aborted') {
          const currentState = useAppStore.getState();
          const sessionMessages = currentState.messagesBySession[sessionKey] || [];
          let lastMsg: Message | undefined;
          for (let i = sessionMessages.length - 1; i >= 0; i--) {
            if (sessionMessages[i].status === 'streaming') {
              lastMsg = sessionMessages[i];
              break;
            }
          }
          if (lastMsg) {
            updateMessage(sessionKey, lastMsg.id, { status: 'error' });
          }
          setTyping(false);
        }
        break;
      }

      case 'sessions.changed': {
        chrome.runtime.sendMessage({ type: 'get-sessions' }, (response) => {
          if (response?.sessions) {
            setSessions(response.sessions);
          }
        });
        break;
      }

      case 'typing.start':
        setTyping(true);
        break;

      case 'typing.end':
        setTyping(false);
        break;

      case 'hello-ok':
        chrome.runtime.sendMessage({ type: 'get-sessions' }, (response) => {
          if (response?.sessions) {
            setSessions(response.sessions);
          }
        });
        break;

      case 'error':
      case 'session.error': {
        const sessionId = state.activeSessionId;
        if (!sessionId) break;
        const sessionMessages = state.messagesBySession[sessionId] || [];
        const streaming = sessionMessages.find((m) => m.status === 'streaming');
        if (streaming) {
          updateMessage(sessionId, streaming.id, { status: 'error' });
        }
        setTyping(false);
        break;
      }
    }
  }, [addMessage, appendToMessage, updateMessage, setTyping, setSessions]);

  // Connect to service worker
  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'openclaw-sidebar' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'connection-state') {
        setConnectionState(msg.state as ConnectionState);
        return;
      }

      if (msg.type === 'event') {
        handleGatewayEvent(msg.event, msg.payload);
      }
    });

    port.onDisconnect.addListener(() => {
      setConnectionState('disconnected');
    });

    chrome.runtime.sendMessage({ type: 'get-connection-state' }, (response) => {
      if (response?.state) {
        setConnectionState(response.state as ConnectionState);
        // If already connected, trigger sessions fetch as if we received hello-ok
        if (response.state === 'connected') {
          chrome.runtime.sendMessage({ type: 'get-sessions' }, (sessionsResponse) => {
            if (sessionsResponse?.sessions) {
              setSessions(sessionsResponse.sessions);
            }
          });
        }
      }
    });

    return () => {
      port.disconnect();
    };
  }, [setConnectionState, handleGatewayEvent]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function createNewSession() {
    // Use Gateway session key format: agent:main:<uuid>
    const sessionId = `agent:main:${crypto.randomUUID()}`;
    const newSession = {
      id: sessionId,
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    addSession(newSession);
    setActiveSession(sessionId);
    setShowSessionList(false);
  }

  async function handleSend(text: string) {
    if (!text.trim() || connectionState !== 'connected') return;

    const sessionId = useAppStore.getState().activeSessionId;
    if (!sessionId) return;

    const messageId = crypto.randomUUID();
    const msg: Message = {
      id: messageId,
      role: 'user',
      parts: [{ type: 'text', text: text.trim() }],
      status: 'complete',
      createdAt: Date.now(),
    };

    addMessage(msg);

    // Update session title from first message
    const sessionMessages = useAppStore.getState().messagesBySession[sessionId] || [];
    if (sessionMessages.length === 1) {
      const title = text.trim().substring(0, 30) + (text.length > 30 ? '...' : '');
      updateSession(sessionId, { title, updatedAt: Date.now() });
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'req',
        method: 'chat.send',
        params: {
          sessionKey: sessionId,
          message: text.trim(),
          idempotencyKey: crypto.randomUUID(),
        },
      });

      if (!response.ok) {
        console.error('Send failed:', response.error);
      }
    } catch (err) {
      console.error('Send error:', err);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <button className="session-toggle" onClick={() => setShowSessionList(!showSessionList)}>
          ☰
        </button>
        <span className="header-title">
          {activeSessionId
            ? sessions.find((s) => s.id === activeSessionId)?.title || 'OpenClaw'
            : 'OpenClaw'}
        </span>
        <ConnectionIndicator state={connectionState} />
      </header>

      {showSessionList && (
        <div className="session-list">
          <div className="session-list-header">
            <span>Conversations</span>
            <button className="new-session-btn" onClick={createNewSession}>
              + New
            </button>
          </div>
          <div className="session-items">
            {sessions.length === 0 ? (
              <div className="no-sessions">No conversations yet</div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => {
                    setActiveSession(session.id);
                    setShowSessionList(false);
                  }}
                >
                  <span className="session-title">{session.title}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <main className="messages">
        {!activeSessionId ? (
          <div className="welcome">
            <p>Welcome to OpenClaw Sidebar</p>
            <p className="welcome-sub">
              {connectionState === 'connected' ? (
                <>
                  <button className="start-chat-btn" onClick={createNewSession}>
                    Start a conversation
                  </button>
                </>
              ) : connectionState === 'connecting' ? (
                'Connecting to server...'
              ) : connectionState === 'reconnecting' ? (
                'Reconnecting...'
              ) : (
                'Disconnected. Please refresh.'
              )}
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="welcome">
            <p>Start a conversation</p>
            <p className="welcome-sub">Type a message below to begin</p>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((msg) => (
              <div key={msg.id} className={`message message-${msg.role}`}>
                <div className="message-content">
                  {msg.parts.map((part, i) =>
                    part.type === 'text' ? (
                      <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} className="markdown-content">
                        {part.text}
                      </ReactMarkdown>
                    ) : null
                  )}
                  {msg.status === 'streaming' && <span className="cursor" />}
                  {msg.status === 'error' && <span className="error-badge">Error</span>}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="message message-assistant">
                <div className="message-content">
                  <span className="typing-indicator">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      <footer className="input-area">
        <textarea
          className="input-box"
          placeholder={
            activeSessionId
              ? connectionState === 'connected'
                ? 'Type a message...'
                : 'Waiting for connection...'
              : 'Start a new conversation first'
          }
          rows={1}
          disabled={connectionState !== 'connected' || !activeSessionId}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const target = e.target as HTMLTextAreaElement;
              handleSend(target.value);
              target.value = '';
            }
          }}
        />
        <button
          className="send-btn"
          disabled={connectionState !== 'connected' || !activeSessionId}
          onClick={() => {
            const input = document.querySelector('.input-box') as HTMLTextAreaElement;
            if (input?.value) {
              handleSend(input.value);
              input.value = '';
            }
          }}
        >
          Send
        </button>
      </footer>
    </div>
  );
}

function ConnectionIndicator({ state }: { state: ConnectionState }) {
  const stateStyles: Record<ConnectionState, string> = {
    connected: 'status-connected',
    connecting: 'status-connecting',
    reconnecting: 'status-reconnecting',
    disconnected: 'status-disconnected',
  };

  const stateLabels: Record<ConnectionState, string> = {
    connected: 'Connected',
    connecting: 'Connecting...',
    reconnecting: 'Reconnecting...',
    disconnected: 'Disconnected',
  };

  return (
    <span className={`connection-status ${stateStyles[state]}`}>
      <span className="status-dot" />
      {stateLabels[state]}
    </span>
  );
}
