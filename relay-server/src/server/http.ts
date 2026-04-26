import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { RelayConfig } from '@openclaw/shared';

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
  }));

  fastify.get('/ready', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', gateway: 'connected' };
  });

  fastify.get('/metrics', async () => {
    return {
      relay_connections_active: 0,
      relay_gateway_connected: 1,
    };
  });

  return fastify;
}
