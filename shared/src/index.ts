/**
 * OpenClaw Sidebar - Shared Type Definitions
 *
 * ⚠️ 重要：以下类型定义为基于 OpenClaw 文档的推测值。
 * 实际 RPC 方法名、事件名、payload 结构需在 Phase 2/3 开发时通过抓包确认。
 *
 * 文档参考：
 * - https://docs.openclaw.ai/gateway/protocol.md
 * - https://docs.openclaw.ai/concepts/streaming.md
 * - https://docs.openclaw.ai/concepts/typing-indicators
 */

// ============================================================================
// Gateway Frame Types (OpenClaw Gateway Protocol)
// ============================================================================

/**
 * Gateway Request Frame - Extension → Gateway (经 Relay 透传)
 */
export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Gateway Response Frame - Gateway → Extension (经 Relay 透传)
 */
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

/**
 * Gateway Event Frame - Gateway → Extension (经 Relay 透传，事件推送)
 */
export interface GatewayEvent {
  type: 'event';
  event: string;
  payload: unknown;
  seq?: number;
  stateVersion?: string;
}

/**
 * 三帧合一（用于 Relay 内部处理）
 */
export type GatewayFrame = GatewayRequest | GatewayResponse | GatewayEvent;

// ============================================================================
// Session RPC Methods (基于 protocol.md)
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
// Streaming Events (基于 streaming.md 和 protocol.md)
// ============================================================================

/**
 * 流式输出相关事件（session.message 事件族）
 * ⚠️ 事件名基于文档推测，实际需抓包确认
 */
export type StreamingEvent =
  | 'session.message.start'   // 流式消息开始
  | 'session.message.delta'   // 流式内容块（delta 增量）
  | 'session.message.end';    // 流式消息结束

/**
 * 工具执行相关事件
 * ⚠️ 事件名基于文档推测，实际需抓包确认
 */
export type ToolEvent =
  | 'session.tool.start'       // 工具执行开始
  | 'session.tool.delta'        // 工具执行输出
  | 'session.tool.end';        // 工具执行结束

/**
 * 会话相关事件
 */
export type SessionEvent =
  | 'sessions.changed'          // 会话列表变更（创建/删除/修改）
  | 'session.message';         // 消息/转录事件流

/**
 * Typing Indicator 相关事件
 * 基于 typing-indicators 文档，typing 是 liveness 信号
 */
export type TypingEvent =
  | 'typing.start'
  | 'typing.end';

/**
 * 系统事件
 */
export type SystemEvent =
  | 'tick'                      // 心跳保活（15s 间隔，由 policy.tickIntervalMs 定义）
  | 'heartbeat'                 // 心跳响应
  | 'hello-ok'                  // 连接握手成功（含 snapshot 快照）
  | 'shutdown';                 // Gateway 关闭通知
  | 'connect.challenge';        // 连接握手 challenge

export type GatewayEventName =
  | StreamingEvent
  | ToolEvent
  | SessionEvent
  | TypingEvent
  | SystemEvent;

// ============================================================================
// Snapshot (hello-ok payload)
// ============================================================================

export interface HelloOkPayload {
  protocolVersion: string;
  serverInfo: Record<string, unknown>;
  features: string[];
  snapshot: {
    sessions: SessionSummary[];
    presence: PresenceEntry[];
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  // ⚠️ 其他字段需抓包确认
}

export interface PresenceEntry {
  instanceId: string;
  host: string;
  ip: string;
  version: string;
  deviceFamily: string;
  mode: string;
  lastInputSeconds: number;
  reason: string;
  ts: number;
}

// ============================================================================
// Relay ↔ Extension Message Types
// ============================================================================

/**
 * Relay → Extension 的消息统一格式（简化处理）
 */
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

/**
 * Extension 侧连接状态
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error';

// ============================================================================
// Streaming Payload Types (基于 streaming.md)
// ============================================================================

/**
 * session.message.delta 的 payload 结构
 * ⚠️ 基于文档推测，实际字段需抓包确认
 */
export interface MessageDeltaPayload {
  sessionId: string;
  delta: string;  // 增量文本
  seq: number;    // 序列号，用于排序
}

/**
 * session.message.start 的 payload 结构
 * ⚠️ 基于文档推测，实际字段需抓包确认
 */
export interface MessageStartPayload {
  sessionId: string;
  messageId: string;
  seq: number;
}

/**
 * session.message.end 的 payload 结构
 * ⚠️ 基于文档推测，实际字段需抓包确认
 */
export interface MessageEndPayload {
  sessionId: string;
  messageId: string;
}

// ============================================================================
// Extension Storage Types
// ============================================================================

export interface AuthData {
  token: string;
  relayId: string;
  expiresAt: number;
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
    token: string;
  };
  heartbeat: {
    extIntervalMs: number;
    extTimeoutMs: number;
    gwIntervalMs: number;
    gwTimeoutMs: number;
  };
}
