import { logger } from '../../shared/src/index.js';

// Connection state
let ws: WebSocket | null = null;
let reconnectAttempt = 0;
const RECONNECT_DELAY_BASE = 1000;
const RECONNECT_DELAY_MAX = 30000;

// Extension SW port for messaging with sidepanel
const extensionPort = chrome.runtime.connect({ name: 'openclaw-sidebar' });

// ============================================================================
// WebSocket Connection Management
// ============================================================================

async function connect() {
  const { token } = await chrome.storage.local.get('auth');
  if (!token) {
    logger.error('No auth token found');
    return;
  }

  logger.info('Connecting to relay...');
  ws = new WebSocket(`wss://47.89.181.91:18790?token=${token}`);

  ws.onopen = () => {
    logger.info('WebSocket connected');
    reconnectAttempt = 0;
  };

  ws.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data);
      handleFrame(frame);
    } catch (err) {
      logger.error({ err }, 'Failed to parse message');
    }
  };

  ws.onclose = (event) => {
    logger.warn({ event }, 'WebSocket disconnected');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (event) => {
    logger.error({ event }, 'WebSocket error');
  };
}

function scheduleReconnect() {
  const delay = Math.min(RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempt), RECONNECT_DELAY_MAX);
  reconnectAttempt++;
  logger.info({ delay }, 'Scheduling reconnect');
  setTimeout(connect, delay);
}

// ============================================================================
// Frame Handling
// ============================================================================

function handleFrame(frame: { type: string; [key: string]: unknown }) {
  switch (frame.type) {
    case 'event':
      handleEvent(frame as { type: 'event'; event: string; payload: unknown });
      break;
    case 'res':
      handleResponse(frame as { type: 'res'; id: string; ok: boolean; payload?: unknown });
      break;
  }
}

function handleEvent(frame: { event: string; payload: unknown }) {
  // Forward event to sidepanel
  extensionPort.postMessage({ type: 'event', ...frame });

  switch (frame.event) {
    case 'hello-ok':
      logger.info('Gateway handshake complete');
      break;
    case 'tick':
      // Liveness keepalive, no UI update needed
      break;
  }
}

const pendingRequests = new Map<string, (res: unknown) => void>();

function handleResponse(frame: { id: string; ok: boolean; payload?: unknown }) {
  const resolve = pendingRequests.get(frame.id);
  if (resolve) {
    pendingRequests.delete(frame.id);
    resolve(frame);
  }
}

// ============================================================================
// Message Routing (from Side Panel to Relay)
// ============================================================================

chrome.runtime.onMessage.addListener((message, port) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.warn('WS not connected, queuing message');
    return false;
  }

  if (message.type === 'req') {
    const id = crypto.randomUUID();
    pendingRequests.set(id, message.resolve);
    ws.send(JSON.stringify({ type: 'req', id, method: message.method, params: message.params }));
  } else if (message.type === 'ping') {
    ws.send(JSON.stringify({ type: 'ping' }));
  }

  return true;
});

// ============================================================================
// Startup
// ============================================================================

// Lazy connect on first side panel open
chrome.sidePanel.onActivated.addListener(() => {
  if (!ws) {
    connect();
  }
});

// Also connect on service worker startup
connect();
