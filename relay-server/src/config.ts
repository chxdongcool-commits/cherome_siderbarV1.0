import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';
import type { RelayConfig } from './types.js';

const CONFIG_PATH = process.env.CONFIG_PATH || '/opt/openclaw-relay/config.yml';

export function loadConfig(): RelayConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return parse(raw) as RelayConfig;
  } catch {
    // default config for development
    return {
      port: 18791,
      host: '0.0.0.0',
      tls: {
        enabled: process.env.TLS_ENABLED === 'true',
        keyPath: process.env.TLS_KEY_PATH,
        certPath: process.env.TLS_CERT_PATH,
      },
      gateway: {
        host: '127.0.0.1',
        port: 18789,
        token: process.env.GATEWAY_TOKEN || 'b5cd1af01f5a5330ddf36554a080a5ee887799f75648a738',
      },
      heartbeat: {
        extIntervalMs: 20000,
        extTimeoutMs: 60000,
        gwIntervalMs: 15000,
        gwTimeoutMs: 45000,
      },
    };
  }
}
