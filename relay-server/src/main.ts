import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createHttpServer } from './server/http.js';
import { RelayWebSocketServer } from './server/websocket.js';

async function main() {
  const config = loadConfig();

  // HTTP server (health/metrics)
  const httpServer = await createHttpServer(config);
  await httpServer.listen({ port: 8080 });
  logger.info('HTTP server listening on :8080');

  // WebSocket server
  const wsServer = new RelayWebSocketServer(config);
  await wsServer.start();

  // graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.on(sig, async () => {
      logger.info({ signal: sig }, 'Received shutdown signal');
      await wsServer.stop();
      await httpServer.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
