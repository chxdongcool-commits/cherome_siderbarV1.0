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

import { randomUUID, generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import WebSocket from 'ws';
import { logger } from '../logger.js';

const PAIRING_TIMEOUT_MS = 300000; // 5 minutes
const DEVICE_KEY_PATH = join(homedir(), '.openclaw-relay', 'device-key.json');

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
  try {
    if (existsSync(DEVICE_KEY_PATH)) {
      const content = readFileSync(DEVICE_KEY_PATH, 'utf-8');
      const key = JSON.parse(content) as DeviceKey;
      logger.info({ deviceId: key.deviceId }, 'Loaded existing device key');
      return key;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load device key, creating new one');
  }

  // 生成新密钥对 (使用 Ed25519)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  // Ed25519 公钥是 32 字节，转换为 base64 作为 deviceId
  const deviceId = publicKey.export({ type: 'spki', format: 'der' }).slice(-32).toString('base64');
  const key: DeviceKey = {
    deviceId,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };

  // 确保目录存在
  const dir = join(homedir(), '.openclaw-relay');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(DEVICE_KEY_PATH, JSON.stringify(key, null, 2));
    logger.info({ deviceId }, 'Generated new device key');
  } catch (err) {
    logger.error({ err }, 'Failed to save device key');
  }

  return key;
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

          // 1. 收到 challenge，尝试 backend 模式连接
          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            logger.info('Received connect.challenge, sending backend mode connect request...');

            ws!.send(JSON.stringify({
              type: 'req',
              id: 'relay-connect',
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: 'gateway-client',
                  version: '1.0.0',
                  platform: 'linux',
                  mode: 'backend',
                },
              },
            }));
          }
          // 2. 收到 connect 响应
          else if (frame.type === 'res' && frame.id === 'relay-connect') {
            if (!frame.ok) {
              const errorCode = frame.error?.code;
              const errorDetails = frame.error?.details;

              // NOT_PAIRED - 需要发起配对请求
              if (errorCode === 'NOT_PAIRED' || errorDetails?.code === 'DEVICE_IDENTITY_REQUIRED') {
                logger.info('Device not paired, initiating pairing request...');
                onStatusChange?.('pending');

                // 发送 node.pair.request
                requestId = randomUUID();
                ws!.send(JSON.stringify({
                  type: 'req',
                  id: requestId,
                  method: 'node.pair.request',
                  params: {
                    device: {
                      id: deviceKey.deviceId,
                      publicKey: deviceKey.publicKey,
                    },
                    metadata: {
                      platform: 'linux',
                      clientVersion: '1.0.0',
                      relayServer: true,
                    },
                  },
                }));
              } else {
                logger.error({ error: frame.error }, 'Connect rejected');
                fail(new Error(`Connect rejected: ${frame.error?.message}`));
              }
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
