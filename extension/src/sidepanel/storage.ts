/**
 * IndexedDB Storage for OpenClaw Sidebar
 *
 * Persists:
 * - Sessions metadata (sessionMetaList)
 * - Messages per session (messages_<sessionId>)
 * - Active session ID
 * - Auth data
 */

const DB_NAME = 'openclaw-sidebar';
const DB_VERSION = 2;

const STORES = {
  SESSIONS: 'sessions',
  MESSAGES: 'messages',
  AUTH: 'auth',
  META: 'meta',
} as const;

let db: IDBDatabase | null = null;

export async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error('Failed to open database'));

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      const transaction = (event.target as IDBOpenDBRequest).transaction;

      // Sessions store
      if (!database.objectStoreNames.contains(STORES.SESSIONS)) {
        database.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
      }

      // Messages store (keyed by id, with sessionId index)
      if (!database.objectStoreNames.contains(STORES.MESSAGES)) {
        const messagesStore = database.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
        messagesStore.createIndex('sessionId', 'sessionId', { unique: false });
      } else if (transaction) {
        // Add index if it doesn't exist (for existing databases)
        try {
          const messagesStore = transaction.objectStore(STORES.MESSAGES);
          if (!messagesStore.indexNames.contains('sessionId')) {
            messagesStore.createIndex('sessionId', 'sessionId', { unique: false });
          }
        } catch (e) {
          console.warn('[Storage] Could not add sessionId index:', e);
        }
      }

      // Auth store
      if (!database.objectStoreNames.contains(STORES.AUTH)) {
        database.createObjectStore(STORES.AUTH, { keyPath: 'key' });
      }

      // Meta store (activeSessionId, etc)
      if (!database.objectStoreNames.contains(STORES.META)) {
        database.createObjectStore(STORES.META, { keyPath: 'key' });
      }
    };
  });
}

// ============================================================================
// Sessions
// ============================================================================

export interface StoredSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export async function saveSession(session: StoredSession): Promise<void> {
  if (!session?.id) return;
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORES.SESSIONS, 'readwrite');
    const store = tx.objectStore(STORES.SESSIONS);
    const request = store.put(session);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getSessions(): Promise<StoredSession[]> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORES.SESSIONS, 'readonly');
    const store = tx.objectStore(STORES.SESSIONS);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const results = (request.result as StoredSession[]).sort(
        (a, b) => b.updatedAt - a.updatedAt
      );
      resolve(results);
    };
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([STORES.SESSIONS, STORES.MESSAGES], 'readwrite');

    // Delete session
    const sessionStore = tx.objectStore(STORES.SESSIONS);
    sessionStore.delete(sessionId);

    // Delete messages
    const messagesStore = tx.objectStore(STORES.MESSAGES);
    const index = messagesStore.index('sessionId');
    const request = index.openCursor(IDBKeyRange.only(sessionId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
// Messages
// ============================================================================

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  parts: { type: 'text'; text: string }[];
  status?: 'streaming' | 'complete' | 'error';
  createdAt: number;
}

export async function saveMessage(message: StoredMessage): Promise<void> {
  if (!message?.id || !message?.sessionId) return;
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORES.MESSAGES, 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    const request = store.put(message);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORES.MESSAGES, 'readonly');
    const store = tx.objectStore(STORES.MESSAGES);
    const index = store.index('sessionId');
    const request = index.getAll(IDBKeyRange.only(sessionId));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const results = (request.result as StoredMessage[]).sort(
        (a, b) => a.createdAt - b.createdAt
      );
      resolve(results);
    };
  });
}

export async function clearMessages(sessionId: string): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORES.MESSAGES, 'readwrite');
    const store = tx.objectStore(STORES.MESSAGES);
    const index = store.index('sessionId');
    const request = index.openCursor(IDBKeyRange.only(sessionId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================================
// Meta (activeSessionId, etc)
// ============================================================================

export async function getMeta<T>(key: string): Promise<T | null> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORES.META, 'readonly');
    const store = tx.objectStore(STORES.META);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      resolve(request.result?.value ?? null);
    };
  });
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  if (!key) return;
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORES.META, 'readwrite');
    const store = tx.objectStore(STORES.META);
    const request = store.put({ key, value });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// ============================================================================
// Auth
// ============================================================================

export interface StoredAuth {
  token: string;
  deviceToken: string;
  expiresAt: number;
  clawId: string;
}

export async function getAuth(): Promise<StoredAuth | null> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORES.AUTH, 'readonly');
    const store = tx.objectStore(STORES.AUTH);
    const request = store.get('auth');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      resolve(request.result ?? null);
    };
  });
}

export async function setAuth(auth: StoredAuth): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORES.AUTH, 'readwrite');
    const store = tx.objectStore(STORES.AUTH);
    const request = store.put({ key: 'auth', ...auth });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
