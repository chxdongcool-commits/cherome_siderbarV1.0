/**
 * Message Relay Module
 *
 * Handles bidirectional message routing between Extensions and Gateway.
 * Key responsibilities:
 * - Track session subscriptions per Extension
 * - Correlate RPC request/response pairs
 * - Route Gateway events to the appropriate subscribed Extensions
 *
 * Gateway Protocol:
 * - Extension sends RPC requests (type: 'req', id: string)
 * - Gateway responds with RPC responses (type: 'res', id: string)
 * - Gateway sends events (type: 'event', event: string)
 *
 * Two subscription types:
 * - sessions.subscribe: subscribes to session change events (sessions.changed)
 * - sessions.messages.subscribe: subscribes to message stream (session.message.*)
 */

import { logger } from '../logger.js';
import type {
  GatewayFrame,
  GatewayRequest,
  GatewayResponse,
  GatewayEvent,
} from '@openclaw/shared';

export interface ExtConnection {
  id: string;
  subscribedSessions: Set<string>;
  subscribedMessageStreams: Set<string>;
}

export class MessageRelay {
  private extSubscriptions = new Map<string, ExtConnection>();
  private pendingRequests = new Map<string, string>();  // reqId -> extId

  registerExt(extId: string): ExtConnection {
    const conn: ExtConnection = {
      id: extId,
      subscribedSessions: new Set(),
      subscribedMessageStreams: new Set(),
    };
    this.extSubscriptions.set(extId, conn);
    logger.debug({ extId }, 'Extension registered for message relay');
    return conn;
  }

  unregisterExt(extId: string) {
    this.extSubscriptions.delete(extId);
    for (const [reqId, eid] of this.pendingRequests) {
      if (eid === extId) {
        this.pendingRequests.delete(reqId);
      }
    }
    logger.debug({ extId }, 'Extension unregistered from message relay');
  }

  /**
   * Process an incoming message from an Extension.
   * For subscription requests: track locally AND forward to Gateway.
   * For other requests: forward to Gateway.
   * Returns the frame to relay to Gateway (if any).
   */
  processExtMessage(
    extId: string,
    frame: GatewayFrame
  ): { toGateway?: GatewayFrame; localResponse?: GatewayResponse } {
    if (frame.type !== 'req') {
      return { toGateway: frame };
    }

    const req = frame as GatewayRequest;

    // Track subscriptions and forward all requests to Gateway
    switch (req.method) {
      case 'sessions.subscribe': {
        const sessionId = (req.params as { sessionId: string }).sessionId;
        this.extSubscriptions.get(extId)?.subscribedSessions.add(sessionId);
        logger.info({ extId, sessionId }, 'Extension subscribed to session');
        break;
      }
      case 'sessions.messages.subscribe': {
        const sessionId = (req.params as { sessionId: string }).sessionId;
        this.extSubscriptions.get(extId)?.subscribedMessageStreams.add(sessionId);
        logger.info({ extId, sessionId }, 'Extension subscribed to message stream');
        break;
      }
      case 'sessions.unsubscribe': {
        const sessionId = (req.params as { sessionId: string }).sessionId;
        this.extSubscriptions.get(extId)?.subscribedSessions.delete(sessionId);
        this.extSubscriptions.get(extId)?.subscribedMessageStreams.delete(sessionId);
        logger.info({ extId, sessionId }, 'Extension unsubscribed from session');
        break;
      }
    }

    // Track request for response correlation
    this.pendingRequests.set(req.id, extId);

    // Forward to Gateway with original request ID
    return { toGateway: req };
  }

  /**
   * Get the Extension ID that made a given request
   */
  getRequestingExt(reqId: string): string | undefined {
    return this.pendingRequests.get(reqId);
  }

  /**
   * Clear a pending request after response is routed
   */
  clearPendingRequest(reqId: string) {
    this.pendingRequests.delete(reqId);
  }

  /**
   * Route a Gateway event to all Extensions subscribed to the relevant session
   */
  routeGwEvent(frame: GatewayEvent): string[] {
    const eventName = frame.event;
    const payload = frame.payload as { sessionId?: string } | undefined;
    const sessionId = payload?.sessionId;

    const targetedExts: string[] = [];

    if (sessionId) {
      for (const [extId, conn] of this.extSubscriptions) {
        if (conn.subscribedSessions.has(sessionId) || conn.subscribedMessageStreams.has(sessionId)) {
          targetedExts.push(extId);
        }
      }
    } else if (eventName !== 'tick' && eventName !== 'heartbeat') {
      for (const [extId] of this.extSubscriptions) {
        targetedExts.push(extId);
      }
    }

    if (targetedExts.length > 0) {
      logger.debug({ event: eventName, sessionId, extCount: targetedExts.length }, 'Routing event to Extensions');
    }

    return targetedExts;
  }

  getAllExtIds(): string[] {
    return Array.from(this.extSubscriptions.keys());
  }
}
