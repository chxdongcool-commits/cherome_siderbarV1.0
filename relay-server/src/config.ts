import type { RelayConfig } from '@openclaw/shared';
import { readFileSync } from 'fs';
import { parse } from 'yaml';

interface FileConfig {
  gateway: {
    host: string;
    port: number;
  };
  pairing: {
    apiBase: string;
    deviceToken?: string;
  };
  relay: {
    host: string;
    port: number;
    tls: {
      enabled: boolean;
      keyPath?: string;
      certPath?: string;
    };
  };
  heartbeat: {
    extIntervalMs: number;
    extTimeoutMs: number;
    gwIntervalMs: number;
    gwTimeoutMs: number;
  };
}

const DEFAULT_CONFIG: FileConfig = {
  gateway: {
    host: '127.0.0.1',
    port: 18789,
  },
  pairing: {
    apiBase: 'http://127.0.0.1:18789',
  },
  relay: {
    host: '0.0.0.0',
    port: 18791,
    tls: {
      enabled: false,
    },
  },
  heartbeat: {
    extIntervalMs: 30000,
    extTimeoutMs: 60000,
    gwIntervalMs: 15000,
    gwTimeoutMs: 45000,
  },
};

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (sourceVal !== undefined) {
      if (
        sourceVal !== null &&
        targetVal !== null &&
        typeof sourceVal === 'object' &&
        !Array.isArray(sourceVal) &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal)
      ) {
        (result as T)[key] = deepMerge(targetVal as any, sourceVal as any) as T[keyof T];
      } else {
        (result as T)[key] = sourceVal as T[keyof T];
      }
    }
  }
  return result;
}

export function loadConfig(): RelayConfig {
  // Try loading from CONFIG_FILE env var or default config path
  const configPath = process.env.CONFIG_FILE || '/etc/openclaw-relay/config.yaml';

  let fileConfig: Partial<FileConfig> = {};
  try {
    const fileContent = readFileSync(configPath, 'utf8');
    fileConfig = parse(fileContent) as Partial<FileConfig>;
  } catch {
    // Config file not found, use defaults
  }

  const merged = deepMerge(DEFAULT_CONFIG, fileConfig);

  // Environment variable overrides
  // DEVICE_TOKEN: Pre-obtained device token for Gateway auth
  const deviceToken = process.env.DEVICE_TOKEN;
  if (deviceToken) {
    merged.pairing = { ...merged.pairing, deviceToken };
  }

  return {
    gateway: merged.gateway,
    pairing: merged.pairing,
    port: merged.relay.port,
    host: merged.relay.host,
    tls: merged.relay.tls,
    heartbeat: merged.heartbeat,
  };
}
