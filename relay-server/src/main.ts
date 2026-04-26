import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createHttpServer } from './server/http.js';
import { RelayWebSocketServer } from './server/websocket.js';
import { performPairingWebSocket, loadSavedToken } from './server/pairing.js';

async function main() {
  const config = loadConfig();

  // Check if device token exists (from env var, config file, or saved token)
  const savedToken = loadSavedToken();
  const envToken = process.env.DEVICE_TOKEN;
  const tokenToUse = envToken || savedToken || config.pairing.deviceToken;

  if (!tokenToUse) {
    logger.info('No device token found, starting WebSocket pairing flow...');
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       OPENCLAW RELAY - GATEWAY PAIRING REQUIRED           ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  The relay needs to be paired with the Gateway.           ║');
    console.log('║                                                        ║');
    console.log('║  After the relay starts, you must approve it:           ║');
    console.log('║    1. On the gateway server, run:                        ║');
    console.log('║       openclaw nodes list                                ║');
    console.log('║    2. Find the pending pairing request                  ║');
    console.log('║    3. Run: openclaw nodes approve <requestId>            ║');
    console.log('║                                                        ║');
    console.log('║  The relay will auto-retry until pairing is approved.    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('\n');

    try {
      const result = await performPairingWebSocket(
        config.gateway.host,
        config.gateway.port,
        (status) => {
          logger.info({ status }, 'Pairing status update');
        }
      );
      logger.info({ deviceId: result.deviceId }, 'Pairing successful!');
      config.pairing.deviceToken = result.deviceToken;
    } catch (err) {
      logger.error({ err }, 'Pairing failed');
      process.exit(1);
    }
  } else {
    if (envToken) {
      logger.info('Using device token from DEVICE_TOKEN env var');
    } else if (savedToken) {
      logger.info('Using saved device token');
      config.pairing.deviceToken = savedToken;
    } else {
      logger.info('Using device token from config');
      config.pairing.deviceToken = tokenToUse;
    }
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
