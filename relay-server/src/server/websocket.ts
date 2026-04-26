import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { logger } from '../logger.js';
import type {
  RelayConfig,
  GatewayFrame,
  ConnectParams,
  ClientId,
  ClientMode,
  HelloOkPayload,
} from '../types.js';

interface ExtConnection {
  id: string;
  ws: WebSocket;
  remoteIp: string;
  connectedAt: number;
  authenticated: boolean;
  connId?: string;  // from hello-ok
}

interface GwConnection {
  ws: WebSocket | null;
  connectedAt: number | null;
  authenticated: boolean;
  connId?: string;
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
      const extId = randomUUID();
      const remoteIp = req.socket.remoteAddress || 'unknown';
      this.extConnections.set(extId, { id: extId, ws, remoteIp, connectedAt: Date.now(), authenticated: false });
      logger.info({ extId, remoteIp }, 'Extension connected');

      ws.on('message', (data) => this.handleExtMessage(extId, data));
      ws.on('close', () => this.handleExtClose(extId));
      ws.on('error', (err) => logger.error({ extId, err }, 'Extension WS error'));
      ws.on('pong', () => {
        logger.debug({ extId }, 'Extension pong received');
      });
    });

    // Connect to Gateway (with proper handshake)
    await this.connectToGatewayWithHandshake();

    this.startHeartbeat();

    logger.info({ port: this.config.port }, 'Relay WebSocket server started');
  }

  /**
   * Complete connect handshake with Gateway:
   * 1. WS connect
   * 2. Receive connect.challenge (nonce)
   * 3. Send connect req with ConnectParams
   * 4. Receive hello-ok
   */
  private async connectToGatewayWithHandshake(): Promise<void> {
    const { host, port } = this.config.gateway;
    const url = `ws://${host}:${port}`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let resolved = false;

      const cleanup = () => {
        ws.removeAllListeners();
      };

      ws.on('open', async () => {
        logger.info({ host, port }, 'WS connected to Gateway, waiting for challenge...');
      });

      ws.on('message', (data) => {
        if (resolved) return;

        try {
          const frame = JSON.parse(data.toString()) as GatewayFrame;

          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            // Step 2: Got challenge, send connect request
            logger.info('Received connect.challenge, sending connect request...');

            const connectParams: ConnectParams = {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'openclaw-probe' as ClientId,
                version: '1.0.0',
                platform: 'linux',
                mode: 'probe' as ClientMode,
              },
            };

            ws.send(JSON.stringify({
              type: 'req',
              id: 'relay-connect',
              method: 'connect',
              params: connectParams,
            }));

          } else if (frame.type === 'res' && frame.id === 'relay-connect') {
            cleanup();

            if (!frame.ok) {
              logger.error({ error: frame.error }, 'Gateway rejected connect');
              ws.close();
              reject(new Error(`Connect rejected: ${frame.error?.message}`));
              return;
            }

            // Step 4: hello-ok received
            const helloOk = frame.payload as HelloOkPayload;
            logger.info({ connId: helloOk.server.connId, methods: helloOk.features.methods.length }, 'Received hello-ok, Gateway handshake complete');

            this.gwConn = {
              ws,
              connectedAt: Date.now(),
              authenticated: true,
              connId: helloOk.server.connId,
            };

            ws.on('message', (d) => this.handleGwMessage(d));
            ws.on('close', () => this.handleGwClose());
            ws.on('error', (err) => logger.error({ err }, 'Gateway WS error'));
            ws.on('pong', () => logger.debug('Gateway pong received'));

            resolved = true;
            resolve();

          } else {
            logger.warn({ frame }, 'Unexpected frame during handshake');
          }
        } catch (err) {
          logger.error({ err }, 'Failed to process handshake message');
          if (!resolved) {
            ws.close();
            reject(err);
          }
        }
      });

      ws.on('error', (err) => {
        logger.error({ err }, 'Gateway WS error during handshake');
        if (!resolved) reject(err);
      });

      ws.on('close', () => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Gateway closed during handshake'));
        }
      });

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          cleanup();
          ws.close();
          reject(new Error('Gateway handshake timeout'));
        }
      }, 15000);
    });
  }

  private handleExtMessage(extId: string, data: WebSocket.RawData) {
    try {
      const frame = JSON.parse(data.toString()) as GatewayFrame;
      logger.debug({ extId, frame }, 'Extension message');

      // For now, pass through all frames to Gateway
      // Auth check can be added later
      this.relayToGateway(frame);
    } catch (err) {
      logger.error({ extId, err }, 'Failed to parse Extension message');
    }
  }

  private handleGwMessage(data: WebSocket.RawData) {
    try {
      const frame = JSON.parse(data.toString()) as GatewayFrame;
      logger.debug({ frame }, 'Gateway message');

      if (frame.type === 'event' && frame.event === 'tick') {
        // tick is very frequent, log at trace level only
        logger.trace({ event: 'tick' }, 'Gateway tick');
      }

      this.relayToExtensions(frame);
    } catch (err) {
      logger.error({ err }, 'Failed to parse Gateway message');
    }
  }

  private relayToGateway(frame: GatewayFrame) {
    if (!this.gwConn.ws || this.gwConn.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Gateway not connected, dropping message');
      return;
    }
    this.gwConn.ws.send(JSON.stringify(frame));
  }

  private relayToExtensions(frame: GatewayFrame) {
    for (const [extId, conn] of this.extConnections) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.send(JSON.stringify(frame));
        } catch (err) {
          logger.error({ extId, err }, 'Failed to send to Extension');
        }
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
      await this.connectToGatewayWithHandshake();
      logger.info('Gateway reconnected successfully');
    } catch (err) {
      logger.error({ err }, 'Gateway reconnect failed, retrying...');
      setTimeout(() => this.reconnectGateway(), 10000);
    }
  }

  private startHeartbeat() {
    // Extension heartbeat (ping/pong)
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
