import { describe, it, expect, beforeEach } from 'vitest';
import { MessageRelay } from '../src/server/relay';

describe('MessageRelay', () => {
  let relay: MessageRelay;

  beforeEach(() => {
    relay = new MessageRelay();
  });

  describe('Extension Registration', () => {
    it('should register an extension', () => {
      const conn = relay.registerExt('ext-1');

      expect(conn.id).toBe('ext-1');
      expect(conn.subscribedSessions).toBeInstanceOf(Set);
      expect(conn.subscribedMessageStreams).toBeInstanceOf(Set);
    });

    it('should unregister an extension', () => {
      relay.registerExt('ext-1');
      relay.unregisterExt('ext-1');

      const allIds = relay.getAllExtIds();
      expect(allIds).not.toContain('ext-1');
    });

    it('should track multiple extensions', () => {
      relay.registerExt('ext-1');
      relay.registerExt('ext-2');
      relay.registerExt('ext-3');

      const allIds = relay.getAllExtIds();
      expect(allIds).toHaveLength(3);
    });
  });

  describe('Message Processing', () => {
    it('should process subscription request and track session', () => {
      relay.registerExt('ext-1');

      const frame = {
        type: 'req' as const,
        id: 'req-1',
        method: 'sessions.subscribe',
        params: { sessionId: 'session-1' },
      };

      const result = relay.processExtMessage('ext-1', frame);

      expect(result.toGateway).toBeDefined();
      expect(result.toGateway?.type).toBe('req');
      expect(result.toGateway?.method).toBe('sessions.subscribe');
    });

    it('should process messages.subscribe and track stream', () => {
      relay.registerExt('ext-1');

      const frame = {
        type: 'req' as const,
        id: 'req-1',
        method: 'sessions.messages.subscribe',
        params: { sessionId: 'session-1' },
      };

      relay.processExtMessage('ext-1', frame);

      const targetExts = relay.routeGwEvent({
        type: 'event',
        event: 'session.message.delta',
        payload: { sessionId: 'session-1', delta: 'Hello' },
      });

      expect(targetExts).toContain('ext-1');
    });

    it('should process unsubscribe and remove subscription', () => {
      relay.registerExt('ext-1');

      // Subscribe
      relay.processExtMessage('ext-1', {
        type: 'req',
        id: 'req-1',
        method: 'sessions.subscribe',
        params: { sessionId: 'session-1' },
      });

      // Unsubscribe
      relay.processExtMessage('ext-1', {
        type: 'req',
        id: 'req-2',
        method: 'sessions.unsubscribe',
        params: { sessionId: 'session-1' },
      });

      const targetExts = relay.routeGwEvent({
        type: 'event',
        event: 'session.message.delta',
        payload: { sessionId: 'session-1', delta: 'Hello' },
      });

      expect(targetExts).not.toContain('ext-1');
    });

    it('should route event to subscribed extensions only', () => {
      relay.registerExt('ext-1');
      relay.registerExt('ext-2');
      relay.registerExt('ext-3');

      // ext-1 subscribes to session-1
      relay.processExtMessage('ext-1', {
        type: 'req',
        id: 'req-1',
        method: 'sessions.subscribe',
        params: { sessionId: 'session-1' },
      });

      // ext-2 subscribes to session-2
      relay.processExtMessage('ext-2', {
        type: 'req',
        id: 'req-2',
        method: 'sessions.subscribe',
        params: { sessionId: 'session-2' },
      });

      const targets = relay.routeGwEvent({
        type: 'event',
        event: 'session.message.delta',
        payload: { sessionId: 'session-1', delta: 'Hello' },
      });

      expect(targets).toHaveLength(1);
      expect(targets).toContain('ext-1');
      expect(targets).not.toContain('ext-2');
      expect(targets).not.toContain('ext-3');
    });

    it('should broadcast global events to all extensions', () => {
      relay.registerExt('ext-1');
      relay.registerExt('ext-2');

      const targets = relay.routeGwEvent({
        type: 'event',
        event: 'hello-ok',
        payload: {},
      });

      expect(targets).toHaveLength(2);
      expect(targets).toContain('ext-1');
      expect(targets).toContain('ext-2');
    });

    it('should not broadcast tick events', () => {
      relay.registerExt('ext-1');

      const targets = relay.routeGwEvent({
        type: 'event',
        event: 'tick',
        payload: {},
      });

      expect(targets).toHaveLength(0);
    });
  });

  describe('Request Correlation', () => {
    it('should track pending request and return requesting extension', () => {
      relay.registerExt('ext-1');

      relay.processExtMessage('ext-1', {
        type: 'req',
        id: 'req-1',
        method: 'sessions.create',
        params: {},
      });

      expect(relay.getRequestingExt('req-1')).toBe('ext-1');
    });

    it('should clear pending request', () => {
      relay.registerExt('ext-1');

      relay.processExtMessage('ext-1', {
        type: 'req',
        id: 'req-1',
        method: 'sessions.create',
        params: {},
      });

      relay.clearPendingRequest('req-1');

      expect(relay.getRequestingExt('req-1')).toBeUndefined();
    });

    it('should return undefined for unknown request', () => {
      expect(relay.getRequestingExt('unknown-req')).toBeUndefined();
    });
  });
});
