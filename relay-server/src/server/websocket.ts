import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../logger.js';
import type { RelayConfig, GatewayFrame } from '../types.js';

interface ExtConnection {
  id: string;
  ws: WebSocket;
  remoteIp: string;
  connectedAt: number;
}

interface GwConnection {
  ws: WebSocket | null;
  connectedAt: number | null;
  authenticated: boolean;
}

export class RelayWebSocketServer {
  private extConnections = new Map<string, ExtConnection>();
  private gwConn: GwConnection = { ws: null, connectedAt: null, authenticated: false };
  private config: RelayConfig;
  private wss: WebSocketServer | null = null;
  private extHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private gwHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RelayConfig) {
    this.config = config;
  }

  async start() {
    this.wss = new WebSocketServer({ port: this.config.port, host: this.config.host });

    this.wss.on('connection', (ws, req) => {
      const extId = crypto.randomUUID();
      const remoteIp = req.socket.remoteAddress || 'unknown';
      this.extConnections.set(extId, { id: extId, ws, remoteIp, connectedAt: Date.now() });
      logger.info({ extId, remoteIp }, 'Extension connected');

      ws.on('message', (data) => this.handleExtMessage(extId, data));
      ws.on('close', () => this.handleExtClose(extId));
      ws.on('error', (err) => logger.error({ extId, err }, 'Extension WS error'));
    });

    // Connect to Gateway
    await this.connectToGateway();

    this.startHeartbeat();

    logger.info({ port: this.config.port }, 'WebSocket server started');
  }

  private async connectToGateway() {
    const { host, port, token } = this.config.gateway;
    const url = `ws://${host}:${port}`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      ws.on('open', () => {
        this.gwConn = { ws, connectedAt: Date.now(), authenticated: true };
        logger.info({ host, port }, 'Connected to Gateway');
        resolve();
      });

      ws.on('message', (data) => this.handleGwMessage(data));
      ws.on('close', () => this.handleGwClose());
      ws.on('error', (err) => {
        logger.error({ err }, 'Gateway WS error');
        reject(err);
      });

      // timeout
      setTimeout(() => reject(new Error('Gateway connection timeout')), 10000);
    });
  }

  private handleExtMessage(extId: string, data: WebSocket.RawData) {
    try {
      const frame = JSON.parse(data.toString()) as GatewayFrame;
      logger.debug({ extId, frame }, 'Extension message');
      this.relayToGateway(extId, frame);
    } catch (err) {
      logger.error({ extId, err }, 'Failed to parse Extension message');
    }
  }

  private handleGwMessage(data: WebSocket.RawData) {
    try {
      const frame = JSON.parse(data.toString()) as GatewayFrame;
      logger.debug({ frame }, 'Gateway message');
      this.relayToExtensions(frame);
    } catch (err) {
      logger.error({ err }, 'Failed to parse Gateway message');
    }
  }

  private relayToGateway(extId: string, frame: GatewayFrame) {
    if (!this.gwConn.ws || this.gwConn.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ extId }, 'Gateway not connected, dropping message');
      return;
    }
    this.gwConn.ws.send(JSON.stringify(frame));
  }

  private relayToExtensions(frame: GatewayFrame) {
    for (const [extId, conn] of this.extConnections) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify(frame));
      }
    }
  }

  private handleExtClose(extId: string) {
    this.extConnections.delete(extId);
    logger.info({ extId }, 'Extension disconnected');
  }

  private handleGwClose() {
    this.gwConn = { ws: null, connectedAt: null, authenticated: false };
    logger.warn('Gateway disconnected, will attempt reconnect');
    setTimeout(() => this.reconnectGateway(), 5000);
  }

  private async reconnectGateway() {
    try {
      await this.connectToGateway();
    } catch {
      setTimeout(() => this.reconnectGateway(), 10000);
    }
  }

  private startHeartbeat() {
    // Extension heartbeat
    this.extHeartbeatTimer = setInterval(() => {
      for (const [extId, conn] of this.extConnections) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.ping();
        }
      }
    }, this.config.heartbeat.extIntervalMs);

    // Gateway heartbeat
    this.gwHeartbeatTimer = setInterval(() => {
      if (this.gwConn.ws && this.gwConn.ws.readyState === WebSocket.OPEN) {
        this.gwConn.ws.ping();
      }
    }, this.config.heartbeat.gwIntervalMs);
  }

  async stop() {
    if (this.extHeartbeatTimer) clearInterval(this.extHeartbeatTimer);
    if (this.gwHeartbeatTimer) clearInterval(this.gwHeartbeatTimer);
    this.wss?.close();
    this.gwConn.ws?.terminate();
    logger.info('Relay WebSocket server stopped');
  }
}
