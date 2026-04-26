/**
 * OpenClaw Gateway WebSocket Pairing Flow
 *
 * 文档参考: https://docs.openclaw.ai/gateway/pairing.md
 *
 * 流程:
 * 1. 生成设备密钥对 (Ed25519)
 * 2. 连接 Gateway WebSocket，发送 connect 请求 (role: "node", 携带设备公钥)
 * 3. Gateway 返回 NOT_PAIRED (DEVICE_IDENTITY_REQUIRED)
 * 4. 调用 node.pair.request 方法发起配对请求
 * 5. Gateway 发送 node.pair.requested 事件 (表示待审批)
 * 6. 管理员运行 openclaw nodes approve <requestId> 审批
 * 7. Gateway 发送 node.pair.resolved 事件 (包含 token)
 * 8. 保存 token，用于后续连接
 */

import { sign as cryptoSign, generateKeyPairSync, createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import WebSocket from 'ws';
import { logger } from '../logger.js';

const PAIRING_TIMEOUT_MS = 300000; // 5 minutes
const DEVICE_KEY_PATH = join(homedir(), '.openclaw-relay', 'device-key.json');

/**
 * Generate a new Ed25519 key pair and compute deviceId (SHA256 of raw 32-byte public key)
 */
export function generateDeviceKey(): DeviceKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  // DeviceId = SHA256 of raw 32-byte public key
  const rawKey = (publicKey as any).export({ type: 'spki', format: 'der' }).slice(-32);
  const deviceId = createHash('sha256').update(rawKey).digest('hex');

  // Export as PEM
  const publicKeyPem = (publicKey as any).export({ type: 'spki', format: 'pem' }) as string;
  const privateKeyPem = (privateKey as any).export({ type: 'pkcs8', format: 'pem' }) as string;

  return {
    deviceId,
    publicKey: publicKeyPem,
    privateKey: privateKeyPem,
  };
}

export interface PairingResult {
  deviceToken: string;
  deviceId: string;
}

interface DeviceKey {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

/**
 * 生成或加载设备密钥对
 */
export function loadOrCreateDeviceKey(): DeviceKey {
  // Try to load from saved file first
  try {
    if (existsSync(DEVICE_KEY_PATH)) {
      const content = readFileSync(DEVICE_KEY_PATH, 'utf-8');
      const key = JSON.parse(content) as DeviceKey;
      logger.info({ deviceId: key.deviceId }, 'Loaded existing device key from file');
      return key;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load device key from file');
  }

  // Generate new key pair
  logger.info('Generating new Ed25519 device key...');
  const newDevice = generateDeviceKey();
  logger.info({ deviceId: newDevice.deviceId }, 'Generated new device key');

  // Save for future use
  try {
    const dir = join(homedir(), '.openclaw-relay');
    mkdirSync(dir, { recursive: true });
    writeFileSync(DEVICE_KEY_PATH, JSON.stringify(newDevice, null, 2));
    logger.info({ deviceId: newDevice.deviceId }, 'Saved new device key');
  } catch (err) {
    logger.error({ err }, 'Failed to save device key');
  }

  return newDevice;
}

/**
 * 对数据签名 (使用 Ed25519)
 */
export function signData(data: string, privateKey: string): string {
  // Ed25519 signing using Node.js crypto
  const signature = cryptoSign(null, Buffer.from(data), privateKey);
  return signature.toString('base64');
}

/**
 * 通过 WebSocket 连接 Gateway 并执行配对流程
 */
export async function performPairingWebSocket(
  gatewayHost: string,
  gatewayPort: number,
  onStatusChange?: (status: string) => void
): Promise<PairingResult> {
  const deviceKey = loadOrCreateDeviceKey();
  const wsUrl = `ws://${gatewayHost}:${gatewayPort}`;

  logger.info({ wsUrl, deviceId: deviceKey.deviceId }, 'Starting WebSocket pairing flow');

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let resolved = false;
    let requestId: string | null = null;
    let pairingToken: string | null = null;

    const cleanup = () => {
      if (ws) {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        ws = null;
      }
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Pairing timeout (5 minutes)'));
      }
    }, PAIRING_TIMEOUT_MS);

