import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { RelayConfig } from '@openclaw/shared';
import { RelayWebSocketServer } from './websocket.js';

let wsServerRef: RelayWebSocketServer | null = null;

export function setWsServerRef(wsServer: RelayWebSocketServer) {
  wsServerRef = wsServer;
}

export async function createHttpServer(_config: RelayConfig) {
  const fastify = Fastify({
    logger: false,
  });

  await fastify.register(cors, {
    origin: false,
  });

  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  fastify.get('/ready', async (_req, reply) => {
    const extCount = wsServerRef?.getExtCount() ?? 0;
    const gwConnected = wsServerRef?.isGatewayConnected() ?? false;

    reply.header('Cache-Control', 'no-store');
    return {
      status: 'ok',
      gateway: gwConnected ? 'connected' : 'disconnected',
      extensions: extCount,
    };
  });

  fastify.get('/metrics', async () => {
    const extCount = wsServerRef?.getExtCount() ?? 0;
    const gwConnected = wsServerRef?.isGatewayConnected() ?? false;

    return {
      relay_connections_active: extCount,
      relay_gateway_connected: gwConnected ? 1 : 0,
      process_uptime_seconds: process.uptime(),
      memory_usage_bytes: process.memoryUsage().heapUsed,
    };
  });

  return fastify;
}
