import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../src/sidepanel/store';

describe('AppStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useAppStore.setState({
      connectionState: 'disconnected',
      activeSessionId: null,
      sessions: [],
      messagesBySession: {},
      isTyping: false,
    });
  });

  describe('Connection State', () => {
    it('should set connection state', () => {
      expect(useAppStore.getState().connectionState).toBe('disconnected');

      useAppStore.getState().setConnectionState('connected');
      expect(useAppStore.getState().connectionState).toBe('connected');
    });
  });

  describe('Sessions', () => {
    it('should add a session', () => {
      const session = {
        id: 'session-1',
        title: 'Test Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useAppStore.getState().addSession(session);

      expect(useAppStore.getState().sessions).toHaveLength(1);
      expect(useAppStore.getState().sessions[0].id).toBe('session-1');
    });

    it('should set active session', () => {
      useAppStore.getState().setActiveSession('session-1');
      expect(useAppStore.getState().activeSessionId).toBe('session-1');
    });

    it('should update session', () => {
      const session = {
        id: 'session-1',
        title: 'Original Title',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      useAppStore.getState().addSession(session);
      useAppStore.getState().updateSession('session-1', { title: 'Updated Title' });

      expect(useAppStore.getState().sessions[0].title).toBe('Updated Title');
    });

    it('should get current messages for active session', () => {
      useAppStore.setState({
        activeSessionId: 'session-1',
        messagesBySession: {
          'session-1': [
            {
              id: 'msg-1',
              role: 'user' as const,
              parts: [{ type: 'text' as const, text: 'Hello' }],
              createdAt: Date.now(),
            },
          ],
        },
      });

      const messages = useAppStore.getState().getCurrentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-1');
    });
  });

  describe('Messages', () => {
    beforeEach(() => {
      useAppStore.getState().setActiveSession('session-1');
    });

    it('should add a message to active session', () => {
      const message = {
        id: 'msg-1',
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'Hello' }],
        status: 'complete' as const,
        createdAt: Date.now(),
      };

      useAppStore.getState().addMessage(message);

      const messages = useAppStore.getState().getCurrentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].parts[0].text).toBe('Hello');
    });

    it('should update a message', () => {
      const message = {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: '' }],
        status: 'streaming' as const,
        createdAt: Date.now(),
      };

      useAppStore.getState().addMessage(message);
      useAppStore.getState().updateMessage('session-1', 'msg-1', { status: 'complete' });

      const messages = useAppStore.getState().getCurrentMessages();
      expect(messages[0].status).toBe('complete');
    });

    it('should append to message', () => {
      const message = {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'Hello' }],
        status: 'streaming' as const,
        createdAt: Date.now(),
      };

      useAppStore.getState().addMessage(message);
      useAppStore.getState().appendToMessage('session-1', 'msg-1', ' World');

      const messages = useAppStore.getState().getCurrentMessages();
      expect(messages[0].parts[0].text).toBe('Hello World');
    });

    it('should clear messages for session', () => {
      useAppStore.setState({
        messagesBySession: {
          'session-1': [
            {
              id: 'msg-1',
              role: 'user' as const,
              parts: [{ type: 'text' as const, text: 'Hello' }],
              createdAt: Date.now(),
            },
          ],
        },
      });

      useAppStore.getState().clearMessages('session-1');

      const messages = useAppStore.getState().getCurrentMessages();
      expect(messages).toHaveLength(0);
    });
  });

  describe('Typing Indicator', () => {
    it('should set typing state', () => {
      expect(useAppStore.getState().isTyping).toBe(false);

      useAppStore.getState().setTyping(true);
      expect(useAppStore.getState().isTyping).toBe(true);
    });
  });
});