    const fail = (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        reject(err);
      }
    };

    try {
      ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        logger.info('WebSocket connected, waiting for challenge...');
      });

      ws.on('message', (data) => {
        try {
          const frame = JSON.parse(data.toString());

          // 1. 收到 challenge，发送带设备身份的 connect 请求发起配对
          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            const challengePayload = frame.payload as { nonce: string; ts: number };
            logger.info({ nonce: challengePayload.nonce }, 'Received connect.challenge, sending connect request with device identity...');

            // Sign the server-provided nonce (not a self-generated one)
            const signedAt = Date.now();
            const signDataStr = `${deviceKey.deviceId}:${challengePayload.nonce}:${challengePayload.ts}:${signedAt}`;
            const signature = signData(signDataStr, deviceKey.privateKey);

            ws!.send(JSON.stringify({
              type: 'req',
              id: 'relay-connect',
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: 'cli',
                  version: '1.0.0',
                  platform: 'linux',
                  mode: 'cli',
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
              },
            }));
          }
          // 2. 收到 connect 响应
          else if (frame.type === 'res' && frame.id === 'relay-connect') {
            if (!frame.ok) {
              const errorCode = frame.error?.code;
              const errorDetails = frame.error?.details;

              logger.error({ errorCode, errorDetails }, 'Connect rejected - pairing required but not implemented');
              fail(new Error(`Connect rejected: ${frame.error?.message}`));
            } else {
              // 连接成功 (已配对)
              logger.info({ connId: frame.payload?.server?.connId }, 'Already paired, connection successful');
              resolved = true;
              clearTimeout(timeout);

              // 提取 token
              const auth = frame.payload?.auth;
              if (auth?.deviceToken) {
                saveToken(auth.deviceToken);
                resolve({ deviceToken: auth.deviceToken, deviceId: deviceKey.deviceId });
              } else {
                fail(new Error('No device token in successful connection'));
              }
            }
          }
          // 3. node.pair.request 响应
          else if (frame.type === 'res' && frame.id === requestId) {
            if (frame.ok) {
              const payload = frame.payload as { requestId?: string; status?: string };
              pairingToken = payload.requestId || null;
              logger.info({ pairingToken }, 'Pairing request submitted, awaiting admin approval...');
              onStatusChange?.('awaiting_approval');
            } else {
              logger.error({ error: frame.error }, 'Pairing request failed');
              fail(new Error(`Pairing request failed: ${frame.error?.message}`));
            }
          }
          // 4. 收到 node.pair.requested 事件 (表示配对请求已被记录)
          else if (frame.type === 'event' && frame.event === 'node.pair.requested') {
            const payload = frame.payload as { requestId?: string };
            logger.info({ requestId: payload.requestId }, 'Gateway received pairing request, waiting for approval...');
            onStatusChange?.('awaiting_approval');
          }
          // 5. 收到 node.pair.resolved 事件 (审批结果)
          else if (frame.type === 'event' && frame.event === 'node.pair.resolved') {
            const payload = frame.payload as {
              requestId?: string;
              status?: 'approved' | 'rejected' | 'expired';
              token?: string;
              error?: string;
            };

            if (payload.status === 'approved' && payload.token) {
              logger.info('Pairing approved by admin!');
              onStatusChange?.('approved');
              saveToken(payload.token);
              resolved = true;
              clearTimeout(timeout);
              resolve({ deviceToken: payload.token, deviceId: deviceKey.deviceId });
            } else if (payload.status === 'rejected') {
              fail(new Error('Pairing was rejected by admin'));
            } else if (payload.status === 'expired') {
              fail(new Error('Pairing request expired'));
            } else {
              logger.warn({ payload }, 'Unknown node.pair.resolved payload');
            }
          }
          // 其他事件
          else if (frame.type === 'event') {
            logger.debug({ event: frame.event, payload: frame.payload }, 'Received event');
          }
        } catch (err) {
          logger.error({ err }, 'Error processing message');
        }
      });

      ws.on('error', (err) => {
        logger.error({ err }, 'WebSocket error');
        fail(err);
      });

      ws.on('close', () => {
        if (!resolved) {
          fail(new Error('WebSocket closed unexpectedly'));
        }
      });

    } catch (err) {
      fail(err as Error);
    }
  });
}

const TOKEN_PATH = join(homedir(), '.openclaw-relay', 'device-token');

function saveToken(token: string): void {
  try {
    const dir = join(homedir(), '.openclaw-relay');
    require('fs').mkdirSync(dir, { recursive: true });
    require('fs').writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
    logger.info('Device token saved');
  } catch (err) {
    logger.error({ err }, 'Failed to save token');
  }
}

export function loadSavedToken(): string | null {
  try {
    if (existsSync(TOKEN_PATH)) {
      return readFileSync(TOKEN_PATH, 'utf-8').trim();
    }
  } catch (err) {
    // ignore
  }
  return null;
}
