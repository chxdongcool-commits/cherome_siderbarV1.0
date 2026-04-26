/**
 * OpenClaw Gateway Pairing Flow
 *
 * Gateway requires device identity (DEVICE_IDENTITY_REQUIRED).
 * This module implements the pairing flow to obtain a device token.
 *
 * Flow:
 * 1. POST /v1/claws/pair/request → { pairing_code, pairing_token, expires_at }
 * 2. User approves in Gateway UI (openclaw Control UI at http://127.0.0.1:18792)
 * 3. Poll GET /v1/claws/pair/status?token=<pairing_token>
 * 4. When status='paired', extract token field as device token
 * 5. Store device token in config.pairing.deviceToken
 */

import { logger } from '../logger.js';
import type { RelayConfig } from '@openclaw/shared';
import type { PairingRequestResponse, PairingStatusResponse } from '@openclaw/shared';

const PAIRING_POLL_INTERVAL_MS = 2000;
const PAIRING_POLL_TIMEOUT_MS = 300000; // 5 minutes

export interface PairingResult {
  deviceToken: string;
  expiresAt?: number;
}

/**
 * Request a new pairing code from Gateway
 */
export async function requestPairingCode(config: RelayConfig): Promise<PairingRequestResponse> {
  const url = `${config.pairing.apiBase}/v1/claws/pair/request`;

  logger.info({ url }, 'Requesting pairing code from Gateway...');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Pairing request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as PairingRequestResponse;
  logger.info({ pairingCode: data.pairing_code, expiresAt: data.expires_at }, 'Received pairing code');
  return data;
}

/**
 * Poll Gateway for pairing status until paired, expired, or rejected
 */
export async function pollPairingStatus(
  config: RelayConfig,
  pairingToken: string,
  onStatusChange?: (status: PairingStatusResponse['status']) => void
): Promise<PairingResult> {
  const url = `${config.pairing.apiBase}/v1/claws/pair/status?token=${encodeURIComponent(pairingToken)}`;

  logger.info('Starting to poll for pairing status...');

  const startTime = Date.now();
  let lastStatus: string | undefined;

  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (Date.now() - startTime > PAIRING_POLL_TIMEOUT_MS) {
        reject(new Error('Pairing timeout - no response from Gateway'));
        return;
      }

      try {
        const response = await fetch(url);

        if (!response.ok) {
          logger.warn({ status: response.status }, 'Pairing status poll failed, retrying...');
          setTimeout(poll, PAIRING_POLL_INTERVAL_MS);
          return;
        }

        const data = (await response.json()) as PairingStatusResponse;

        if (data.status !== lastStatus) {
          logger.info({ status: data.status }, 'Pairing status update');
          lastStatus = data.status;
          onStatusChange?.(data.status);
        }

        switch (data.status) {
          case 'paired':
            if (!data.token) {
              reject(new Error('Pairing succeeded but no token returned'));
              return;
            }
            logger.info({ clawId: data.claw_id }, 'Pairing successful!');
            resolve({
              deviceToken: data.token,
              expiresAt: data.expires_at,
            });
            break;

          case 'pending':
            setTimeout(poll, PAIRING_POLL_INTERVAL_MS);
            break;

          case 'expired':
            reject(new Error('Pairing code expired'));
            break;

          case 'rejected':
            reject(new Error('Pairing was rejected'));
            break;

          default:
            logger.warn({ status: data.status }, 'Unknown pairing status');
            setTimeout(poll, PAIRING_POLL_INTERVAL_MS);
        }
      } catch (err) {
        logger.error({ err }, 'Error polling pairing status');
        setTimeout(poll, PAIRING_POLL_INTERVAL_MS);
      }
    };

    poll();
  });
}

/**
 * Full pairing flow: request code → wait for user → poll status → return token
 */
export async function performPairing(config: RelayConfig): Promise<PairingResult> {
  logger.info('=== Starting Gateway Pairing Flow ===');
  logger.info('This flow is required to connect to OpenClaw Gateway.');
  logger.info(`Gateway UI: ${config.pairing.apiBase.replace('18789', '18792')}/#pairing`);
  logger.info('Or use: openclaw control-ui');

  // Step 1: Request pairing code
  const { pairing_code, pairing_token, expires_at } = await requestPairingCode(config);

  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║            OPENCLAW GATEWAY PAIRING REQUIRED              ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Pairing Code: ${pairing_code.padEnd(42)}║`);
  console.log(`║  Expires in: ${formatExpiry(expires_at).padEnd(45)}║`);
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  Steps to pair:                                            ║');
  console.log('║    1. Open Gateway UI (see above)                          ║');
  console.log('║    2. Go to Settings → Devices → Add Device                ║');
  console.log('║    3. Enter the pairing code above                          ║');
  console.log('║    4. Wait for approval...                                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\nPolling for pairing status...\n');

  // Step 2: Poll for status
  const result = await pollPairingStatus(config, pairing_token);

  console.log('✓ Pairing completed! Device token obtained.\n');

  return result;
}

function formatExpiry(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((timestamp - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}
