import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { logger } from '../logger.js';
import { MessageRelay } from './relay.js';
import { loadOrCreateDeviceKey, signData } from './pairing.js';
import type {
  RelayConfig,
  GatewayFrame,
  ConnectParams,
  ClientId,
  ClientMode,
  HelloOkPayload,
} from '@openclaw/shared';

interface ExtConnection {
  id: string;
  ws: WebSocket;
  remoteIp: string;
  connectedAt: number;
  authenticated: boolean;
  connId?: string;
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
  private relay = new MessageRelay();
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
      logger.info({ extId, remoteIp, req }, 'INCOMING EXTENSION CONNECTION');
      this.extConnections.set(extId, { id: extId, ws, remoteIp, connectedAt: Date.now(), authenticated: false });
      this.relay.registerExt(extId);
      logger.info({ extId, remoteIp }, 'Extension registered');

      ws.on('message', (data) => this.handleExtMessage(extId, data));
      ws.on('close', () => this.handleExtClose(extId));
      ws.on('error', (err) => logger.error({ extId, err }, 'Extension WS error'));
      ws.on('pong', () => {
        logger.debug({ extId }, 'Extension pong received');
      });
    });

    await this.connectToGatewayWithHandshake();
    this.startHeartbeat();

    logger.info({ port: this.config.port }, 'Relay WebSocket server started');
  }

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
            const challengePayload = frame.payload as { nonce: string; ts: number };
            logger.info({ nonce: challengePayload.nonce }, 'Received connect.challenge, sending connect request...');

            // Load device key for this relay
            const deviceKey = loadOrCreateDeviceKey();
            const signedAt = Date.now();
            const OPERATOR_TOKEN = 'fSWST0KzO4UPwwCfvsiObkHXeKCyiY2GLWueN7s0psU';
            const scopes = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'].join(',');
            // Build V2 signature payload: v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
            const payload = `v2|${deviceKey.deviceId}|cli|cli|operator|${scopes}|${signedAt}|${OPERATOR_TOKEN}|${challengePayload.nonce}`;
            const signature = signData(payload, deviceKey.privateKey);

            const connectParams: ConnectParams = {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'cli' as ClientId,
                version: '1.0.0',
                platform: 'linux',
                mode: 'cli' as ClientMode,
              },
              role: 'operator',
              scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'],
              device: {
                id: deviceKey.deviceId,
                publicKey: deviceKey.publicKey,
                signature: signature,
                signedAt: signedAt,
                nonce: challengePayload.nonce,
              },
              auth: {
                token: OPERATOR_TOKEN,
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

      const result = this.relay.processExtMessage(extId, frame);

      if (result.toGateway) {
        this.relayToGateway(result.toGateway);
      }
    } catch (err) {
      logger.error({ extId, err }, 'Failed to parse Extension message');
    }
  }

  private handleGwMessage(data: WebSocket.RawData) {
    try {
      const frame = JSON.parse(data.toString()) as GatewayFrame;
      logger.debug({ frame }, 'Gateway message');

      if (frame.type === 'event' && frame.event === 'tick') {
        logger.trace({ event: 'tick' }, 'Gateway tick');
        return;
      }

      if (frame.type === 'res') {
        // Route response to the Extension that made the request
        const extId = this.relay.getRequestingExt(frame.id);
        if (extId) {
          this.relay.clearPendingRequest(frame.id);
          const extConn = this.extConnections.get(extId);
          if (extConn && extConn.ws.readyState === WebSocket.OPEN) {
            extConn.ws.send(JSON.stringify(frame));
          }
        }
        return;
      }

      if (frame.type === 'event') {
        // Route event to subscribed Extensions
        const targetExtIds = this.relay.routeGwEvent(frame);
        for (const targetExtId of targetExtIds) {
          const extConn = this.extConnections.get(targetExtId);
          if (extConn && extConn.ws.readyState === WebSocket.OPEN) {
            extConn.ws.send(JSON.stringify(frame));
          }
        }
      }
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

  private handleExtClose(extId: string) {
    this.extConnections.delete(extId);
    this.relay.unregisterExt(extId);
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
    this.extHeartbeatTimer = setInterval(() => {
      for (const [, conn] of this.extConnections) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.ping();
        }
      }
    }, this.config.heartbeat.extIntervalMs);

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
