import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger } from '../logger.js';
import type { RelayConfig } from '../types.js';

export async function createHttpServer(config: RelayConfig) {
  const fastify = Fastify({
    logger: false,
  });

  await fastify.register(cors, {
    origin: false,
  });

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Ready check (includes gateway connectivity
  fastify.get('/ready', async (req, reply) => {
    // TODO: check gateway connection
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', gateway: 'connected' };
  });

  // Metrics endpoint
  fastify.get('/metrics', async () => {
    // TODO: return prometheus-format metrics
    return {
      relay_connections_active: 0,
      relay_gateway_connected: 1,
    };
  });

  return fastify;
}
