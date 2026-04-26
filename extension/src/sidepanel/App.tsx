import { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import './styles.css';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export function App() {
  const {
    connectionState,
    messages,
    isTyping,
    setConnectionState,
    addMessage,
    appendToMessage,
    updateMessage,
    setTyping,
  } = useAppStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Connect to service worker and listen for events
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

    // Request current state
    chrome.runtime.sendMessage({ type: 'get-connection-state' }, (response) => {
      if (response?.state) {
        setConnectionState(response.state as ConnectionState);
      }
    });

    return () => {
      port.disconnect();
    };
  }, [setConnectionState]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleGatewayEvent(event: string, payload: unknown) {
    const p = payload as { sessionId?: string; messageId?: string; delta?: string };

    switch (event) {
      case 'session.message.start': {
        const msgId = p.messageId || crypto.randomUUID();
        addMessage({
          id: msgId,
          role: 'assistant',
          parts: [{ type: 'text', text: '' }],
          status: 'streaming',
          createdAt: Date.now(),
        });
        break;
      }

      case 'session.message.delta': {
        // Find the last streaming message and append
        const lastMsg = [...messages].reverse().find((m) => m.status === 'streaming');
        if (lastMsg) {
          appendToMessage(lastMsg.id, p.delta || '');
        }
        break;
      }

      case 'session.message.end': {
        const lastMsg = [...messages].reverse().find((m) => m.status === 'streaming');
        if (lastMsg) {
          updateMessage(lastMsg.id, { status: 'complete' });
        }
        setTyping(false);
        break;
      }

      case 'typing.start':
        setTyping(true);
        break;

      case 'typing.end':
        setTyping(false);
        break;

      case 'hello-ok':
        console.log('Gateway connected:', payload);
        break;
    }
  }

  async function handleSend(text: string) {
    if (!text.trim() || connectionState !== 'connected') return;

    const messageId = crypto.randomUUID();
    addMessage({
      id: messageId,
      role: 'user',
      parts: [{ type: 'text', text: text.trim() }],
      status: 'complete',
      createdAt: Date.now(),
    });

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'req',
        method: 'sessions.send',
        params: {
          sessionId: useAppStore.getState().activeSessionId,
          parts: [{ type: 'text', text: text.trim() }],
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
        <span className="header-title">OpenClaw</span>
        <ConnectionIndicator state={connectionState} />
      </header>

      <main className="messages">
        {messages.length === 0 ? (
          <div className="welcome">
            <p>Welcome to OpenClaw Sidebar</p>
            <p className="welcome-sub">
              {connectionState === 'connected'
                ? 'Select a session or start a new conversation'
                : connectionState === 'connecting'
                ? 'Connecting to server...'
                : connectionState === 'reconnecting'
                ? 'Reconnecting...'
                : 'Disconnected. Please refresh.'}
            </p>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((msg) => (
              <div key={msg.id} className={`message message-${msg.role}`}>
                <div className="message-content">
                  {msg.parts.map((part, i) => (
                    <p key={i}>{part.text}</p>
                  ))}
                  {msg.status === 'streaming' && (
                    <span className="cursor" />
                  )}
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
          placeholder={connectionState === 'connected' ? 'Type a message...' : 'Waiting for connection...'}
          rows={1}
          disabled={connectionState !== 'connected'}
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
          disabled={connectionState !== 'connected'}
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
