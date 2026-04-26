/**
 * OpenClaw Sidebar - Shared Type Definitions
 *
 * ✅ 已通过抓包验证的类型（来自 frames.d.ts）
 * ⚠️ 待抓包验证的类型已标注
 *
 * 文档参考：
 * - /usr/lib/node_modules/openclaw/dist/plugin-sdk/src/gateway/protocol/schema/frames.d.ts
 * - https://docs.openclaw.ai/gateway/protocol.md
 * - https://docs.openclaw.ai/concepts/streaming.md
 */

// ============================================================================
// Gateway Frame Types (OpenClaw Gateway Protocol)
// ============================================================================

export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface GatewayResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface GatewayEvent {
  type: 'event';
  event: string;
  payload: unknown;
  seq?: number;
  stateVersion?: string;
}

export type GatewayFrame = GatewayRequest | GatewayResponse | GatewayEvent;

// ============================================================================
// Connect Params (✅ 已验证)
// ============================================================================

/** client.id 的有效枚举值 */
export type ClientId =
  | 'cli'
  | 'webchat'
  | 'test'
  | 'webchat-ui'
  | 'openclaw-control-ui'
  | 'openclaw-tui'
  | 'gateway-client'
  | 'openclaw-macos'
  | 'openclaw-ios'
  | 'openclaw-android'
  | 'node-host'
  | 'fingerprint'
  | 'openclaw-probe';

/** client.mode 的有效枚举值 */
export type ClientMode = 'cli' | 'node' | 'webchat' | 'ui' | 'test' | 'backend' | 'probe';

/** ✅ 已验证的 Connect Params（来自 frames.d.ts） */
export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: ClientId;
    displayName?: string;
    version: string;
    platform: string;
    deviceFamily?: string;
    modelIdentifier?: string;
    mode: ClientMode;
    instanceId?: string;
  };
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  pathEnv?: string;
  role?: string;
  scopes?: string[];
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
  auth?: {
    token?: string;
    bootstrapToken?: string;
    deviceToken?: string;
    password?: string;
  };
  locale?: string;
  userAgent?: string;
}

// ============================================================================
// Hello Ok (✅ 已验证)
// ============================================================================

export interface HelloOkPayload {
  type: 'hello-ok';
  protocol: number;
  server: {
    version: string;
    connId: string;
  };
  features: {
    methods: string[];
    events: string[];
  };
  snapshot: {
    presence: PresenceEntry[];
    health: unknown;
    stateVersion: {
      presence: number;
      health: number;
    };
    uptimeMs: number;
    configPath?: string;
    stateDir?: string;
    sessionDefaults?: {
      defaultAgentId: string;
      mainKey: string;
      mainSessionKey: string;
      scope?: string;
    };
    authMode?: 'none' | 'token' | 'password' | 'trusted-proxy';
    updateAvailable?: {
      currentVersion: string;
      latestVersion: string;
      channel: string;
    };
  };
  canvasHostUrl?: string;
  auth?: {
    deviceToken: string;
    role: string;
    scopes: string[];
    issuedAtMs?: number;
    deviceTokens?: Array<unknown>;
  };
}

export interface PresenceEntry {
  instanceId: string;
  host?: string;
  ip?: string;
  version?: string;
  platform?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode?: string;
  lastInputSeconds?: number;
  reason?: string;
  tags?: string[];
  text?: string;
  ts: number;
  deviceId?: string;
  roles?: string[];
  scopes?: string[];
}

// ============================================================================
// Session RPC Methods (⚠️ 待抓包确认)
// ============================================================================

export interface SessionsCreateParams {
  sessionId?: string;
  deliver?: boolean;
}

export interface SessionsSendParams {
  sessionId: string;
  parts: MessagePart[];
}

export interface SessionsSubscribeParams {
  sessionId: string;
}

export interface SessionsMessagesSubscribeParams {
  sessionId: string;
}

export interface SessionsUnsubscribeParams {
  sessionId: string;
}

// ============================================================================
// Message Types
// ============================================================================

export type MessagePart = TextPart | ImagePart;

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  url: string;
  alt?: string;
}

// ============================================================================
// Streaming Events (⚠️ 待抓包确认事件名)
// ============================================================================

export type StreamingEvent =
  | 'session.message.start'
  | 'session.message.delta'
  | 'session.message.end';

export type ToolEvent =
  | 'session.tool.start'
  | 'session.tool.delta'
  | 'session.tool.end';

export type SessionEvent =
  | 'sessions.changed'
  | 'session.message';

export type TypingEvent =
  | 'typing.start'
  | 'typing.end';

export type SystemEvent =
  | 'tick'
  | 'heartbeat'
  | 'hello-ok'
  | 'shutdown'
  | 'connect.challenge';

export type GatewayEventName =
  | StreamingEvent
  | ToolEvent
  | SessionEvent
  | TypingEvent
  | SystemEvent;

// ============================================================================
// Pairing API (chrome-openclaw-sider 使用的方式)
// ============================================================================

/**
 * Extension → Relay → Gateway 配对流程
 * 1. Extension 请求配对码
 * 2. 用户在 Gateway UI 确认
 * 3. Extension 轮询配对状态，获取 token
 * 4. 用 token 建立 WebSocket 连接
 *
 * ⚠️ 实际测试发现：Gateway 要求 DEVICE_IDENTITY_REQUIRED
 * 即使用 device token 认证，或走 pairing 流程获取 token
 */

export interface PairingRequestResponse {
  pairing_code: string;
  pairing_token: string;
  expires_at: number;
}

export interface PairingStatusResponse {
  status: 'pending' | 'paired' | 'expired' | 'rejected';
  claw_id?: string;
  token?: string;
  expires_at?: number;
}

// ============================================================================
// Relay ↔ Extension Message Types
// ============================================================================

export interface RelayMessage {
  type: 'req' | 'res' | 'event';
  requestId: string;
  method?: string;
  eventType?: string;
  payload: unknown;
  ok?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error';

// ============================================================================
// Streaming Payload Types (⚠️ 待抓包确认 payload 结构)
// ============================================================================

export interface MessageDeltaPayload {
  sessionId: string;
  delta: string;
  seq: number;
}

export interface MessageStartPayload {
  sessionId: string;
  messageId: string;
  seq: number;
}

export interface MessageEndPayload {
  sessionId: string;
  messageId: string;
}

// ============================================================================
// Extension Storage Types
// ============================================================================

export interface AuthData {
  token: string;
  deviceToken: string;
  expiresAt: number;
  clawId: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface StorageSchema {
  auth: AuthData | null;
  activeSessionId: string | null;
  sessionMetaList: SessionMeta[];
}

// ============================================================================
// Config Types
// ============================================================================

export interface RelayConfig {
  port: number;
  host: string;
  tls: {
    enabled: boolean;
    keyPath?: string;
    certPath?: string;
  };
  gateway: {
    host: string;
    port: number;
  };
  pairing: {
    apiBase: string;  // e.g. http://127.0.0.1:18789
  };
  heartbeat: {
    extIntervalMs: number;
    extTimeoutMs: number;
    gwIntervalMs: number;
    gwTimeoutMs: number;
  };
}
