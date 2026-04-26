import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createHttpServer } from './server/http.js';
import { RelayWebSocketServer } from './server/websocket.js';
import { performPairing } from './server/pairing.js';

async function main() {
  const config = loadConfig();

  // Check if device token exists (from env var or config file)
  if (!config.pairing.deviceToken) {
    logger.info('No device token found, starting pairing flow...');
    try {
      const result = await performPairing(config);
      config.pairing.deviceToken = result.deviceToken;
      logger.info('Device token obtained. Save this token and restart with DEVICE_TOKEN env var for future runs.');
      logger.info(`DEVICE_TOKEN=${result.deviceToken}`);
    } catch (err) {
      logger.error({ err }, 'Pairing failed');
      process.exit(1);
    }
  } else {
    logger.info('Using existing device token from config/env');
  }

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
