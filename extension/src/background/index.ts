/**
 * OpenClaw Sidebar - Service Worker
 *
 * Manages the WebSocket connection between the Extension and Relay Server.
 * The Relay Server handles Gateway authentication (device token).
 * Extension connects directly to Relay at wss://47.89.181.91:18790
 *
 * Architecture:
 *   Side Panel <---> Service Worker <---> Relay Server <---> Gateway
 */

const RELAY_URL = 'wss://47.89.181.91:18790';
const RECONNECT_DELAY_BASE = 1000;
const RECONNECT_DELAY_MAX = 30000;

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

const logger: Logger = {
  info: (msg, ...args) => console.log(`[SW] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[SW] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[SW] ${msg}`, ...args),
};

// ============================================================================
// State
// ============================================================================

let ws: WebSocket | null = null;
let connectionState: ConnectionState = 'disconnected';
let reconnectAttempt = 0;
let activeSessionId: string | null = null;

// Pending requests for RPC call/response correlation
const pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

// Port to side panel for event forwarding
let sidePanelPort: chrome.runtime.Port | null = null;

// ============================================================================
// Service Worker Lifecycle
// ============================================================================

chrome.runtime.onInstalled.addListener(() => {
  logger.info('Service Worker installed');
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'openclaw-sidebar') {
    sidePanelPort = port;
    port.onDisconnect.addListener(() => {
      sidePanelPort = null;
    });
    // Send current connection state to newly connected panel
    port.postMessage({ type: 'connection-state', state: connectionState });
  }
});

// ============================================================================
// WebSocket Connection Management
// ============================================================================

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  connectionState = 'connecting';
  broadcastConnectionState();

  logger.info('Connecting to Relay...');
  ws = new WebSocket(RELAY_URL);

  ws.onopen = () => {
    logger.info('WebSocket connected to Relay');
    connectionState = 'connected';
    reconnectAttempt = 0;
    broadcastConnectionState();
  };

  ws.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data as string) as Frame;
      handleFrame(frame);
    } catch (err) {
      logger.error('Failed to parse message', err);
    }
  };

  ws.onclose = () => {
    logger.warn('WebSocket disconnected');
    ws = null;
    connectionState = 'reconnecting';
    broadcastConnectionState();
    scheduleReconnect();
  };

  ws.onerror = () => {
    logger.error('WebSocket error');
  };
}

function scheduleReconnect() {
  const delay = Math.min(RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempt), RECONNECT_DELAY_MAX);
  reconnectAttempt++;
  logger.info(`Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempt})`);
  setTimeout(connect, delay);
}

function disconnect() {
  connectionState = 'disconnected';
  broadcastConnectionState();
  if (ws) {
    ws.close();
    ws = null;
  }
}

function broadcastConnectionState() {
  if (sidePanelPort) {
    sidePanelPort.postMessage({ type: 'connection-state', state: connectionState });
  }
}

function sendToRelay(frame: Frame) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.warn('WS not connected, dropping message');
    return false;
  }
  ws.send(JSON.stringify(frame));
  return true;
}

// ============================================================================
// Frame Handling
// ============================================================================

type Frame = { type: string; [key: string]: unknown };

function handleFrame(frame: Frame) {
  switch (frame.type) {
    case 'event':
      handleEvent(frame as EventFrame);
      break;
    case 'res':
      handleResponse(frame as ResFrame);
      break;
    default:
      logger.warn('Unknown frame type', frame.type);
  }
}

type EventFrame = Frame & { event: string; payload: unknown };
type ResFrame = Frame & { id: string; ok: boolean; payload?: unknown };

function handleEvent(frame: EventFrame) {
  // Forward all events to side panel
  if (sidePanelPort) {
    sidePanelPort.postMessage({ type: 'event', event: frame.event, payload: frame.payload });
  }

  switch (frame.event) {
    case 'hello-ok':
      logger.info('Gateway handshake complete');
      break;
    case 'tick':
      // Liveness signal, no UI update needed
      break;
    case 'session.message.delta':
      // Streaming delta - handled by side panel
      break;
    case 'session.message.start':
      // Message start
      break;
    case 'session.message.end':
      // Message end
      break;
    case 'typing.start':
    case 'typing.end':
      // Typing indicator events
      break;
    case 'sessions.changed':
      // Session list changed
      break;
  }
}

function handleResponse(frame: ResFrame) {
  const pending = pendingRequests.get(frame.id);
  if (pending) {
    pendingRequests.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      pending.reject(new Error((frame as { error?: { message: string } }).error?.message || 'Request failed'));
    }
  }
}

// ============================================================================
// Message Routing (from Side Panel to Relay)
// ============================================================================

chrome.runtime.onMessage.addListener((message, _port, sendResponse) => {
  switch (message.type) {
    case 'req': {
      const id = crypto.randomUUID();
      const frame: Frame = {
        type: 'req',
        id,
        method: message.method,
        params: message.params,
      };

      if (!sendToRelay(frame)) {
        sendResponse({ ok: false, error: { code: 'NOT_CONNECTED', message: 'Not connected to Relay' } });
        return true;
      }

      // Set up pending request with timeout
      pendingRequests.set(id, {
        resolve: (payload) => sendResponse({ ok: true, payload }),
        reject: (err) => sendResponse({ ok: false, error: { message: String(err) } }),
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          sendResponse({ ok: false, error: { code: 'TIMEOUT', message: 'Request timed out' } });
        }
      }, 30000);

      return true; // Async response
    }

    case 'ping':
      sendToRelay({ type: 'ping' });
      sendResponse({ ok: true });
      return true;

    case 'get-connection-state':
      sendResponse({ state: connectionState });
      return true;

    case 'set-active-session':
      activeSessionId = message.sessionId;
      logger.info('Active session set', activeSessionId);
      sendResponse({ ok: true });
      return true;

    default:
      return false;
  }
});

// ============================================================================
// Startup
// ============================================================================

connect();

// Keep-alive: Chrome kills idle service workers after ~30 seconds
// of no activity. We don't have persistent background pages in MV3,
// so we use a simple heartbeat to keep the SW alive.
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Send a ping frame to keep connection alive
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 25000);

logger.info('Service Worker started');
