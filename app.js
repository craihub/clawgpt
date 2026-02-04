// ClawGPT - ChatGPT-like interface for OpenClaw
// https://github.com/openclaw/openclaw

// IndexedDB wrapper for chat storage
class ChatStorage {
  constructor() {
    this.dbName = 'clawgpt';
    this.dbVersion = 1;
    this.storeName = 'chats';
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => {
        console.warn('IndexedDB not available, falling back to localStorage');
        this.useFallback = true;
        resolve(null);
      };
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
    });
  }

  async loadAll() {
    // Migrate from localStorage if needed
    const legacyData = localStorage.getItem('clawgpt-chats');
    
    if (this.useFallback) {
      return legacyData ? JSON.parse(legacyData) : {};
    }

    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      
      request.onsuccess = () => {
        const chats = {};
        request.result.forEach(chat => {
          chats[chat.id] = chat;
        });
        
        // If IndexedDB is empty but localStorage has data, migrate it
        if (Object.keys(chats).length === 0 && legacyData) {
          const legacy = JSON.parse(legacyData);
          this.saveAll(legacy).then(() => {
            // Clear localStorage after successful migration
            localStorage.removeItem('clawgpt-chats');
            console.log('Migrated chats from localStorage to IndexedDB');
          });
          resolve(legacy);
        } else {
          resolve(chats);
        }
      };
      
      request.onerror = () => {
        console.error('Failed to load chats from IndexedDB');
        resolve(legacyData ? JSON.parse(legacyData) : {});
      };
    });
  }

  async saveAll(chats) {
    if (this.useFallback) {
      localStorage.setItem('clawgpt-chats', JSON.stringify(chats));
      return;
    }

    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      // Clear and re-add all (simple approach)
      store.clear();
      
      Object.values(chats).forEach(chat => {
        store.put(chat);
      });
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.error('Failed to save chats to IndexedDB, using localStorage fallback');
        localStorage.setItem('clawgpt-chats', JSON.stringify(chats));
        resolve();
      };
    });
  }

  async saveOne(chat) {
    if (this.useFallback) {
      const all = JSON.parse(localStorage.getItem('clawgpt-chats') || '{}');
      all[chat.id] = chat;
      localStorage.setItem('clawgpt-chats', JSON.stringify(all));
      return;
    }

    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.put(chat);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async deleteOne(chatId) {
    if (this.useFallback) {
      const all = JSON.parse(localStorage.getItem('clawgpt-chats') || '{}');
      delete all[chatId];
      localStorage.setItem('clawgpt-chats', JSON.stringify(all));
      return;
    }

    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.delete(chatId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

// ClawGPT Memory - File-based persistent storage for cross-device sync
// This writes messages to files that can be accessed by external tools (like OpenClaw agents)
class FileMemoryStorage {
  constructor() {
    this.dirHandle = null;
    this.dbName = 'clawgpt-file-handles';
    this.db = null;
    this.enabled = false;
    this.pendingWrites = [];
    this.writeDebounce = null;
  }

  async init() {
    // Check if File System Access API is available
    if (!('showDirectoryPicker' in window)) {
      console.log('FileMemoryStorage: File System Access API not available');
      return false;
    }

    // Try to restore saved directory handle
    await this.initDB();
    const restored = await this.restoreHandle();
    if (restored) {
      this.enabled = true;
      console.log('FileMemoryStorage: Restored saved directory handle');
    }
    return this.enabled;
  }

  async initDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = () => resolve(null);
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'id' });
        }
      };
    });
  }

  async restoreHandle() {
    if (!this.db) return false;

    return new Promise(async (resolve) => {
      try {
        const tx = this.db.transaction(['handles'], 'readonly');
        const store = tx.objectStore('handles');
        const req = store.get('memoryDir');
        
        req.onsuccess = async () => {
          if (req.result?.handle) {
            // Verify we still have permission
            const permission = await req.result.handle.queryPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
              this.dirHandle = req.result.handle;
              resolve(true);
            } else {
              // Try to request permission
              const newPermission = await req.result.handle.requestPermission({ mode: 'readwrite' });
              if (newPermission === 'granted') {
                this.dirHandle = req.result.handle;
                resolve(true);
              } else {
                resolve(false);
              }
            }
          } else {
            resolve(false);
          }
        };
        req.onerror = () => resolve(false);
      } catch (e) {
        console.warn('FileMemoryStorage: Error restoring handle:', e);
        resolve(false);
      }
    });
  }

  async selectDirectory() {
    try {
      this.dirHandle = await window.showDirectoryPicker({
        id: 'clawgpt-memory',
        mode: 'readwrite',
        startIn: 'documents'
      });

      // Save handle for persistence
      if (this.db) {
        const tx = this.db.transaction(['handles'], 'readwrite');
        tx.objectStore('handles').put({ id: 'memoryDir', handle: this.dirHandle });
      }

      this.enabled = true;
      console.log('FileMemoryStorage: Directory selected:', this.dirHandle.name);
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('FileMemoryStorage: Error selecting directory:', e);
      }
      return false;
    }
  }

  async writeMessage(message) {
    if (!this.enabled || !this.dirHandle) return;

    this.pendingWrites.push(message);
    
    // Debounce writes to batch them
    if (this.writeDebounce) clearTimeout(this.writeDebounce);
    this.writeDebounce = setTimeout(() => this.flushWrites(), 1000);
  }

  async flushWrites() {
    if (!this.enabled || !this.dirHandle || this.pendingWrites.length === 0) return;

    const toWrite = [...this.pendingWrites];
    this.pendingWrites = [];

    try {
      // Group messages by date
      const byDate = {};
      for (const msg of toWrite) {
        const date = new Date(msg.timestamp).toISOString().split('T')[0];
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(msg);
      }

      // Write to date-based files
      for (const [date, messages] of Object.entries(byDate)) {
        await this.appendToDateFile(date, messages);
      }
    } catch (e) {
      console.error('FileMemoryStorage: Error writing messages:', e);
      // Put messages back in queue
      this.pendingWrites = [...toWrite, ...this.pendingWrites];
    }
  }

  async appendToDateFile(date, messages) {
    const filename = `${date}.jsonl`;
    
    try {
      // Get or create file
      const fileHandle = await this.dirHandle.getFileHandle(filename, { create: true });
      
      // Read existing content
      const file = await fileHandle.getFile();
      const existingContent = await file.text();
      
      // Load existing message IDs to avoid duplicates
      const existingIds = new Set();
      if (existingContent) {
        for (const line of existingContent.split('\n')) {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line);
              if (msg.id) existingIds.add(msg.id);
            } catch {}
          }
        }
      }
      
      // Filter out duplicates and append new messages
      const newMessages = messages.filter(m => !existingIds.has(m.id));
      if (newMessages.length === 0) return;
      
      const newLines = newMessages.map(m => JSON.stringify(m)).join('\n') + '\n';
      
      // Write back
      const writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.seek((await file.size));
      await writable.write(newLines);
      await writable.close();
      
      console.log(`FileMemoryStorage: Wrote ${newMessages.length} messages to ${filename}`);
    } catch (e) {
      console.error(`FileMemoryStorage: Error writing to ${filename}:`, e);
      throw e;
    }
  }

  async writeChat(chat) {
    if (!this.enabled || !this.dirHandle || !chat.messages) return;

    // Write each message with chat context
    for (let i = 0; i < chat.messages.length; i++) {
      const msg = chat.messages[i];
      await this.writeMessage({
        id: `${chat.id}-${i}`,
        chatId: chat.id,
        chatTitle: chat.title || 'Untitled',
        order: i,
        role: msg.role,
        content: msg.content || '',
        timestamp: msg.timestamp || chat.createdAt || Date.now()
      });
    }
  }

  async syncAllChats(chats) {
    if (!this.enabled || !this.dirHandle) return 0;

    let count = 0;
    for (const chat of Object.values(chats)) {
      if (chat.messages) {
        await this.writeChat(chat);
        count += chat.messages.length;
      }
    }
    
    // Force flush
    await this.flushWrites();
    return count;
  }

  isEnabled() {
    return this.enabled;
  }

  getDirectoryName() {
    return this.dirHandle?.name || null;
  }
}

// ClawGPT Memory - Per-message storage for better search
class MemoryStorage {
  constructor() {
    this.dbName = 'clawgpt-memory';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => {
        console.warn('MemoryStorage: IndexedDB not available');
        resolve(null);
      };
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Messages store with indexes for search
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' });
          store.createIndex('chatId', 'chatId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('role', 'role', { unique: false });
          // Compound index for chat + order
          store.createIndex('chatOrder', ['chatId', 'order'], { unique: true });
        }
        
        // Search index for full-text search
        if (!db.objectStoreNames.contains('searchIndex')) {
          const searchStore = db.createObjectStore('searchIndex', { keyPath: 'term' });
          searchStore.createIndex('messageIds', 'messageIds', { unique: false, multiEntry: true });
        }
        
        // Sync state
        if (!db.objectStoreNames.contains('syncState')) {
          db.createObjectStore('syncState', { keyPath: 'key' });
        }
      };
    });
  }

  // Store a message and update search index
  async storeMessage(chatId, chatTitle, message, order) {
    await this.init();
    if (!this.db) return;

    const msgId = `${chatId}-${order}`;
    const doc = {
      id: msgId,
      chatId,
      chatTitle: chatTitle || 'Untitled',
      order,
      role: message.role,
      content: message.content || '',
      timestamp: message.timestamp || Date.now(),
      tokens: message.tokens || 0
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['messages', 'searchIndex'], 'readwrite');
      const msgStore = tx.objectStore('messages');
      const searchStore = tx.objectStore('searchIndex');
      
      // Store the message
      msgStore.put(doc);
      
      // Update search index (simple term-based)
      const terms = this.extractTerms(doc.content);
      terms.forEach(term => {
        const getReq = searchStore.get(term);
        getReq.onsuccess = () => {
          const existing = getReq.result || { term, messageIds: [] };
          if (!existing.messageIds.includes(msgId)) {
            existing.messageIds.push(msgId);
            searchStore.put(existing);
          }
        };
      });
      
      tx.oncomplete = () => resolve(doc);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Extract searchable terms from content
  extractTerms(content) {
    if (!content) return [];
    return content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length >= 3)
      .filter(term => !ClawGPT.STOP_WORDS.has(term));
  }

  // Search messages by terms
  async search(query, limit = 50) {
    await this.init();
    if (!this.db) return [];

    const terms = this.extractTerms(query);
    if (terms.length === 0) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['messages', 'searchIndex'], 'readonly');
      const msgStore = tx.objectStore('messages');
      const searchStore = tx.objectStore('searchIndex');
      
      // Find message IDs matching any term
      const matchingIds = new Map(); // msgId -> match count
      let termsProcessed = 0;
      
      terms.forEach(term => {
        const req = searchStore.get(term);
        req.onsuccess = () => {
          if (req.result && req.result.messageIds) {
            req.result.messageIds.forEach(id => {
              matchingIds.set(id, (matchingIds.get(id) || 0) + 1);
            });
          }
          termsProcessed++;
          
          if (termsProcessed === terms.length) {
            // Sort by match count, get top results
            const sortedIds = [...matchingIds.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, limit)
              .map(([id]) => id);
            
            // Fetch the actual messages
            const results = [];
            let fetched = 0;
            
            if (sortedIds.length === 0) {
              resolve([]);
              return;
            }
            
            sortedIds.forEach(id => {
              const msgReq = msgStore.get(id);
              msgReq.onsuccess = () => {
                if (msgReq.result) {
                  results.push({
                    ...msgReq.result,
                    matchScore: matchingIds.get(id)
                  });
                }
                fetched++;
                if (fetched === sortedIds.length) {
                  // Sort by match score then timestamp
                  results.sort((a, b) => {
                    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
                    return b.timestamp - a.timestamp;
                  });
                  resolve(results);
                }
              };
            });
          }
        };
      });
    });
  }

  // Get all messages for a chat
  async getChatMessages(chatId) {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['messages'], 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('chatId');
      const req = index.getAll(chatId);
      
      req.onsuccess = () => {
        const messages = req.result || [];
        messages.sort((a, b) => a.order - b.order);
        resolve(messages);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Get message count
  async getMessageCount() {
    await this.init();
    if (!this.db) return 0;

    return new Promise((resolve) => {
      const tx = this.db.transaction(['messages'], 'readonly');
      const store = tx.objectStore('messages');
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  }

  // Sync all chats to memory storage
  async syncFromChats(chats) {
    if (!chats || typeof chats !== 'object') return 0;
    
    let synced = 0;
    for (const [chatId, chat] of Object.entries(chats)) {
      if (!chat.messages) continue;
      
      for (let i = 0; i < chat.messages.length; i++) {
        await this.storeMessage(chatId, chat.title, chat.messages[i], i);
        synced++;
      }
    }
    
    // Save sync timestamp
    await this.init();
    if (this.db) {
      const tx = this.db.transaction(['syncState'], 'readwrite');
      tx.objectStore('syncState').put({ key: 'lastSync', timestamp: Date.now() });
    }
    
    return synced;
  }

  // Get last sync timestamp
  async getLastSync() {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db.transaction(['syncState'], 'readonly');
      const req = tx.objectStore('syncState').get('lastSync');
      req.onsuccess = () => resolve(req.result?.timestamp || null);
      req.onerror = () => resolve(null);
    });
  }
}

class ClawGPT {
  // Stop words for search filtering (class constant for performance)
  static STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom',
    'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
    'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here',
    'there', 'then', 'once', 'any', 'about', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further',
    'something', 'anything', 'everything', 'nothing', 'someone', 'anyone',
    'everyone', 'thing', 'things', 'stuff', 'like', 'want', 'wanted', 'find',
    'search', 'looking', 'look', 'show', 'tell', 'told', 'said', 'says',
    'mentions', 'mentioned', 'talked', 'talk', 'chat', 'chats', 'message'
  ]);
  
  constructor() {
    this.ws = null;
    this.connected = false;
    this.sessionKey = 'main';
    this.currentChatId = null;
    this.chats = {};
    this.pendingRequests = new Map();
    this.requestId = 0;
    this.streaming = false;
    this.streamBuffer = '';
    this.pinnedExpanded = false;
    this.storage = new ChatStorage();
    this.memoryStorage = new MemoryStorage();
    this.fileMemoryStorage = new FileMemoryStorage();

    this.loadSettings();
    this.initUI();
    
    // Async initialization
    this.init();
  }
  
  async init() {
    await this.loadChats();
    this.renderChatList();
    
    // Sync existing chats to clawgpt-memory (background)
    this.syncMemoryStorage();
    
    // Initialize file-based memory storage (for cross-device sync)
    await this.initFileMemoryStorage();
    
    // Check if joining relay as client (phone scanned QR)
    if (this.pendingRelayJoin) {
      this.joinRelayAsClient(this.pendingRelayJoin);
      delete this.pendingRelayJoin;
      return; // Don't auto-connect to gateway - we'll get connection through relay
    }
    
    // Check if we need to show setup wizard
    if (!this.hasConfigFile && !this.authToken) {
      // Try connecting without auth first - many local setups don't require it
      const noAuthNeeded = await this.tryConnectWithoutAuth();
      if (noAuthNeeded) {
        this.autoConnect();
      } else {
        this.showSetupWizard();
      }
    } else {
      this.autoConnect();
    }
  }
  
  // Try to connect without auth - returns true if gateway accepts unauthenticated connections
  async tryConnectWithoutAuth() {
    return new Promise((resolve) => {
      const testUrl = this.gatewayUrl || 'ws://127.0.0.1:18789';
      let ws;
      
      const cleanup = () => {
        try { ws?.close(); } catch {}
      };
      
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 3000);
      
      try {
        ws = new WebSocket(testUrl);
        
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            // If we get a challenge, try connecting without token
            if (msg.type === 'event' && msg.event === 'connect.challenge') {
              // Send connect without auth
              ws.send(JSON.stringify({
                type: 'req',
                id: '1',
                method: 'connect',
                params: {
                  minProtocol: 3,
                  maxProtocol: 3,
                  client: { id: 'clawgpt-probe', version: '0.1.0' },
                  role: 'operator',
                  scopes: [],
                  auth: {}
                }
              }));
            }
            // If we get a successful response, no auth needed!
            if (msg.type === 'res' && msg.ok && msg.payload?.type === 'hello-ok') {
              clearTimeout(timeout);
              cleanup();
              console.log('Gateway accepts unauthenticated connections');
              resolve(true);
            }
            // If we get an error about auth, auth is required
            if (msg.type === 'res' && !msg.ok) {
              clearTimeout(timeout);
              cleanup();
              console.log('Gateway requires authentication');
              resolve(false);
            }
          } catch {}
        };
        
        ws.onerror = () => {
          clearTimeout(timeout);
          cleanup();
          resolve(false);
        };
        
        ws.onclose = () => {
          clearTimeout(timeout);
          resolve(false);
        };
      } catch {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  // Settings
  loadSettings() {
    // Check for config.js defaults (optional file)
    const config = window.CLAWGPT_CONFIG || {};
    this.hasConfigFile = !!(config.authToken);
    
    const saved = localStorage.getItem('clawgpt-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      // If we have config.js, use it for sensitive stuff (token)
      // Only use localStorage for non-sensitive settings
      this.gatewayUrl = this.hasConfigFile ? config.gatewayUrl : (settings.gatewayUrl || config.gatewayUrl || 'ws://127.0.0.1:18789');
      this.authToken = this.hasConfigFile ? config.authToken : (settings.authToken || config.authToken || '');
      this.sessionKey = this.hasConfigFile ? config.sessionKey : (settings.sessionKey || config.sessionKey || 'main');
      this.darkMode = settings.darkMode !== false;
      this.smartSearch = settings.smartSearch !== false;
      this.semanticSearch = settings.semanticSearch || false;
      this.showTokens = settings.showTokens !== false;
    } else {
      // No saved settings - use config.js values or defaults
      this.gatewayUrl = config.gatewayUrl || 'ws://127.0.0.1:18789';
      this.authToken = config.authToken || '';
      this.sessionKey = config.sessionKey || 'main';
      this.darkMode = config.darkMode !== false;
      this.smartSearch = true;
      this.semanticSearch = false;
      this.showTokens = true;
    }
    
    // Log if using config.js
    if (this.hasConfigFile) {
      console.log('Using config.js for authentication');
    }
    
    // Token tracking
    this.tokenCount = parseInt(localStorage.getItem('clawgpt-tokens') || '0');
    
    // Check URL params for token and gateway (allows one-time setup links, especially from mobile QR)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    const urlGateway = urlParams.get('gateway');
    
    let urlChanged = false;
    
    if (urlToken && !this.hasConfigFile) {
      this.authToken = urlToken;
      urlChanged = true;
    }
    
    if (urlGateway && !this.hasConfigFile) {
      this.gatewayUrl = urlGateway;
      urlChanged = true;
    }
    
    if (urlChanged) {
      this.saveSettings();
      // Clean up URL to remove sensitive params
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
    
    // Check for relay connection params (phone joining via QR code)
    const relayServer = urlParams.get('relay');
    const relayChannel = urlParams.get('channel');
    const relayPubkey = urlParams.get('pubkey');
    
    if (relayServer && relayChannel && relayPubkey) {
      // Store for later connection after init completes
      this.pendingRelayJoin = { server: relayServer, channel: relayChannel, pubkey: relayPubkey };
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  saveSettings() {
    // Don't save sensitive stuff to localStorage if using config.js
    const settings = {
      darkMode: this.darkMode,
      smartSearch: this.smartSearch,
      semanticSearch: this.semanticSearch,
      showTokens: this.showTokens
    };
    
    // Only save connection settings if NOT using config.js
    if (!this.hasConfigFile) {
      settings.gatewayUrl = this.gatewayUrl;
      settings.authToken = this.authToken;
      settings.sessionKey = this.sessionKey;
    }
    
    localStorage.setItem('clawgpt-settings', JSON.stringify(settings));
  }
  
  // Sync existing chats to clawgpt-memory (for search)
  async syncMemoryStorage() {
    try {
      const lastSync = await this.memoryStorage.getLastSync();
      const now = Date.now();
      
      // Only sync if never synced or > 1 hour since last sync
      if (lastSync && (now - lastSync) < 3600000) {
        console.log('Memory storage: recently synced, skipping');
        return;
      }
      
      const count = await this.memoryStorage.syncFromChats(this.chats);
      console.log(`Memory storage: synced ${count} messages`);
    } catch (err) {
      console.warn('Memory storage sync failed:', err);
    }
  }
  
  // Search across all messages in clawgpt-memory
  async searchMemory(query) {
    try {
      return await this.memoryStorage.search(query);
    } catch (err) {
      console.warn('Memory search failed:', err);
      return [];
    }
  }
  
  // Initialize file-based memory storage for cross-device persistence
  async initFileMemoryStorage() {
    const initialized = await this.fileMemoryStorage.init();
    
    if (initialized) {
      console.log('File memory storage ready:', this.fileMemoryStorage.getDirectoryName());
      this.updateFileMemoryUI();
      
      // Sync all existing chats to file storage
      const count = await this.fileMemoryStorage.syncAllChats(this.chats);
      if (count > 0) {
        console.log(`File memory: synced ${count} messages to disk`);
      }
    } else {
      console.log('File memory storage not enabled (select folder in settings)');
    }
  }
  
  // Enable file memory storage (user selects directory)
  async enableFileMemoryStorage() {
    const success = await this.fileMemoryStorage.selectDirectory();
    
    if (success) {
      this.showToast(`Memory folder: ${this.fileMemoryStorage.getDirectoryName()}`);
      this.updateFileMemoryUI();
      
      // Sync all chats to the new folder
      const count = await this.fileMemoryStorage.syncAllChats(this.chats);
      this.showToast(`Synced ${count} messages to disk`);
    }
    
    return success;
  }
  
  // Update file memory UI elements
  updateFileMemoryUI() {
    const statusEl = document.getElementById('fileMemoryStatus');
    const enableBtn = document.getElementById('enableFileMemoryBtn');
    const syncBtn = document.getElementById('syncFileMemoryBtn');
    
    if (this.fileMemoryStorage.isEnabled()) {
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: var(--accent-color);">✓</span> ${this.fileMemoryStorage.getDirectoryName()}`;
      }
      if (enableBtn) enableBtn.textContent = 'Change Folder';
      if (syncBtn) syncBtn.style.display = 'inline-block';
    } else {
      if (statusEl) {
        statusEl.innerHTML = '<span style="color: var(--text-muted);">Not configured</span>';
      }
      if (enableBtn) enableBtn.textContent = 'Select Folder';
      if (syncBtn) syncBtn.style.display = 'none';
    }
  }
  
  // Manual sync to file memory
  async syncToFileMemory() {
    if (!this.fileMemoryStorage.isEnabled()) {
      this.showToast('Select a folder first', true);
      return;
    }
    
    this.showToast('Syncing...');
    const count = await this.fileMemoryStorage.syncAllChats(this.chats);
    this.showToast(`Synced ${count} messages to disk`);
  }
  
  // Setup Wizard
  showSetupWizard() {
    const modal = document.getElementById('setupModal');
    if (!modal) return;
    
    modal.classList.add('open');
    this.initSetupWizard();
  }
  
  initSetupWizard() {
    const saveBtn = document.getElementById('setupSaveConfigBtn');
    const connectBtn = document.getElementById('setupConnectBtn');
    const doneBtn = document.getElementById('setupDoneBtn');
    const openControlBtn = document.getElementById('openControlUiBtn');
    const getTokenBtn = document.getElementById('getTokenBtn');
    
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.handleSetupSave());
    }
    if (connectBtn) {
      connectBtn.addEventListener('click', () => this.handleSetupConnect());
    }
    if (doneBtn) {
      doneBtn.addEventListener('click', () => this.handleSetupConnect());
    }
    if (openControlBtn) {
      openControlBtn.addEventListener('click', () => this.openControlPanel());
    }
    if (getTokenBtn) {
      getTokenBtn.addEventListener('click', () => this.openControlPanel());
    }
    
    // Copy buttons
    document.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.dataset.copy;
        navigator.clipboard.writeText(text).then(() => {
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 1500);
        });
      });
    });
    
    // Auto-clean token input (remove backticks, quotes, whitespace)
    const tokenInput = document.getElementById('setupAuthToken');
    if (tokenInput) {
      tokenInput.addEventListener('input', () => {
        const cleaned = tokenInput.value.replace(/[`'"]/g, '').trim();
        if (cleaned !== tokenInput.value) {
          tokenInput.value = cleaned;
        }
      });
    }
    
    // Check gateway connection
    this.checkGatewayConnection();
    
    // Re-check when URL changes
    const urlInput = document.getElementById('setupGatewayUrl');
    if (urlInput) {
      let debounce;
      urlInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => this.checkGatewayConnection(), 500);
      });
    }
  }
  
  openControlPanel() {
    // Convert WebSocket URL to HTTP URL for control panel
    const wsUrl = document.getElementById('setupGatewayUrl')?.value || 'ws://127.0.0.1:18789';
    let httpUrl = wsUrl
      .replace('wss://', 'https://')
      .replace('ws://', 'http://')
      .replace(/\/$/, '');
    
    // Use 127.0.0.1 instead of localhost (gateway binds to 127.0.0.1)
    httpUrl = httpUrl.replace('://localhost', '://127.0.0.1');
    
    // Open control panel - config page, scrolled to gateway.auth section
    window.open(httpUrl + '/config', '_blank');
    
    // Show helper toast
    this.showToast('Look for gateway → auth → token in the config');
  }
  
  async checkGatewayConnection() {
    const urlInput = document.getElementById('setupGatewayUrl');
    const statusEl = document.getElementById('gatewayStatus');
    const hintEl = document.getElementById('gatewayHint');
    
    if (!urlInput || !statusEl || !hintEl) return;
    
    const url = urlInput.value.trim();
    if (!url) return;
    
    // Show checking state
    statusEl.className = 'gateway-status checking';
    hintEl.className = 'setting-hint';
    hintEl.textContent = 'Checking gateway...';
    
    try {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        this.updateGatewayStatus('offline', 'Gateway not responding');
      }, 3000);
      
      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        this.updateGatewayStatus('online', 'Gateway found!');
      };
      
      ws.onerror = () => {
        clearTimeout(timeout);
        this.updateGatewayStatus('offline', 'Cannot connect to gateway');
      };
    } catch (e) {
      this.updateGatewayStatus('offline', 'Invalid gateway URL');
    }
  }
  
  updateGatewayStatus(status, message) {
    const statusEl = document.getElementById('gatewayStatus');
    const hintEl = document.getElementById('gatewayHint');
    
    if (statusEl) statusEl.className = `gateway-status ${status}`;
    if (hintEl) {
      hintEl.className = `setting-hint ${status}`;
      hintEl.textContent = message;
    }
  }
  
  updateConfigPaths() {
    // No longer showing terminal commands - users just ask OpenClaw for their token
  }
  
  copyTokenCommand() {
    const cmdEl = document.getElementById('tokenCommand');
    const copyBtn = document.getElementById('copyTokenCmd');
    if (cmdEl && copyBtn) {
      navigator.clipboard.writeText(cmdEl.textContent).then(() => {
        const original = copyBtn.textContent;
        copyBtn.textContent = '✓';
        setTimeout(() => copyBtn.textContent = original, 1500);
      });
    }
  }
  
  async handleSetupSave() {
    const gatewayUrl = document.getElementById('setupGatewayUrl')?.value || 'ws://127.0.0.1:18789';
    const authToken = document.getElementById('setupAuthToken')?.value || '';
    const sessionKey = document.getElementById('setupSessionKey')?.value || 'main';
    
    if (!authToken) {
      this.showToast('Please enter an auth token', true);
      return;
    }
    
    // Generate config.js content
    const configContent = `// ClawGPT Configuration
// Generated: ${new Date().toISOString()}
// Keep this file secure - it contains your auth token

window.CLAWGPT_CONFIG = {
  gatewayUrl: '${gatewayUrl}',
  authToken: '${authToken}',
  sessionKey: '${sessionKey}',
  darkMode: true
};
`;
    
    // Try File System Access API first (Chrome/Edge)
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'config.js',
          types: [{
            description: 'JavaScript file',
            accept: { 'application/javascript': ['.js'] }
          }]
        });
        
        const writable = await handle.createWritable();
        await writable.write(configContent);
        await writable.close();
        
        // Show success
        this.showSetupSuccess(handle.name);
        return;
      } catch (err) {
        // User cancelled or error - fall through to download
        if (err.name === 'AbortError') return;
        console.log('File picker failed, falling back to download:', err);
      }
    }
    
    // Fallback: Download file
    this.downloadConfigFile(configContent);
    this.showSetupFallback();
  }
  
  downloadConfigFile(content) {
    const blob = new Blob([content], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  showSetupSuccess(filename) {
    const step1 = document.getElementById('setupStep1');
    const step2 = document.getElementById('setupStep2');
    const pathEl = document.getElementById('setupPath');
    
    if (step1) step1.style.display = 'none';
    if (step2) step2.style.display = 'block';
    if (pathEl) pathEl.textContent = `Saved as: ${filename}`;
  }
  
  showSetupFallback() {
    const step1 = document.getElementById('setupStep1');
    const fallback = document.getElementById('setupFallback');
    const pathEl = document.getElementById('setupFolderPath');
    
    if (step1) step1.style.display = 'none';
    if (fallback) fallback.style.display = 'block';
    
    // Try to detect the folder path
    if (pathEl) {
      const folderPath = this.detectClawGPTFolder();
      pathEl.textContent = folderPath;
    }
  }
  
  detectClawGPTFolder() {
    const url = window.location.href;
    
    // file:// URL - can extract actual path
    if (url.startsWith('file://')) {
      let path = url.replace('file:///', '').replace('file://', '');
      // Remove index.html and decode
      path = decodeURIComponent(path.replace(/\/[^\/]*\.html.*$/, '').replace(/\\/g, '/'));
      // Add trailing slash
      if (!path.endsWith('/')) path += '/';
      // Format for display (Windows vs Unix)
      if (path.match(/^[A-Z]:/i)) {
        // Windows path
        return path.replace(/\//g, '\\');
      }
      return path;
    }
    
    // http:// URL - give generic instructions
    if (url.includes('localhost')) {
      return 'The folder where you\'re running the web server from';
    }
    
    return 'The folder containing index.html';
  }
  
  handleSetupConnect() {
    const modal = document.getElementById('setupModal');
    if (modal) modal.classList.remove('open');
    
    // Reload to pick up config.js
    window.location.reload();
  }
  
  saveTokenCount() {
    localStorage.setItem('clawgpt-tokens', String(this.tokenCount));
  }
  
  addTokens(count) {
    this.tokenCount += count;
    this.saveTokenCount();
    this.updateTokenDisplay();
  }
  
  updateTokenDisplay() {
    this.updateChatTokens();
    this.updateModelDisplay();
  }
  
  updateModelDisplay() {
    const chatModelEl = document.getElementById('chatModel');
    if (!chatModelEl) return;
    
    const chat = this.currentChatId ? this.chats[this.currentChatId] : null;
    
    // Use chat-specific model if set, otherwise use session default
    const modelId = chat?.model || this.currentModelId;
    
    if (!modelId) {
      chatModelEl.classList.remove('visible');
      return;
    }
    
    // Get friendly name
    const model = this.allModels?.find(m => m.id === modelId);
    let displayName = model?.name || modelId;
    
    // Shorten common prefixes
    displayName = displayName
      .replace('Claude ', '')
      .replace(' (latest)', '');
    
    chatModelEl.textContent = displayName;
    chatModelEl.title = modelId;
    chatModelEl.classList.add('visible');
  }
  
  updateChatTokens() {
    const chatTokensEl = document.getElementById('chatTokens');
    if (!chatTokensEl) return;
    
    if (!this.showTokens || !this.currentChatId) {
      chatTokensEl.style.display = 'none';
      return;
    }
    
    const chat = this.chats[this.currentChatId];
    if (!chat || !chat.messages) {
      chatTokensEl.style.display = 'none';
      return;
    }
    
    // Calculate total tokens for this conversation
    let total = chat.messages.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
    
    // Add streaming buffer if currently streaming
    if (this.streaming && this.streamBuffer) {
      total += this.estimateTokens(this.streamBuffer);
    }
    
    chatTokensEl.textContent = `~${this.formatTokenCount(total)} tokens`;
    chatTokensEl.style.display = 'block';
  }
  
  formatTokenCount(count) {
    if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
    return String(count);
  }
  
  estimateTokens(text) {
    // Rough estimate: ~4 chars per token for English
    return Math.ceil(text.length / 4);
  }

  // Chat storage (IndexedDB with localStorage fallback)
  async loadChats() {
    this.chats = await this.storage.loadAll();
  }

  saveChats(broadcastChatId = null) {
    // Fire and forget - don't await to keep UI responsive
    this.storage.saveAll(this.chats).catch(err => {
      console.error('Failed to save chats:', err);
    });
    
    // Write to file-based memory storage if enabled
    if (broadcastChatId && this.fileMemoryStorage.isEnabled()) {
      const chat = this.chats[broadcastChatId];
      if (chat) {
        this.fileMemoryStorage.writeChat(chat).catch(err => {
          console.error('Failed to write to file memory:', err);
        });
      }
    }
    
    // Broadcast to connected peer if relay is active
    if (broadcastChatId && this.relayEncrypted) {
      this.broadcastChatUpdate(broadcastChatId);
    }
  }
  
  // Export all chats to a JSON file
  exportChats() {
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      chatCount: Object.keys(this.chats).length,
      chats: this.chats
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `clawgpt-chats-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    this.showToast(`Exported ${exportData.chatCount} chats`);
  }
  
  // Import chats from a JSON file
  importChats(file) {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        // Validate format
        if (!data.chats || typeof data.chats !== 'object') {
          throw new Error('Invalid file format');
        }
        
        const importCount = Object.keys(data.chats).length;
        const existingCount = Object.keys(this.chats).length;
        
        // Merge chats (imported chats override existing with same ID)
        this.chats = { ...this.chats, ...data.chats };
        
        await this.storage.saveAll(this.chats);
        this.renderChatList();
        
        const newCount = Object.keys(this.chats).length;
        const addedCount = newCount - existingCount;
        
        this.showToast(`Imported ${importCount} chats (${addedCount} new)`);
      } catch (error) {
        console.error('Import failed:', error);
        this.showToast('Import failed: ' + error.message, true);
      }
    };
    
    reader.onerror = () => {
      this.showToast('Failed to read file', true);
    };
    
    reader.readAsText(file);
  }
  
  showMobileQR() {
    const qrContainer = document.getElementById('qrCode');
    const placeholder = document.getElementById('qrPlaceholder');
    const urlDisplay = document.getElementById('mobileUrl');
    const relayToggle = document.getElementById('relayModeToggle');
    
    if (!qrContainer) return;
    
    // Check if relay mode is enabled
    const useRelay = relayToggle?.checked || false;
    
    if (useRelay) {
      this.showRelayQR(qrContainer, placeholder, urlDisplay);
    } else {
      this.showLocalQR(qrContainer, placeholder, urlDisplay);
    }
  }
  
  showLocalQR(qrContainer, placeholder, urlDisplay) {
    // Build the web UI URL
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const port = window.location.port;
    let webUrl = `${protocol}//${host}${port ? ':' + port : ''}`;
    
    // Build the gateway URL for mobile
    let gatewayUrl = this.gatewayUrl || 'ws://127.0.0.1:18789';
    
    // If gateway is localhost, replace with the web host (for same-network access)
    if (gatewayUrl.includes('localhost') || gatewayUrl.includes('127.0.0.1')) {
      // Extract the port from gateway URL
      const gatewayPort = gatewayUrl.match(/:(\d+)$/)?.[1] || '18789';
      gatewayUrl = `ws://${host}:${gatewayPort}`;
    }
    
    // Build mobile URL with both gateway and token
    let mobileUrl = `${webUrl}?gateway=${encodeURIComponent(gatewayUrl)}`;
    if (this.authToken) {
      mobileUrl += `&token=${encodeURIComponent(this.authToken)}`;
    }
    
    // Update display
    if (urlDisplay) {
      urlDisplay.innerHTML = `<strong>Mode:</strong> Local Network<br><strong>Gateway:</strong> ${gatewayUrl}`;
    }
    
    this.renderQRCode(qrContainer, placeholder, mobileUrl);
  }
  
  async showRelayQR(qrContainer, placeholder, urlDisplay) {
    // Show loading state
    if (urlDisplay) {
      urlDisplay.innerHTML = '<strong>Mode:</strong> Remote Relay<br><em>Connecting to relay...</em>';
    }
    qrContainer.innerHTML = '<p style="color: var(--text-muted);">Connecting to relay...</p>';
    if (placeholder) placeholder.style.display = 'none';
    qrContainer.style.display = 'block';
    
    try {
      // Initialize E2E encryption
      this.relayCrypto = new RelayCrypto();
      const publicKey = this.relayCrypto.getPublicKey();
      
      // Get or create persistent pairing ID
      const pairingId = this.getOrCreatePairingId();
      
      // Connect to relay room (persistent - survives reconnection)
      const relayUrl = this.relayServerUrl || 'wss://clawgpt-relay.fly.dev';
      await this.connectToRelayRoom(relayUrl, pairingId);
      
      // Build mobile URL with pairing ID + our public key
      // Phone will connect to same room and be able to reconnect later
      const webBase = window.location.origin + window.location.pathname;
      const mobileUrl = `${webBase}?relay=${encodeURIComponent(relayUrl)}&room=${pairingId}&pubkey=${encodeURIComponent(publicKey)}`;
      
      // Update display - show waiting for phone
      if (urlDisplay) {
        urlDisplay.innerHTML = `<strong>Mode:</strong> Remote Relay (E2E Encrypted)<br><strong>Room:</strong> ${pairingId}<br><em>Waiting for phone to connect...</em>`;
      }
      
      this.renderQRCode(qrContainer, placeholder, mobileUrl);
      
    } catch (error) {
      console.error('Relay connection failed:', error);
      if (urlDisplay) {
        urlDisplay.innerHTML = `<strong>Mode:</strong> Remote Relay<br><span style="color: #e74c3c;">Failed: ${error.message}</span>`;
      }
      qrContainer.innerHTML = '<p style="color: #e74c3c;">Relay connection failed</p>';
    }
  }
  
  // Get or generate persistent pairing ID for relay rooms
  getOrCreatePairingId() {
    let pairingId = localStorage.getItem('clawgpt-pairing-id');
    if (!pairingId) {
      // Generate a memorable room ID
      pairingId = 'cg-' + Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 16);
      localStorage.setItem('clawgpt-pairing-id', pairingId);
      console.log('Generated new pairing ID:', pairingId);
    }
    return pairingId;
  }
  
  connectToRelayRoom(relayUrl, roomId) {
    return new Promise((resolve, reject) => {
      // Close existing relay connection
      if (this.relayWs) {
        this.relayWs.close();
      }
      
      // Reset encryption state
      this.relayEncrypted = false;
      this.relayRoomId = roomId;
      
      // Connect to named room (persistent)
      const wsUrl = relayUrl.replace(/^http/, 'ws') + '/room/' + roomId;
      console.log('Connecting to relay room:', wsUrl);
      
      this.relayWs = new WebSocket(wsUrl);
      
      this.relayWs.onopen = () => {
        console.log('Relay WebSocket opened, waiting for room join confirmation...');
      };
      
      this.relayWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          // Handle relay control messages
          if (msg.type === 'relay') {
            if (msg.event === 'room.joined') {
              console.log('Joined relay room:', msg.roomId, 'as', msg.role);
              this.relayRole = msg.role;
              resolve(msg.roomId);
              
              // If client is already connected, we'll get key exchange soon
              if (msg.clientConnected) {
                console.log('Client already connected, waiting for key exchange...');
              }
            } else if (msg.event === 'client.connected') {
              console.log('Mobile client connected via relay, waiting for key exchange...');
            } else if (msg.event === 'host.connected') {
              console.log('Host reconnected');
            } else if (msg.event === 'client.disconnected') {
              console.log('Mobile client disconnected');
              this.relayEncrypted = false;
              this.setStatus('Waiting for phone...');
              this.showToast('Phone disconnected - will reconnect automatically', true);
            } else if (msg.event === 'error') {
              console.error('Relay error:', msg.error);
              reject(new Error(msg.error));
            }
            return;
          }
          
          // Handle key exchange from phone
          if (msg.type === 'keyexchange' && msg.publicKey) {
            this.handleRelayKeyExchange(msg.publicKey);
            return;
          }
          
          // Handle encrypted messages
          if (msg.type === 'encrypted' && this.relayEncrypted) {
            const decrypted = this.relayCrypto.openEnvelope(msg);
            if (decrypted) {
              this.handleRelayMessage(decrypted);
            } else {
              console.error('Failed to decrypt relay message');
            }
            return;
          }
          
          // Fallback for unencrypted messages (shouldn't happen after key exchange)
          if (!this.relayEncrypted) {
            console.warn('Received unencrypted message before key exchange');
          }
          
        } catch (e) {
          console.error('Relay message parse error:', e);
        }
      };
      
      this.relayWs.onerror = (error) => {
        console.error('Relay WebSocket error:', error);
        reject(new Error('Connection failed'));
      };
      
      this.relayWs.onclose = () => {
        console.log('Relay connection closed');
        this.relayWs = null;
        this.relayEncrypted = false;
        if (this.relayCrypto) {
          this.relayCrypto.destroy();
          this.relayCrypto = null;
        }
      };
      
      // Timeout
      setTimeout(() => {
        if (!this.relayRoomId) {
          this.relayWs?.close();
          reject(new Error('Timeout'));
        }
      }, 10000);
    });
  }
  
  // Join relay as client (phone side - scanned QR code)
  async joinRelayAsClient({ server, channel, pubkey }) {
    console.log('Joining relay as client:', { server, channel });
    
    this.updateStatus('Connecting to relay...');
    
    // Initialize crypto
    if (typeof RelayCrypto === 'undefined') {
      this.showToast('Relay crypto not available', true);
      return;
    }
    
    this.relayCrypto = new RelayCrypto();
    this.relayCrypto.generateKeyPair();
    
    // Set host's public key and derive shared secret immediately
    if (!this.relayCrypto.setPeerPublicKey(pubkey)) {
      this.showToast('Invalid host public key', true);
      return;
    }
    
    // Connect to relay channel
    const wsUrl = server.replace('https://', 'wss://').replace('http://', 'ws://');
    const channelUrl = `${wsUrl}/channel/${channel}`;
    
    try {
      this.relayWs = new WebSocket(channelUrl);
    } catch (e) {
      this.showToast('Failed to connect to relay', true);
      return;
    }
    
    this.relayWs.onopen = () => {
      console.log('Connected to relay channel as client');
      
      // Send our public key to complete key exchange
      this.relayWs.send(JSON.stringify({
        type: 'keyexchange',
        publicKey: this.relayCrypto.getPublicKey()
      }));
      
      // Mark as encrypted (we already derived shared secret from host's pubkey in QR)
      this.relayEncrypted = true;
      
      // Show verification code
      const verifyCode = this.relayCrypto.getVerificationCode();
      console.log('E2E encryption established! Verification:', verifyCode);
      
      this.updateStatus('Secure relay connected');
      this.showToast(`Secure connection! Verify: ${verifyCode}`, 5000);
      
      // Display verification in UI
      this.showRelayClientStatus(verifyCode);
      
      // Send our chat metadata to sync
      this.sendChatSyncMeta();
    };
    
    this.relayWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        // Handle relay control messages
        if (msg.type === 'relay') {
          if (msg.event === 'channel.joined') {
            console.log('Joined relay channel:', msg);
          } else if (msg.event === 'host.disconnected') {
            this.showToast('Desktop disconnected', true);
            this.updateStatus('Host disconnected');
          } else if (msg.event === 'error') {
            this.showToast(msg.error || 'Relay error', true);
          }
          return;
        }
        
        // Handle encrypted messages
        if (msg.type === 'encrypted' && this.relayEncrypted) {
          const decrypted = this.relayCrypto.openEnvelope(msg);
          if (decrypted) {
            this.handleRelayClientMessage(decrypted);
          } else {
            console.error('Failed to decrypt relay message');
          }
          return;
        }
      } catch (e) {
        console.error('Relay message parse error:', e);
      }
    };
    
    this.relayWs.onerror = (error) => {
      console.error('Relay error:', error);
      this.showToast('Relay connection error', true);
    };
    
    this.relayWs.onclose = () => {
      console.log('Relay connection closed');
      this.relayWs = null;
      this.relayEncrypted = false;
      this.updateStatus('Relay disconnected');
      if (this.relayCrypto) {
        this.relayCrypto.destroy();
        this.relayCrypto = null;
      }
    };
  }
  
  // Handle messages received as relay client (phone side)
  handleRelayClientMessage(msg) {
    // Handle sync messages (same as host)
    if (msg.type === 'sync-meta') {
      this.handleSyncMeta(msg);
      return;
    }
    if (msg.type === 'sync-request') {
      this.handleSyncRequest(msg);
      return;
    }
    if (msg.type === 'sync-data') {
      this.handleSyncData(msg);
      return;
    }
    if (msg.type === 'chat-update') {
      this.handleChatUpdate(msg);
      return;
    }
    
    // Handle auth info from desktop (gateway URL + token)
    if (msg.type === 'auth') {
      console.log('Received gateway auth from desktop');
      this.gatewayUrl = msg.gatewayUrl;
      this.authToken = msg.token;
      this.saveSettings();
      
      // Now connect to gateway through the desktop (relay forwards our messages)
      this.connectViaRelay();
      return;
    }
    
    // Handle gateway responses forwarded from desktop
    if (msg.type === 'gateway-response') {
      // Reuse the normal gateway message handler
      this.handleMessage(msg.data);
      return;
    }
  }
  
  // Connect to gateway through relay (phone side)
  connectViaRelay() {
    console.log('Connecting to gateway via relay proxy...');
    this.updateStatus('Connecting...');
    
    // The phone sends messages to relay, desktop forwards to gateway
    // We'll use the relay as our "WebSocket" to gateway
    this.connected = true;
    this.relayIsGatewayProxy = true;
    
    // Authenticate with gateway (desktop will forward this)
    this.sendViaRelay({
      type: 'req',
      id: this.generateId(),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: 'clawgpt-mobile', version: '0.1.0' },
        role: 'operator',
        scopes: [],
        auth: { token: this.authToken }
      }
    });
  }
  
  // Send message to gateway via relay (phone side)
  sendViaRelay(gatewayMsg) {
    if (!this.relayEncrypted || !this.relayWs) {
      console.error('Relay not connected');
      return;
    }
    
    this.sendRelayMessage({
      type: 'gateway-request',
      data: gatewayMsg
    });
  }
  
  // Show relay client status in UI
  showRelayClientStatus(verifyCode) {
    // Update status area or show a banner
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.innerHTML = `<span style="color: var(--accent-color);">Secure</span> <code style="font-size: 0.8em;">${verifyCode}</code>`;
      statusEl.title = 'Connected via encrypted relay. Verify this code matches your desktop.';
    }
  }
  
  handleRelayKeyExchange(peerPublicKey) {
    console.log('Received public key from phone, completing key exchange...');
    
    if (!this.relayCrypto) {
      console.error('RelayCrypto not initialized');
      return;
    }
    
    // Set peer's public key and derive shared secret
    if (!this.relayCrypto.setPeerPublicKey(peerPublicKey)) {
      console.error('Failed to set peer public key');
      this.showToast('Secure connection failed', true);
      return;
    }
    
    // Send our public key back (in case phone reconnected and our key changed)
    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      this.relayWs.send(JSON.stringify({
        type: 'keyexchange-response',
        publicKey: this.relayCrypto.getPublicKey()
      }));
    }
    
    this.relayEncrypted = true;
    
    // Get verification code (words)
    const verifyCode = this.relayCrypto.getVerificationCode();
    console.log('E2E encryption established! Verification:', verifyCode);
    
    // Update status to show connected
    this.setStatus('Connected', true);
    
    // Update the UI to show connected + verification code
    const urlDisplay = document.getElementById('mobileUrl');
    if (urlDisplay) {
      urlDisplay.innerHTML = `<strong>Mode:</strong> Remote Relay (E2E Encrypted)<br><strong>Verify:</strong> <code style="font-size: 0.95em; background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px;">${verifyCode}</code><br><span style="color: var(--accent-color);">Match these words on your phone</span>`;
    }
    
    this.showToast(`Secure! Verify: ${verifyCode}`, 5000);
    
    // Now send the auth token encrypted
    this.sendRelayMessage({
      type: 'auth',
      token: this.authToken,
      gatewayUrl: this.gatewayUrl
    });
    
    // Start chat history sync
    this.sendChatSyncMeta();
  }
  
  // === Chat History Sync ===
  
  sendChatSyncMeta() {
    // Send metadata about our chats so the other side can request what it needs
    const meta = {};
    for (const [id, chat] of Object.entries(this.chats)) {
      meta[id] = {
        updatedAt: chat.updatedAt || chat.createdAt || 0,
        messageCount: chat.messages?.length || 0
      };
    }
    
    this.sendRelayMessage({
      type: 'sync-meta',
      chats: meta,
      deviceId: this.getDeviceId()
    });
    
    console.log(`[Sync] Sent metadata for ${Object.keys(meta).length} chats`);
  }
  
  getDeviceId() {
    // Simple device identifier to prevent echo
    if (!this._deviceId) {
      this._deviceId = localStorage.getItem('clawgpt-device-id');
      if (!this._deviceId) {
        this._deviceId = 'dev-' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('clawgpt-device-id', this._deviceId);
      }
    }
    return this._deviceId;
  }
  
  handleSyncMeta(msg) {
    // Compare their metadata with ours and request chats we need
    const theirMeta = msg.chats || {};
    const theirDeviceId = msg.deviceId;
    
    // Don't process our own messages
    if (theirDeviceId === this.getDeviceId()) return;
    
    const needChats = [];
    
    for (const [id, theirInfo] of Object.entries(theirMeta)) {
      const ourChat = this.chats[id];
      const ourUpdatedAt = ourChat?.updatedAt || ourChat?.createdAt || 0;
      
      // Request if we don't have it or theirs is newer
      if (!ourChat || theirInfo.updatedAt > ourUpdatedAt) {
        needChats.push(id);
      }
    }
    
    if (needChats.length > 0) {
      console.log(`[Sync] Requesting ${needChats.length} chats from peer`);
      this.sendRelayMessage({
        type: 'sync-request',
        chatIds: needChats,
        deviceId: this.getDeviceId()
      });
    } else {
      console.log('[Sync] Already up to date');
    }
  }
  
  handleSyncRequest(msg) {
    const requestedIds = msg.chatIds || [];
    const theirDeviceId = msg.deviceId;
    
    if (theirDeviceId === this.getDeviceId()) return;
    
    // Send the requested chats
    const chatsToSend = {};
    for (const id of requestedIds) {
      if (this.chats[id]) {
        chatsToSend[id] = this.chats[id];
      }
    }
    
    if (Object.keys(chatsToSend).length > 0) {
      console.log(`[Sync] Sending ${Object.keys(chatsToSend).length} chats to peer`);
      this.sendRelayMessage({
        type: 'sync-data',
        chats: chatsToSend,
        deviceId: this.getDeviceId()
      });
    }
  }
  
  handleSyncData(msg) {
    const incomingChats = msg.chats || {};
    const theirDeviceId = msg.deviceId;
    
    if (theirDeviceId === this.getDeviceId()) return;
    
    let merged = 0;
    for (const [id, chat] of Object.entries(incomingChats)) {
      const ourChat = this.chats[id];
      const ourUpdatedAt = ourChat?.updatedAt || ourChat?.createdAt || 0;
      const theirUpdatedAt = chat.updatedAt || chat.createdAt || 0;
      
      // Only merge if theirs is newer or we don't have it
      if (!ourChat || theirUpdatedAt > ourUpdatedAt) {
        this.chats[id] = chat;
        merged++;
      }
    }
    
    if (merged > 0) {
      console.log(`[Sync] Merged ${merged} chats from peer`);
      this.saveChats();
      this.renderChatList();
      
      // Write synced chats to file memory
      if (this.fileMemoryStorage.isEnabled()) {
        for (const [id, chat] of Object.entries(incomingChats)) {
          if (this.chats[id] === chat) { // Only write if we actually merged it
            this.fileMemoryStorage.writeChat(chat).catch(err => {
              console.warn('Failed to write synced chat to file:', err);
            });
          }
        }
      }
      
      // Refresh current chat if it was updated
      if (this.currentChatId && incomingChats[this.currentChatId]) {
        this.renderMessages();
      }
      
      this.showToast(`Synced ${merged} chat${merged > 1 ? 's' : ''} from other device`);
    }
  }
  
  handleChatUpdate(msg) {
    const chat = msg.chat;
    const theirDeviceId = msg.deviceId;
    
    if (theirDeviceId === this.getDeviceId()) return;
    if (!chat || !chat.id) return;
    
    const ourChat = this.chats[chat.id];
    const ourUpdatedAt = ourChat?.updatedAt || ourChat?.createdAt || 0;
    const theirUpdatedAt = chat.updatedAt || chat.createdAt || 0;
    
    if (!ourChat || theirUpdatedAt > ourUpdatedAt) {
      this.chats[chat.id] = chat;
      this.saveChats();
      this.renderChatList();
      
      // Write to file memory
      if (this.fileMemoryStorage.isEnabled()) {
        this.fileMemoryStorage.writeChat(chat).catch(err => {
          console.warn('Failed to write chat update to file:', err);
        });
      }
      
      if (this.currentChatId === chat.id) {
        this.renderMessages();
      }
      
      console.log(`[Sync] Real-time update for chat: ${chat.title || chat.id}`);
    }
  }
  
  // Broadcast chat update to connected peer
  broadcastChatUpdate(chatId) {
    if (!this.relayEncrypted || !this.relayWs) return;
    
    const chat = this.chats[chatId];
    if (!chat) return;
    
    this.sendRelayMessage({
      type: 'chat-update',
      chat: chat,
      deviceId: this.getDeviceId()
    });
  }
  
  handleRelayMessage(msg) {
    // Handle sync messages
    if (msg.type === 'sync-meta') {
      this.handleSyncMeta(msg);
      return;
    }
    if (msg.type === 'sync-request') {
      this.handleSyncRequest(msg);
      return;
    }
    if (msg.type === 'sync-data') {
      this.handleSyncData(msg);
      return;
    }
    if (msg.type === 'chat-update') {
      this.handleChatUpdate(msg);
      return;
    }
    
    // Handle gateway request from phone (desktop proxies to gateway)
    if (msg.type === 'gateway-request' && msg.data) {
      // Forward to gateway
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg.data));
      }
      return;
    }
    
    // Forward other messages from mobile client to gateway (legacy support)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
  
  // Forward gateway response to phone via relay
  forwardToRelay(gatewayMsg) {
    if (!this.relayEncrypted || !this.relayWs) return;
    
    this.sendRelayMessage({
      type: 'gateway-response',
      data: gatewayMsg
    });
  }
  
  sendRelayMessage(msg) {
    if (!this.relayWs || this.relayWs.readyState !== WebSocket.OPEN) {
      console.error('Relay not connected');
      return;
    }
    
    if (this.relayEncrypted && this.relayCrypto) {
      // Send encrypted
      const envelope = this.relayCrypto.createEnvelope(msg);
      this.relayWs.send(JSON.stringify(envelope));
    } else {
      // Send unencrypted (only during key exchange)
      this.relayWs.send(JSON.stringify(msg));
    }
  }
  
  renderQRCode(qrContainer, placeholder, data) {
    // Hide placeholder, show QR
    if (placeholder) placeholder.style.display = 'none';
    qrContainer.style.display = 'block';
    qrContainer.innerHTML = ''; // Clear existing
    
    // Generate QR code
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrContainer, {
        text: data,
        width: 160,
        height: 160,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      qrContainer.innerHTML = '<p style="color: var(--text-muted);">QR library not loaded</p>';
    }
  }
  
  showToast(message, isError = false) {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => toast.classList.add('show'));
    
    // Remove after 3s
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // UI initialization
  initUI() {
    // Elements
    this.elements = {
      sidebar: document.getElementById('sidebar'),
      chatList: document.getElementById('chatList'),
      searchModal: document.getElementById('searchModal'),
      searchInput: document.getElementById('searchInput'),
      searchResults: document.getElementById('searchResults'),
      messages: document.getElementById('messages'),
      welcome: document.getElementById('welcome'),
      messageInput: document.getElementById('messageInput'),
      sendBtn: document.getElementById('sendBtn'),
      stopBtn: document.getElementById('stopBtn'),
      newChatBtn: document.getElementById('newChatBtn'),
      settingsBtn: document.getElementById('settingsBtn'),
      settingsModal: document.getElementById('settingsModal'),
      helpBtn: document.getElementById('helpBtn'),
      shortcutsModal: document.getElementById('shortcutsModal'),
      closeShortcuts: document.getElementById('closeShortcuts'),
      closeSettings: document.getElementById('closeSettings'),
      connectBtn: document.getElementById('connectBtn'),
      menuBtn: document.getElementById('menuBtn'),
      status: document.getElementById('status'),
      gatewayUrl: document.getElementById('gatewayUrl'),
      authToken: document.getElementById('authToken'),
      sessionKeyInput: document.getElementById('sessionKey'),
      darkMode: document.getElementById('darkMode'),
      renameModal: document.getElementById('renameModal'),
      closeRename: document.getElementById('closeRename'),
      cancelRenameBtn: document.getElementById('cancelRenameBtn'),
      saveRenameBtn: document.getElementById('saveRenameBtn'),
      renameChatInput: document.getElementById('renameChatInput'),
      editMessageModal: document.getElementById('editMessageModal'),
      closeEditMessage: document.getElementById('closeEditMessage'),
      cancelEditMessageBtn: document.getElementById('cancelEditMessageBtn'),
      saveEditMessageBtn: document.getElementById('saveEditMessageBtn'),
      editMessageInput: document.getElementById('editMessageInput'),
      regenerateModal: document.getElementById('regenerateModal'),
      closeRegenerate: document.getElementById('closeRegenerate'),
      cancelRegenerateBtn: document.getElementById('cancelRegenerateBtn'),
      confirmRegenerateBtn: document.getElementById('confirmRegenerateBtn'),
      regenerateModelSelect: document.getElementById('regenerateModelSelect')
    };
    
    // Models list (fetched on connect)
    this.availableModels = [];

    // Apply settings to UI
    this.elements.gatewayUrl.value = this.gatewayUrl;
    this.elements.authToken.value = this.authToken;
    this.elements.sessionKeyInput.value = this.sessionKey;
    this.elements.darkMode.checked = this.darkMode;
    this.applyTheme();

    // Event listeners
    this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
    this.elements.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    this.elements.messageInput.addEventListener('input', () => this.onInputChange());

    this.elements.newChatBtn.addEventListener('click', () => this.newChat());
    this.elements.stopBtn.addEventListener('click', () => this.stopGeneration());
    
    // Voice input button
    this.initVoiceInput();
    
    // Text-to-speech
    this.initSpeechSynthesis();
    
    // Image upload
    this.initImageUpload();
    
    this.elements.settingsBtn.addEventListener('click', () => this.openSettings());
    this.elements.closeSettings.addEventListener('click', () => this.closeSettings());
    this.elements.connectBtn.addEventListener('click', () => this.connect());
    
    // Help/shortcuts modal
    if (this.elements.helpBtn) {
      this.elements.helpBtn.addEventListener('click', () => this.openShortcuts());
    }
    if (this.elements.closeShortcuts) {
      this.elements.closeShortcuts.addEventListener('click', () => this.closeShortcuts());
    }
    if (this.elements.shortcutsModal) {
      this.elements.shortcutsModal.addEventListener('click', (e) => {
        if (e.target === this.elements.shortcutsModal) this.closeShortcuts();
      });
    }
    
    // Save settings button
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => this.saveAndCloseSettings());
    }
    
    // Export/Import buttons
    const exportBtn = document.getElementById('exportChatsBtn');
    const importBtn = document.getElementById('importChatsBtn');
    const importInput = document.getElementById('importFileInput');
    
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportChats());
    }
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.importChats(e.target.files[0]);
          e.target.value = ''; // Reset so same file can be imported again
        }
      });
    }
    
    // File memory storage buttons
    const enableFileMemoryBtn = document.getElementById('enableFileMemoryBtn');
    const syncFileMemoryBtn = document.getElementById('syncFileMemoryBtn');
    
    if (enableFileMemoryBtn) {
      enableFileMemoryBtn.addEventListener('click', () => this.enableFileMemoryStorage());
    }
    if (syncFileMemoryBtn) {
      syncFileMemoryBtn.addEventListener('click', () => this.syncToFileMemory());
    }
    
    // QR Code for mobile access
    const showQrBtn = document.getElementById('showQrBtn');
    if (showQrBtn) {
      showQrBtn.addEventListener('click', () => this.showMobileQR());
    }
    
    this.elements.menuBtn.addEventListener('click', () => this.toggleSidebar());
    
    // Sidebar overlay - close sidebar when clicking outside
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', () => this.closeSidebar());
    }
    
    // Mobile close button (top of sidebar)
    const mobileCloseBtn = document.getElementById('mobileCloseBtn');
    if (mobileCloseBtn) {
      mobileCloseBtn.addEventListener('click', () => this.closeSidebar());
    }
    
    // Sidebar collapse button
    const collapseBtn = document.getElementById('collapseBtn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => this.toggleSidebarCollapse());
    }
    
    // Search button (collapsed sidebar)
    const searchBtnCollapsed = document.getElementById('searchBtnCollapsed');
    if (searchBtnCollapsed) {
      searchBtnCollapsed.addEventListener('click', () => this.openSearch());
    }
    
    // Apply saved collapse state
    this.applySidebarCollapseState();

    this.elements.darkMode.addEventListener('change', (e) => {
      this.darkMode = e.target.checked;
      this.applyTheme();
      this.saveSettings();
    });
    
    // Smart search toggle
    const smartSearchEl = document.getElementById('smartSearch');
    const semanticSearchSetting = document.getElementById('semanticSearchSetting');
    const semanticSearchEl = document.getElementById('semanticSearch');
    if (smartSearchEl) {
      smartSearchEl.checked = this.smartSearch;
      // Show/hide semantic search sub-setting
      if (semanticSearchSetting) {
        semanticSearchSetting.style.display = this.smartSearch ? 'block' : 'none';
      }
      smartSearchEl.addEventListener('change', (e) => {
        this.smartSearch = e.target.checked;
        // If disabling smart search, also disable semantic
        if (!e.target.checked) {
          this.semanticSearch = false;
          if (semanticSearchEl) semanticSearchEl.checked = false;
        }
        this.saveSettings();
        // Toggle semantic search visibility
        if (semanticSearchSetting) {
          semanticSearchSetting.style.display = e.target.checked ? 'block' : 'none';
        }
      });
    }
    
    // Semantic search toggle
    if (semanticSearchEl) {
      semanticSearchEl.checked = this.semanticSearch;
      semanticSearchEl.addEventListener('change', (e) => {
        this.semanticSearch = e.target.checked;
        this.saveSettings();
      });
    }
    
    // Show tokens toggle
    const showTokensEl = document.getElementById('showTokens');
    if (showTokensEl) {
      showTokensEl.checked = this.showTokens;
      showTokensEl.addEventListener('change', (e) => {
        this.showTokens = e.target.checked;
        this.saveSettings();
        this.updateTokenDisplay();
      });
    }
    
    // Initialize token display
    this.updateTokenDisplay();

    // Close modal on outside click
    this.elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.elements.settingsModal) {
        this.closeSettings();
      }
    });

    // Rename modal event listeners
    this.elements.closeRename.addEventListener('click', () => this.closeRenameModal());
    this.elements.cancelRenameBtn.addEventListener('click', () => this.closeRenameModal());
    this.elements.saveRenameBtn.addEventListener('click', () => this.saveRename());
    this.elements.renameChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveRename();
      } else if (e.key === 'Escape') {
        this.closeRenameModal();
      }
    });
    this.elements.renameModal.addEventListener('click', (e) => {
      if (e.target === this.elements.renameModal) {
        this.closeRenameModal();
      }
    });

    // Edit message modal event listeners
    this.elements.closeEditMessage.addEventListener('click', () => this.closeEditMessageModal());
    this.elements.cancelEditMessageBtn.addEventListener('click', () => this.closeEditMessageModal());
    this.elements.saveEditMessageBtn.addEventListener('click', () => this.saveEditMessage());
    this.elements.editMessageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.saveEditMessage();
      } else if (e.key === 'Escape') {
        this.closeEditMessageModal();
      }
    });
    this.elements.editMessageModal.addEventListener('click', (e) => {
      if (e.target === this.elements.editMessageModal) {
        this.closeEditMessageModal();
      }
    });

    // Regenerate modal event listeners
    this.elements.closeRegenerate.addEventListener('click', () => this.closeRegenerateModal());
    this.elements.cancelRegenerateBtn.addEventListener('click', () => this.closeRegenerateModal());
    this.elements.confirmRegenerateBtn.addEventListener('click', () => this.confirmRegenerate());
    this.elements.regenerateModelSelect.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.confirmRegenerate();
      } else if (e.key === 'Escape') {
        this.closeRegenerateModal();
      }
    });
    this.elements.regenerateModal.addEventListener('click', (e) => {
      if (e.target === this.elements.regenerateModal) {
        this.closeRegenerateModal();
      }
    });

    // Sidebar search box - opens full search modal
    const sidebarSearchInput = document.getElementById('sidebarSearchInput');
    if (sidebarSearchInput) {
      sidebarSearchInput.addEventListener('focus', () => {
        this.openSearch();
        sidebarSearchInput.blur(); // Remove focus from sidebar input
      });
    }

    // Search modal
    this.elements.searchModal.addEventListener('click', (e) => {
      if (e.target === this.elements.searchModal) {
        this.closeSearch();
      }
    });
    
    // Initialize search AI toggles
    this.initSearchToggles();

    this.elements.searchInput.addEventListener('input', (e) => {
      this.handleSearchInput(e.target.value);
    });

    // Search filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.searchFilter = btn.dataset.filter;
        this.handleSearchInput(this.elements.searchInput.value);
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts when typing in inputs
      const isTyping = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
      
      // ? to open shortcuts (when not typing)
      if (e.key === '?' && !isTyping) {
        e.preventDefault();
        this.openShortcuts();
      }
      // Escape to close shortcuts
      if (e.key === 'Escape' && this.elements.shortcutsModal?.classList.contains('open')) {
        this.closeShortcuts();
      }
      // Ctrl+K or Cmd+K to open search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.openSearch();
      }
      // Ctrl+Shift+N or Cmd+Shift+N for new chat
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        this.newChat();
      }
      // Escape to close search
      if (e.key === 'Escape' && this.elements.searchModal.classList.contains('open')) {
        this.closeSearch();
      }
      // Arrow key navigation in search results
      if (this.elements.searchModal.classList.contains('open')) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigateSearchResults(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.navigateSearchResults(-1);
        } else if (e.key === 'Enter' && this.selectedSearchIndex >= 0) {
          e.preventDefault();
          this.selectSearchResult();
        }
      }
    });

    this.searchFilter = 'all';
    this.searchDebounceTimer = null;
    this.selectedSearchIndex = -1;
    this.recentSearches = JSON.parse(localStorage.getItem('clawgpt-recent-searches') || '[]');

    // Render chat list
    this.renderChatList();
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.darkMode ? 'dark' : 'light');
  }

  onInputChange() {
    const hasText = this.elements.messageInput.value.trim().length > 0;
    const hasImages = this.pendingImages && this.pendingImages.length > 0;
    const hasTextFiles = this.pendingTextFiles && this.pendingTextFiles.length > 0;
    this.elements.sendBtn.disabled = (!hasText && !hasImages && !hasTextFiles) || !this.connected;

    // Auto-resize textarea
    this.elements.messageInput.style.height = 'auto';
    this.elements.messageInput.style.height = Math.min(this.elements.messageInput.scrollHeight, 200) + 'px';
  }

  toggleSidebar() {
    const isOpen = this.elements.sidebar.classList.toggle('open');
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) {
      overlay.classList.toggle('active', isOpen);
    }
  }

  closeSidebar() {
    this.elements.sidebar.classList.remove('open');
    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) {
      overlay.classList.remove('active');
    }
  }
  
  toggleSidebarCollapse() {
    const isCollapsed = this.elements.sidebar.classList.toggle('collapsed');
    localStorage.setItem('clawgpt-sidebar-collapsed', isCollapsed ? '1' : '0');
  }
  
  applySidebarCollapseState() {
    const isCollapsed = localStorage.getItem('clawgpt-sidebar-collapsed') === '1';
    if (isCollapsed) {
      this.elements.sidebar.classList.add('collapsed');
    }
  }

  // Settings modal
  openSettings() {
    this.elements.settingsModal.classList.add('open');
    this.updateSettingsButtons();
    this.updateSettingsForConfigMode();
    this.updateFileMemoryUI();
  }
  
  updateSettingsForConfigMode() {
    const gatewayGroup = this.elements.gatewayUrl?.closest('.form-group');
    const tokenGroup = this.elements.authToken?.closest('.form-group');
    const sessionGroup = this.elements.sessionKeyInput?.closest('.form-group');
    
    // Add or update config status indicator
    let statusEl = document.getElementById('configStatus');
    
    if (this.hasConfigFile) {
      // Show config.js status
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'configStatus';
        statusEl.className = 'setup-config-status';
        statusEl.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>Using config.js for authentication</span>
        `;
        const modalBody = this.elements.settingsModal.querySelector('.modal-body');
        if (modalBody) modalBody.insertBefore(statusEl, modalBody.firstChild);
      }
      
      // Hide connection settings
      if (gatewayGroup) gatewayGroup.style.display = 'none';
      if (tokenGroup) tokenGroup.style.display = 'none';
      if (sessionGroup) sessionGroup.style.display = 'none';
    } else {
      // No config.js - show normal settings
      if (statusEl) statusEl.remove();
      if (gatewayGroup) gatewayGroup.style.display = '';
      if (tokenGroup) tokenGroup.style.display = '';
      if (sessionGroup) sessionGroup.style.display = '';
    }
  }

  closeSettings() {
    this.elements.settingsModal.classList.remove('open');
  }
  
  openShortcuts() {
    if (this.elements.shortcutsModal) {
      this.elements.shortcutsModal.classList.add('open');
    }
  }
  
  closeShortcuts() {
    if (this.elements.shortcutsModal) {
      this.elements.shortcutsModal.classList.remove('open');
    }
  }
  
  saveAndCloseSettings() {
    // Save any changed settings from UI
    this.darkMode = this.elements.darkMode.checked;
    this.applyTheme();
    
    const smartSearchEl = document.getElementById('smartSearch');
    if (smartSearchEl) this.smartSearch = smartSearchEl.checked;
    
    const showTokensEl = document.getElementById('showTokens');
    if (showTokensEl) {
      this.showTokens = showTokensEl.checked;
      this.updateTokenDisplay();
    }
    
    this.saveSettings();
    this.closeSettings();
  }
  
  updateSettingsButtons() {
    const saveBtn = document.getElementById('saveSettingsBtn');
    const connectBtn = document.getElementById('connectBtn');
    
    if (saveBtn && connectBtn) {
      if (this.connected) {
        saveBtn.style.display = 'block';
        connectBtn.textContent = 'Reconnect';
        connectBtn.style.display = 'block';
        connectBtn.classList.add('secondary');
      } else {
        saveBtn.style.display = 'none';
        connectBtn.textContent = 'Connect';
        connectBtn.style.display = 'block';
        connectBtn.classList.remove('secondary');
      }
    }
  }

  // Search
  openSearch() {
    this.elements.searchModal.classList.add('open');
    this.elements.searchInput.focus();
    this.elements.searchInput.value = '';
    this.selectedSearchIndex = -1;
    
    // Show recent searches or empty state
    if (this.recentSearches.length > 0) {
      this.elements.searchResults.innerHTML = `
        <div class="recent-searches">
          <div class="recent-searches-header">Recent searches</div>
          ${this.recentSearches.map((term, i) => `
            <div class="recent-search-item" data-term="${this.escapeHtml(term)}" data-index="${i}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              ${this.escapeHtml(term)}
            </div>
          `).join('')}
        </div>
      `;
      // Click handlers for recent searches
      this.elements.searchResults.querySelectorAll('.recent-search-item').forEach(el => {
        el.addEventListener('click', () => {
          this.elements.searchInput.value = el.dataset.term;
          this.handleSearchInput(el.dataset.term);
        });
      });
    } else {
      this.elements.searchResults.innerHTML = '<div class="search-empty">Start typing to search...</div>';
    }
    
    // Sync search toggles with settings
    const deepToggle = document.getElementById('searchDeepToggle');
    const deeperToggle = document.getElementById('searchDeeperToggle');
    if (deepToggle) deepToggle.checked = this.smartSearch;
    if (deeperToggle) {
      deeperToggle.checked = this.semanticSearch;
      deeperToggle.disabled = !this.smartSearch;
    }
  }
  
  navigateSearchResults(direction) {
    const results = this.elements.searchResults.querySelectorAll('.search-result');
    if (results.length === 0) return;
    
    // Remove previous selection
    results.forEach(r => r.classList.remove('selected'));
    
    // Update index
    this.selectedSearchIndex += direction;
    if (this.selectedSearchIndex < 0) this.selectedSearchIndex = results.length - 1;
    if (this.selectedSearchIndex >= results.length) this.selectedSearchIndex = 0;
    
    // Apply selection and scroll into view
    const selected = results[this.selectedSearchIndex];
    if (selected) {
      selected.classList.add('selected');
      selected.scrollIntoView({ block: 'nearest' });
    }
  }
  
  selectSearchResult() {
    const results = this.elements.searchResults.querySelectorAll('.search-result');
    const selected = results[this.selectedSearchIndex];
    if (selected) {
      const chatId = selected.dataset.chatId;
      const msgIndex = parseInt(selected.dataset.msgIndex);
      this.closeSearch();
      this.selectChat(chatId);
      if (msgIndex >= 0) {
        setTimeout(() => this.highlightMessage(msgIndex), 100);
      }
    }
  }
  
  saveRecentSearch(query) {
    if (!query || query.length < 2) return;
    
    // Remove if already exists, add to front
    this.recentSearches = this.recentSearches.filter(s => s !== query);
    this.recentSearches.unshift(query);
    
    // Keep only last 5
    this.recentSearches = this.recentSearches.slice(0, 5);
    localStorage.setItem('clawgpt-recent-searches', JSON.stringify(this.recentSearches));
  }
  
  initSearchToggles() {
    const deepToggle = document.getElementById('searchDeepToggle');
    const deeperToggle = document.getElementById('searchDeeperToggle');
    
    if (deepToggle) {
      deepToggle.addEventListener('change', (e) => {
        this.smartSearch = e.target.checked;
        // Sync to settings
        const settingsToggle = document.getElementById('smartSearch');
        if (settingsToggle) settingsToggle.checked = e.target.checked;
        
        // Disable deeper if deep is off
        if (deeperToggle) {
          deeperToggle.disabled = !e.target.checked;
          if (!e.target.checked) {
            deeperToggle.checked = false;
            this.semanticSearch = false;
            const settingsSemantic = document.getElementById('semanticSearch');
            if (settingsSemantic) settingsSemantic.checked = false;
          }
        }
        
        this.saveSettings();
        // Re-run search if there's a query
        const query = this.elements.searchInput.value.trim();
        if (query) this.performSearch(query);
      });
    }
    
    if (deeperToggle) {
      deeperToggle.addEventListener('change', (e) => {
        this.semanticSearch = e.target.checked;
        // Sync to settings
        const settingsToggle = document.getElementById('semanticSearch');
        if (settingsToggle) settingsToggle.checked = e.target.checked;
        
        this.saveSettings();
        // Re-run search if there's a query
        const query = this.elements.searchInput.value.trim();
        if (query) this.performSearch(query);
      });
    }
  }

  closeSearch() {
    this.elements.searchModal.classList.remove('open');
    this.elements.searchInput.value = '';
  }

  handleSearchInput(query) {
    // Debounce
    clearTimeout(this.searchDebounceTimer);
    
    if (!query.trim()) {
      this.elements.searchResults.innerHTML = '<div class="search-empty">Start typing to search...</div>';
      return;
    }

    this.searchDebounceTimer = setTimeout(() => {
      this.performSearch(query.trim());
    }, 150);
  }

  performSearch(query) {
    const results = [];
    const queryLower = query.toLowerCase();
    
    // Extract meaningful words (3+ chars, not stop words)
    const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 3 && !ClawGPT.STOP_WORDS.has(w));
    
    // If all words were filtered out, use the longest word from original query
    if (queryWords.length === 0) {
      const allWords = queryLower.split(/\s+/).filter(w => w.length >= 2);
      if (allWords.length > 0) {
        const longest = allWords.reduce((a, b) => a.length >= b.length ? a : b);
        queryWords.push(longest);
      }
    }
    
    const seenChats = new Set(); // Track chats we've already added via metadata
    const seenMessages = new Set(); // Track messages to avoid duplicates

    Object.entries(this.chats).forEach(([chatId, chat]) => {
      // LAYER 2: Check metadata first (topics, summary, entities)
      // Works with all filters - metadata gives chat-level context
      if (chat.metadata && this.smartSearch) {
        const meta = chat.metadata;
        let metaMatch = null;
        
        // Check topics - match any query word
        const matchingTopic = (meta.topics || []).find(t => {
          const tLower = t.toLowerCase();
          return queryWords.some(w => tLower.includes(w)) || tLower.includes(queryLower);
        });
        if (matchingTopic) {
          metaMatch = { type: 'topic', match: matchingTopic };
        }
        
        // Check summary - match any query word
        if (!metaMatch && meta.summary) {
          const summaryLower = meta.summary.toLowerCase();
          if (queryWords.some(w => summaryLower.includes(w)) || summaryLower.includes(queryLower)) {
            metaMatch = { type: 'summary', match: meta.summary };
          }
        }
        
        // Check entities - match any query word
        if (!metaMatch) {
          const matchingEntity = (meta.entities || []).find(e => {
            const eLower = e.toLowerCase();
            return queryWords.some(w => eLower.includes(w)) || eLower.includes(queryLower);
          });
          if (matchingEntity) {
            metaMatch = { type: 'entity', match: matchingEntity };
          }
        }
        
        if (metaMatch) {
          seenChats.add(chatId);
          results.push({
            chatId,
            chatTitle: chat.title,
            msgIndex: -1, // No specific message
            role: 'meta',
            content: meta.summary || chat.title,
            matchType: metaMatch.type,
            matchValue: metaMatch.match,
            metadata: meta,
            timestamp: chat.updatedAt
          });
        }
      }
      
      // LAYER 1: Keyword search in messages - match any query word
      chat.messages.forEach((msg, msgIndex) => {
        // Apply filter
        if (this.searchFilter !== 'all' && msg.role !== this.searchFilter) {
          return;
        }

        const content = msg.content.toLowerCase();
        
        // Check for exact phrase OR any query word
        let matchIndex = content.indexOf(queryLower);
        let matchedWord = queryLower;
        
        if (matchIndex === -1 && queryWords.length > 0) {
          // Try matching individual words
          for (const word of queryWords) {
            const wordIndex = content.indexOf(word);
            if (wordIndex !== -1) {
              matchIndex = wordIndex;
              matchedWord = word;
              break;
            }
          }
        }
        
        if (matchIndex !== -1) {
          // Deduplicate: skip if this message was already added
          const msgKey = `${chatId}-${msgIndex}`;
          if (seenMessages.has(msgKey)) return;
          seenMessages.add(msgKey);
          
          results.push({
            chatId,
            chatTitle: chat.title,
            msgIndex,
            role: msg.role,
            content: msg.content,
            matchIndex,
            matchedWord,
            matchType: 'exact',
            timestamp: msg.timestamp || chat.updatedAt
          });
        }
      });
    });

    // Sort: metadata matches first (whole chat relevance), then by timestamp
    results.sort((a, b) => {
      // Metadata matches rank higher
      if (a.matchType !== 'exact' && b.matchType === 'exact') return -1;
      if (a.matchType === 'exact' && b.matchType !== 'exact') return 1;
      // Then by timestamp
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    // Store current results for merging with semantic
    this.currentSearchResults = results;
    this.currentSearchQuery = query;
    this.selectedSearchIndex = -1; // Reset selection
    this.saveRecentSearch(query);
    this.renderSearchResults(results, query);
    
    // LAYER 3: Semantic search (async)
    if (this.semanticSearch && this.connected && this.searchFilter === 'all') {
      this.performSemanticSearch(query, seenChats);
    }
  }
  
  async performSemanticSearch(query, excludeChats) {
    // Build list of chats with summaries for semantic matching
    const chatSummaries = [];
    Object.entries(this.chats).forEach(([chatId, chat]) => {
      // Skip chats already found by keyword/metadata
      if (excludeChats.has(chatId)) return;
      
      // Need either a summary or enough messages to describe
      const summary = chat.metadata?.summary || '';
      const topics = (chat.metadata?.topics || []).join(', ');
      const preview = chat.messages.slice(0, 3).map(m => 
        m.content.slice(0, 100)
      ).join(' | ');
      
      if (summary || preview) {
        chatSummaries.push({
          id: chatId,
          title: chat.title,
          summary: summary,
          topics: topics,
          preview: preview.slice(0, 200)
        });
      }
    });
    
    // No chats to search
    if (chatSummaries.length === 0) return;
    
    // Show searching indicator
    this.showSemanticSearching();
    
    const prompt = `Find chats semantically related to this search query: "${query}"

Here are the available chats:
${chatSummaries.map((c, i) => `[${i}] "${c.title}" - ${c.summary || c.preview}${c.topics ? ` (topics: ${c.topics})` : ''}`).join('\n')}

Return ONLY a JSON array of indices for chats that are conceptually related to the query, even if they don't contain the exact words. Return empty array [] if none match.
Example: [0, 2, 5]`;

    try {
      // Track tokens
      this.addTokens(this.estimateTokens(prompt));
      
      await this.request('chat.send', {
        sessionKey: '__clawgpt_semantic',
        message: prompt,
        deliver: false,
        idempotencyKey: 'semantic-' + Date.now()
      });
      
      // Store context for response handler
      this.pendingSemanticSearch = {
        query,
        chatSummaries,
        startedAt: Date.now()
      };
      
      // Timeout after 15 seconds
      setTimeout(() => {
        if (this.pendingSemanticSearch?.query === query) {
          console.log('Semantic search timed out');
          this.hideSemanticSearching();
          this.pendingSemanticSearch = null;
          this.showSearchToast('Semantic search timed out');
        }
      }, 15000);
      
    } catch (error) {
      console.error('Semantic search failed:', error);
      this.hideSemanticSearching();
      this.showSearchToast('Semantic search failed');
    }
  }
  
  showSearchToast(message) {
    // Remove existing toast
    const existing = document.getElementById('searchToast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'searchToast';
    toast.className = 'search-toast';
    toast.textContent = message;
    
    const resultsEl = this.elements.searchResults;
    if (resultsEl) {
      resultsEl.insertBefore(toast, resultsEl.firstChild);
      // Auto-remove after 3 seconds
      setTimeout(() => toast.remove(), 3000);
    }
  }
  
  handleSemanticSearchResponse(content) {
    if (!this.pendingSemanticSearch) return;
    
    // Track tokens
    this.addTokens(this.estimateTokens(content));
    
    const { query, chatSummaries } = this.pendingSemanticSearch;
    this.pendingSemanticSearch = null;
    this.hideSemanticSearching();
    
    // Verify we're still on the same search
    if (query !== this.currentSearchQuery) return;
    
    try {
      // Extract JSON array from response
      const match = content.match(/\[[\d,\s]*\]/);
      if (!match) return;
      
      const indices = JSON.parse(match[0]);
      if (!Array.isArray(indices) || indices.length === 0) return;
      
      // Build semantic results
      const semanticResults = [];
      indices.forEach(idx => {
        if (idx >= 0 && idx < chatSummaries.length) {
          const chatInfo = chatSummaries[idx];
          const chat = this.chats[chatInfo.id];
          if (chat) {
            semanticResults.push({
              chatId: chatInfo.id,
              chatTitle: chat.title,
              msgIndex: -1,
              role: 'meta',
              content: chatInfo.summary || chatInfo.preview,
              matchType: 'semantic',
              matchValue: 'Related',
              metadata: chat.metadata,
              timestamp: chat.updatedAt
            });
          }
        }
      });
      
      if (semanticResults.length > 0) {
        // Merge with existing results
        const mergedResults = [...this.currentSearchResults, ...semanticResults];
        
        // Re-sort: exact first, then metadata, then semantic
        mergedResults.sort((a, b) => {
          const order = { exact: 0, topic: 1, summary: 1, entity: 1, semantic: 2 };
          const orderA = order[a.matchType] ?? 1;
          const orderB = order[b.matchType] ?? 1;
          if (orderA !== orderB) return orderA - orderB;
          return (b.timestamp || 0) - (a.timestamp || 0);
        });
        
        this.currentSearchResults = mergedResults;
        this.renderSearchResults(mergedResults, query);
      }
      
    } catch (error) {
      console.error('Failed to parse semantic search response:', error);
    }
  }
  
  showSemanticSearching() {
    const indicator = document.createElement('div');
    indicator.id = 'semanticSearchIndicator';
    indicator.className = 'semantic-searching';
    indicator.innerHTML = '🧠 Searching semantically...';
    
    const resultsEl = this.elements.searchResults;
    if (resultsEl && !document.getElementById('semanticSearchIndicator')) {
      resultsEl.insertBefore(indicator, resultsEl.firstChild);
    }
  }
  
  hideSemanticSearching() {
    const indicator = document.getElementById('semanticSearchIndicator');
    if (indicator) indicator.remove();
  }

  renderSearchResults(results, query) {
    if (results.length === 0) {
      this.elements.searchResults.innerHTML = `
        <div class="search-no-results">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <div>No results for "${this.escapeHtml(query)}"</div>
        </div>
      `;
      return;
    }

    this.elements.searchResults.innerHTML = results.slice(0, 50).map(result => {
      const timeAgo = this.getTimeAgo(result.timestamp);
      const isMetaMatch = result.matchType && result.matchType !== 'exact';
      
      // Different display for metadata matches vs exact matches
      let roleDisplay, snippet, matchBadge;
      
      if (isMetaMatch) {
        roleDisplay = this.getMatchTypeBadge(result.matchType);
        matchBadge = `<span class="match-badge ${result.matchType}">${result.matchValue}</span>`;
        snippet = this.escapeHtml(result.content);
        if (result.metadata?.topics?.length) {
          snippet += `<div class="search-tags">${result.metadata.topics.map(t => 
            `<span class="search-tag">${this.escapeHtml(t)}</span>`
          ).join('')}</div>`;
        }
      } else {
        roleDisplay = result.role === 'user' ? 'You' : 'AI';
        matchBadge = '';
        snippet = this.getSearchSnippet(result.content, result.matchedWord || query);
      }
      
      const isSemantic = result.matchType === 'semantic';
      const matchClass = isSemantic ? 'semantic-match' : (isMetaMatch ? 'meta-match' : '');
      return `
        <div class="search-result ${matchClass}" data-chat-id="${result.chatId}" data-msg-index="${result.msgIndex}">
          <div class="search-result-header">
            <span class="search-result-title">${this.escapeHtml(result.chatTitle)}</span>
            <div class="search-result-meta">
              <span class="search-result-role ${result.role}">${roleDisplay}</span>
              ${matchBadge}
              <span>${timeAgo}</span>
            </div>
          </div>
          <div class="search-result-snippet">${snippet}</div>
        </div>
      `;
    }).join('');

    // Add click handlers
    this.elements.searchResults.querySelectorAll('.search-result').forEach(el => {
      el.addEventListener('click', () => {
        const chatId = el.dataset.chatId;
        const msgIndex = parseInt(el.dataset.msgIndex);
        this.closeSearch();
        this.selectChat(chatId);
        // Scroll to and highlight the message
        setTimeout(() => this.highlightMessage(msgIndex), 100);
      });
    });
  }

  getSearchSnippet(content, query) {
    const maxLength = 150;
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const matchIndex = lowerContent.indexOf(lowerQuery);
    
    if (matchIndex === -1) return this.escapeHtml(content.slice(0, maxLength));
    
    // Get context around match
    let start = Math.max(0, matchIndex - 40);
    let end = Math.min(content.length, matchIndex + query.length + 80);
    
    // Adjust to word boundaries
    if (start > 0) {
      const spaceIndex = content.indexOf(' ', start);
      if (spaceIndex !== -1 && spaceIndex < matchIndex) {
        start = spaceIndex + 1;
      }
    }
    
    let snippet = content.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';
    
    // Highlight match (case-insensitive but preserve case)
    const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
    snippet = this.escapeHtml(snippet).replace(regex, '<mark>$1</mark>');
    
    return snippet;
  }

  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  getMatchTypeBadge(matchType) {
    const badges = {
      topic: '🏷️ Topic',
      summary: '📝 Summary', 
      entity: '📌 Entity',
      semantic: '🧠 Semantic'
    };
    return badges[matchType] || '🎯 Exact';
  }

  getTimeAgo(timestamp) {
    if (!timestamp) return '';
    
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    
    return new Date(timestamp).toLocaleDateString();
  }

  highlightMessage(msgIndex) {
    const messages = this.elements.messages.querySelectorAll('.message');
    if (messages[msgIndex]) {
      messages[msgIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
      messages[msgIndex].classList.add('message-highlight');
      setTimeout(() => {
        messages[msgIndex].classList.remove('message-highlight');
      }, 2000);
    }
  }

  // WebSocket connection
  autoConnect() {
    if (this.gatewayUrl) {
      this.connect();
    }
  }

  async connect() {
    // Get settings from UI
    this.gatewayUrl = this.elements.gatewayUrl.value.trim() || 'ws://127.0.0.1:18789';
    this.authToken = this.elements.authToken.value.trim();
    this.sessionKey = this.elements.sessionKeyInput.value.trim() || 'main';
    this.saveSettings();

    this.closeSettings();
    this.setStatus('Connecting...');

    try {
      if (this.ws) {
        this.ws.close();
      }

      this.ws = new WebSocket(this.gatewayUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        // Wait for challenge
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        // Don't overwrite status if we're connected via relay
        if (!this.relayEncrypted) {
          this.setStatus('Error');
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.connected = false;
        // Don't overwrite status if we're connected via relay
        if (!this.relayEncrypted) {
          this.setStatus('Disconnected');
        }
        this.elements.sendBtn.disabled = true;
        this.updateSettingsButtons();
      };
    } catch (error) {
      console.error('Connection error:', error);
      // Don't overwrite status if we're connected via relay
      if (!this.relayEncrypted) {
        this.setStatus('Error');
      }
    }
  }

  handleMessage(msg) {
    // Forward to relay if connected (for mobile clients) - but not if we ARE the mobile client
    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN && this.relayEncrypted && !this.relayIsGatewayProxy) {
      this.forwardToRelay(msg);
    }
    
    // Handle challenge
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      this.sendConnect(msg.payload?.nonce);
      return;
    }

    // Handle response
    if (msg.type === 'res') {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.payload);
        } else {
          pending.reject(new Error(msg.error?.message || 'Request failed'));
        }
      }

      // Handle hello-ok
      if (msg.payload?.type === 'hello-ok') {
        this.connected = true;
        this.setStatus('Connected', true);
        this.onInputChange();
        this.loadHistory();
        this.updateSettingsButtons();
        this.fetchModels();
      }
      return;
    }

    // Handle chat events (streaming)
    if (msg.type === 'event' && msg.event === 'chat') {
      this.handleChatEvent(msg.payload);
      return;
    }
  }

  async getOrCreateDeviceIdentity() {
    const stored = localStorage.getItem('clawgpt-device');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {}
    }
    
    // Generate new device identity
    const deviceId = this.generateId() + '-' + this.generateId();
    const identity = { deviceId };
    localStorage.setItem('clawgpt-device', JSON.stringify(identity));
    return identity;
  }

  async sendConnect(nonce) {
    const connectMsg = {
      type: 'req',
      id: String(++this.requestId),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'openclaw-control-ui',
          version: '0.1.0',
          platform: 'web',
          mode: 'ui'
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: [],
        commands: [],
        permissions: {},
        auth: this.authToken ? { token: this.authToken } : {},
        locale: navigator.language || 'en-US',
        userAgent: 'ClawGPT/0.1.0'
      }
    };

    this.ws.send(JSON.stringify(connectMsg));

    // Store pending request
    this.pendingRequests.set(connectMsg.id, {
      resolve: () => {},
      reject: (err) => console.error('Connect failed:', err)
    });
  }

  async request(method, params) {
    // Check connection - either direct WS or via relay proxy
    const directConnected = this.ws && this.ws.readyState === WebSocket.OPEN;
    const relayConnected = this.relayIsGatewayProxy && this.relayWs && this.relayWs.readyState === WebSocket.OPEN;
    
    if (!directConnected && !relayConnected) {
      throw new Error('Not connected');
    }

    const id = String(++this.requestId);
    const msg = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      if (this.relayIsGatewayProxy) {
        // Send via relay to desktop, which forwards to gateway
        this.sendViaRelay(msg);
      } else {
        // Direct WebSocket connection
        this.ws.send(JSON.stringify(msg));
      }

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  setStatus(text, isConnected = false) {
    if (!this.elements.status) return;
    this.elements.status.textContent = text;
    this.elements.status.classList.toggle('connected', isConnected);
  }

  // Chat functionality
  async loadHistory() {
    try {
      const result = await this.request('chat.history', {
        sessionKey: this.sessionKey,
        limit: 100
      });

      if (result.messages && result.messages.length > 0) {
        const messages = result.messages.map(m => ({
          role: m.role,
          content: this.extractContent(m.content),
          timestamp: m.timestamp
        })).filter(m => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim());

        // Find existing chat that matches this session's history
        // Match by first user message content (most reliable identifier)
        const firstUserMsg = messages.find(m => m.role === 'user');
        let existingChatId = null;
        
        if (firstUserMsg) {
          const firstMsgContent = firstUserMsg.content.slice(0, 100);
          existingChatId = Object.keys(this.chats).find(chatId => {
            const chat = this.chats[chatId];
            const chatFirstUser = chat.messages?.find(m => m.role === 'user');
            return chatFirstUser && chatFirstUser.content.slice(0, 100) === firstMsgContent;
          });
        }
        
        // Use existing chat or create new
        if (existingChatId) {
          this.currentChatId = existingChatId;
        } else if (!this.currentChatId) {
          this.currentChatId = this.generateId();
        }

        // Update chat with latest messages
        const existingChat = this.chats[this.currentChatId];
        this.chats[this.currentChatId] = {
          id: this.currentChatId,
          title: existingChat?.title || this.generateTitle(messages),
          messages: messages,
          createdAt: existingChat?.createdAt || messages[0]?.timestamp || Date.now(),
          updatedAt: Date.now(),
          pinned: existingChat?.pinned,
          pinnedOrder: existingChat?.pinnedOrder,
          metadata: existingChat?.metadata
        };

        this.saveChats();
        this.renderChatList();
        this.renderMessages();
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }

  extractContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }
    return '';
  }

  generateTitle(messages) {
    const firstUserMsg = messages.find(m => m.role === 'user');
    if (firstUserMsg) {
      const text = firstUserMsg.content.slice(0, 30);
      return text.length < firstUserMsg.content.length ? text + '...' : text;
    }
    return 'New chat';
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  newChat() {
    // Trigger summary for the chat we're leaving
    if (this.currentChatId) {
      this.maybeGenerateSummary(this.currentChatId);
    }
    
    this.currentChatId = null;
    this.elements.welcome.style.display = 'flex';
    this.renderMessages();
    this.renderChatList();
    this.updateTokenDisplay();
    this.elements.messageInput.focus();
    this.elements.sidebar.classList.remove('open');
  }

  selectChat(chatId) {
    // Trigger summary for the chat we're leaving (if applicable)
    if (this.currentChatId && this.currentChatId !== chatId) {
      this.maybeGenerateSummary(this.currentChatId);
    }
    
    this.currentChatId = chatId;
    this.renderMessages();
    this.renderChatList();
    this.updateTokenDisplay(); // Also updates model display
    this.elements.sidebar.classList.remove('open');
  }

  deleteChat(chatId) {
    if (confirm('Delete this chat?')) {
      delete this.chats[chatId];
      this.saveChats();
      if (this.currentChatId === chatId) {
        this.newChat();
      } else {
        this.renderChatList();
      }
    }
  }

  togglePin(chatId) {
    const chat = this.chats[chatId];
    if (!chat) return;
    
    if (chat.pinned) {
      // Unpin
      chat.pinned = false;
      delete chat.pinnedOrder;
    } else {
      // Pin - add to end of pinned list
      const pinnedChats = Object.values(this.chats).filter(c => c.pinned);
      const maxOrder = pinnedChats.reduce((max, c) => Math.max(max, c.pinnedOrder || 0), 0);
      chat.pinned = true;
      chat.pinnedOrder = maxOrder + 1;
    }
    
    this.saveChats();
    this.renderChatList();
  }

  handleDragStart(e, chatId) {
    this.draggedChatId = chatId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', chatId);
    // Delay adding class so the drag image isn't affected
    setTimeout(() => e.target.classList.add('dragging'), 0);
  }

  handleDragOver(e, chatId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Highlight the target (sticky - whole item is the zone)
    if (chatId !== this.draggedChatId) {
      // Clear other highlights
      document.querySelectorAll('.chat-item.drag-over').forEach(item => {
        if (item.dataset.id !== chatId) item.classList.remove('drag-over');
      });
      e.currentTarget.classList.add('drag-over');
    }
  }

  handleDrop(e, targetChatId) {
    e.preventDefault();
    const draggedId = this.draggedChatId;
    
    if (!draggedId || draggedId === targetChatId) return;
    
    const draggedChat = this.chats[draggedId];
    const targetChat = this.chats[targetChatId];
    
    if (!draggedChat || !targetChat) return;
    
    // Case 1: Both pinned - swap positions
    if (draggedChat.pinned && targetChat.pinned) {
      const draggedOrder = draggedChat.pinnedOrder;
      draggedChat.pinnedOrder = targetChat.pinnedOrder;
      targetChat.pinnedOrder = draggedOrder;
    }
    // Case 2: Dragging unpinned onto pinned - take its spot, displaced goes to end
    else if (!draggedChat.pinned && targetChat.pinned) {
      // Find the max pinned order
      const maxOrder = Object.values(this.chats)
        .filter(c => c.pinned)
        .reduce((max, c) => Math.max(max, c.pinnedOrder || 0), 0);
      
      // New chat takes the target's position
      draggedChat.pinned = true;
      draggedChat.pinnedOrder = targetChat.pinnedOrder;
      
      // Displaced chat goes to end of pinned list
      targetChat.pinnedOrder = maxOrder + 1;
    }
    // Case 3: Dragging pinned onto unpinned - unpin
    else if (draggedChat.pinned && !targetChat.pinned) {
      draggedChat.pinned = false;
      delete draggedChat.pinnedOrder;
    }
    
    this.saveChats();
    this.renderChatList();
  }

  handleDragEnd(e) {
    this.draggedChatId = null;
    document.querySelectorAll('.chat-item').forEach(item => {
      item.classList.remove('dragging', 'drag-over');
    });
  }

  renderChatList() {
    // Separate pinned and unpinned
    const allChats = Object.entries(this.chats);
    const pinnedChats = allChats
      .filter(([_, c]) => c.pinned)
      .sort((a, b) => (a[1].pinnedOrder || 0) - (b[1].pinnedOrder || 0));
    
    // For unpinned: group branches with their parents
    const unpinnedRaw = allChats.filter(([_, c]) => !c.pinned);
    
    // Find the root ancestor for any chat
    const getRootId = (chatId) => {
      const chat = this.chats[chatId];
      if (!chat || !chat.parentId || !this.chats[chat.parentId]) return chatId;
      return getRootId(chat.parentId);
    };
    
    // Find root chats (no parent, or parent doesn't exist)
    const rootChats = unpinnedRaw.filter(([_, c]) => !c.parentId || !this.chats[c.parentId]);
    // Find branch chats (have a valid parent)
    const branchChats = unpinnedRaw.filter(([_, c]) => c.parentId && this.chats[c.parentId]);
    
    // Group ALL branches by their ROOT ancestor (not just direct parent)
    const branchesByRoot = {};
    branchChats.forEach(([id, chat]) => {
      const rootId = getRootId(id);
      if (!branchesByRoot[rootId]) {
        branchesByRoot[rootId] = [];
      }
      branchesByRoot[rootId].push([id, chat]);
    });
    
    // Sort branches within each group by creation time
    Object.values(branchesByRoot).forEach(branches => {
      branches.sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    });
    
    // Sort root chats by most recent activity (including all their descendants)
    const getRootActivity = (rootId, rootChat) => {
      const branches = branchesByRoot[rootId] || [];
      const branchTimes = branches.map(([_, c]) => c.updatedAt || 0);
      return Math.max(rootChat.updatedAt || 0, ...branchTimes);
    };
    
    rootChats.sort((a, b) => getRootActivity(b[0], b[1]) - getRootActivity(a[0], a[1]));
    
    // Build unpinned list with branches following their root ancestors
    const unpinnedChats = [];
    rootChats.forEach(([id, chat]) => {
      unpinnedChats.push([id, chat, false]); // false = not a branch
      const branches = branchesByRoot[id] || [];
      branches.forEach(([branchId, branchChat]) => {
        unpinnedChats.push([branchId, branchChat, true]); // true = is a branch
      });
    });

    let html = '';

    // Render pinned section
    if (pinnedChats.length > 0) {
      const visiblePinned = pinnedChats.slice(0, 5);
      const hiddenPinned = pinnedChats.slice(5);
      const isExpanded = this.pinnedExpanded;

      html += '<div class="pinned-section">';
      html += `<div class="section-header"><svg class="pin-icon pinned" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;margin-right:4px;vertical-align:middle;"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>Pinned</div>`;
      
      visiblePinned.forEach(([id, chat]) => {
        html += this.renderChatItem(id, chat, true);
      });

      if (hiddenPinned.length > 0) {
        html += `<button class="expand-pinned-btn" id="expandPinnedBtn">
          ${isExpanded ? '▼' : '▶'} ${hiddenPinned.length} more pinned
        </button>`;
        
        if (isExpanded) {
          html += '<div class="hidden-pinned">';
          hiddenPinned.forEach(([id, chat]) => {
            html += this.renderChatItem(id, chat, true);
          });
          html += '</div>';
        }
      }
      
      html += '</div>';
    }

    // Render unpinned section
    if (unpinnedChats.length > 0) {
      if (pinnedChats.length > 0) {
        html += '<div class="section-header">Recent</div>';
      }
      unpinnedChats.forEach(([id, chat, isBranch]) => {
        html += this.renderChatItem(id, chat, false, isBranch);
      });
    }

    this.elements.chatList.innerHTML = html;

    // Add click handlers
    this.elements.chatList.querySelectorAll('.chat-item').forEach(item => {
      const chatId = item.dataset.id;
      
      item.addEventListener('click', (e) => {
        if (e.target.closest('.pin-btn') || e.target.closest('.delete-btn') || e.target.closest('.rename-btn')) return;
        this.selectChat(chatId);
      });

      // Drag handlers for all items
      item.addEventListener('dragstart', (e) => this.handleDragStart(e, chatId));
      item.addEventListener('dragover', (e) => this.handleDragOver(e, chatId));
      item.addEventListener('drop', (e) => this.handleDrop(e, chatId));
      item.addEventListener('dragend', (e) => this.handleDragEnd(e));
    });

    this.elements.chatList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteChat(btn.dataset.id);
      });
    });

    this.elements.chatList.querySelectorAll('.pin-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePin(btn.dataset.id);
      });
    });
    
    this.elements.chatList.querySelectorAll('.rename-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        console.log('Rename btn clicked, dataset.id:', btn.dataset.id);
        e.stopPropagation();
        this.renameChat(btn.dataset.id);
      });
    });

    const expandBtn = document.getElementById('expandPinnedBtn');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        this.pinnedExpanded = !this.pinnedExpanded;
        this.renderChatList();
      });
    }
  }

  renderChatItem(id, chat, isPinned, isBranch = false) {
    const isActive = id === this.currentChatId;
    const pinTitle = isPinned ? 'Unpin' : 'Pin';
    const hasSummary = chat.metadata?.summary;
    const pinIcon = `<svg class="pin-icon ${isPinned ? 'pinned' : ''}" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="17" x2="12" y2="22"/>
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
    </svg>`;
    const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>`;
    const branchIcon = `<svg class="branch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="6" y1="3" x2="6" y2="15"/>
      <circle cx="18" cy="6" r="3"/>
      <circle cx="6" cy="18" r="3"/>
      <path d="M18 9a9 9 0 0 1-9 9"/>
    </svg>`;
    const summaryIndicator = hasSummary ? `<span class="summary-indicator" title="${this.escapeHtml(chat.metadata.summary)}">✨</span>` : '';
    const branchIndicator = isBranch ? `<span class="branch-indicator">${branchIcon}</span>` : '';
    
    return `
      <div class="chat-item ${isActive ? 'active' : ''} ${isPinned ? 'pinned' : ''} ${isBranch ? 'branch' : ''}" data-id="${id}" data-pinned="${isPinned}" draggable="true">
        <span class="chat-title">${branchIndicator}${summaryIndicator}${this.escapeHtml(chat.title)}</span>
        <div class="chat-actions">
          <button class="rename-btn" data-id="${id}" title="Rename">${editIcon}</button>
          <button class="pin-btn" data-id="${id}" title="${pinTitle}">${pinIcon}</button>
          <button class="delete-btn" data-id="${id}" title="Delete">&times;</button>
        </div>
      </div>
    `;
  }
  
  renameChat(chatId) {
    console.log('renameChat called with:', chatId);
    const chat = this.chats[chatId];
    if (!chat) {
      console.log('Chat not found:', chatId);
      return;
    }
    
    // Store the chatId for the save handler
    this.renamingChatId = chatId;
    
    // Show the rename modal
    const modal = document.getElementById('renameModal');
    const input = document.getElementById('renameChatInput');
    input.value = chat.title;
    modal.classList.add('open');
    
    // Focus and select the input text
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }
  
  saveRename() {
    const input = document.getElementById('renameChatInput');
    const newTitle = input.value.trim();
    
    if (newTitle && this.renamingChatId) {
      const chat = this.chats[this.renamingChatId];
      if (chat) {
        chat.title = newTitle;
        this.saveChats();
        this.renderChatList();
      }
    }
    
    this.closeRenameModal();
  }
  
  closeRenameModal() {
    const modal = document.getElementById('renameModal');
    modal.classList.remove('open');
    this.renamingChatId = null;
  }

  renderMessages() {
    const chat = this.currentChatId ? this.chats[this.currentChatId] : null;

    if (!chat || chat.messages.length === 0) {
      this.elements.welcome.style.display = 'flex';
      this.elements.messages.innerHTML = '';
      this.elements.messages.appendChild(this.elements.welcome);
      return;
    }

    this.elements.welcome.style.display = 'none';

    // Filter out empty messages, keeping track of original indices
    const visibleMessages = [];
    chat.messages.forEach((msg, originalIdx) => {
      if (msg.content && msg.content.trim()) {
        visibleMessages.push({ msg, originalIdx });
      }
    });
    
    this.elements.messages.innerHTML = visibleMessages.map(({ msg, originalIdx }, displayIdx) => {
      const isUser = msg.role === 'user';
      const isLastAssistant = !isUser && displayIdx === visibleMessages.length - 1;
      const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      const speakIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
      const stopIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
      const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
      const regenIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`;
      
      // Render images if present
      // Check for session images first (current session), then fall back to placeholder
      const msgKey = `${this.currentChatId}-${originalIdx}`;
      const sessionImgs = this.sessionImages?.get(msgKey);
      let imagesHtml = '';
      
      if (sessionImgs && sessionImgs.length > 0) {
        // Have actual images from current session
        imagesHtml = `<div class="message-images">${sessionImgs.map(img => 
          `<img src="${img.base64}" alt="${this.escapeHtml(img.name || 'image')}" title="${this.escapeHtml(img.name || 'image')}" onclick="window.open('${img.base64}', '_blank')">`
        ).join('')}</div>`;
      } else if (msg.imageNames && msg.imageNames.length > 0) {
        // Historical message - show filenames
        imagesHtml = `<div class="message-images-placeholder">${msg.imageNames.map(name => 
          `<span class="image-name">🖼️ ${this.escapeHtml(name)}</span>`
        ).join('')}</div>`;
      } else if (msg.imageCount > 0) {
        // Legacy format with count only
        imagesHtml = `<div class="message-images-placeholder">🖼️ ${msg.imageCount} image${msg.imageCount > 1 ? 's' : ''} attached</div>`;
      } else if (msg.images && msg.images.length > 0) {
        // Legacy format (old chats that still have images stored)
        imagesHtml = `<div class="message-images">${msg.images.map(img => 
          `<img src="${img.base64}" alt="Uploaded image" onclick="window.open('${img.base64}', '_blank')">`
        ).join('')}</div>`;
      }
      
      // Render text files if present
      const textFilesHtml = msg.textFiles && msg.textFiles.length > 0
        ? `<div class="message-text-files">${msg.textFiles.map(f => {
            const ext = f.name.split('.').pop()?.toLowerCase() || 'txt';
            return `<div class="message-text-file" title="${this.escapeHtml(f.name)}">
              <span class="message-text-file-icon">${this.getFileIcon(ext)}</span>
              <span>${this.escapeHtml(f.name)}</span>
            </div>`;
          }).join('')}</div>`
        : '';
      
      return `
        <div class="message ${msg.role}" data-idx="${originalIdx}">
          <div class="message-header">
            <div class="avatar ${msg.role}">${isUser ? 'You' : 'AI'}</div>
            <span class="message-role">${isUser ? 'You' : 'ClawGPT'}</span>
          </div>
          ${imagesHtml}
          ${textFilesHtml}
          <div class="message-content">${this.formatContent(msg.content)}</div>
          <div class="message-actions">
            <button class="msg-action-btn copy-btn" title="Copy">${copyIcon}</button>
            ${!isUser && this.ttsSupported !== false ? `<button class="msg-action-btn speak-btn" title="Read aloud" data-speak-icon='${speakIcon}' data-stop-icon='${stopIcon}'>${speakIcon}</button>` : ''}
            ${isUser ? `<button class="msg-action-btn edit-btn" title="Edit">${editIcon}</button>` : ''}
            ${isLastAssistant ? `<button class="msg-action-btn regen-btn" title="Regenerate">${regenIcon}</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
    
    // Add message action handlers
    this.attachMessageActions();
    
    // Update conversation token total
    this.updateTokenDisplay();

    // Add streaming indicator if needed
    if (this.streaming) {
      const streamDiv = document.createElement('div');
      streamDiv.className = 'message assistant';
      streamDiv.id = 'streaming-message';
      streamDiv.innerHTML = `
        <div class="message-header">
          <div class="avatar assistant">AI</div>
          <span class="message-role">ClawGPT</span>
        </div>
        <div class="message-content">${this.formatContent(this.streamBuffer) || '<div class="typing-indicator"><span></span><span></span><span></span></div>'}</div>
      `;
      this.elements.messages.appendChild(streamDiv);
    }

    this.scrollToBottom();
    this.highlightCode();
  }
  
  attachMessageActions() {
    // Copy buttons
    this.elements.messages.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const msgEl = e.target.closest('.message');
        const content = msgEl.querySelector('.message-content').textContent;
        navigator.clipboard.writeText(content).then(() => {
          btn.classList.add('copied');
          btn.innerHTML = '✓';
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
          }, 1500);
        });
      });
    });
    
    // Edit buttons (user messages only)
    this.elements.messages.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const msgEl = e.target.closest('.message');
        const idx = parseInt(msgEl.dataset.idx);
        this.editMessage(idx);
      });
    });
    
    // Regenerate button (last AI message only)
    this.elements.messages.querySelectorAll('.regen-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.regenerateResponse();
      });
    });
    
    // Speak buttons (AI messages)
    this.elements.messages.querySelectorAll('.speak-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const msgEl = e.target.closest('.message');
        const content = msgEl.querySelector('.message-content').textContent;
        this.toggleSpeech(btn, content);
      });
    });
  }
  
  editMessage(idx) {
    const chat = this.chats[this.currentChatId];
    if (!chat || !chat.messages[idx]) return;
    
    const msg = chat.messages[idx];
    if (msg.role !== 'user') return;
    
    // Store edit context for the save handler
    this.editingMessageIdx = idx;
    this.editingChatId = this.currentChatId;
    
    // Show the edit modal
    const modal = this.elements.editMessageModal;
    const input = this.elements.editMessageInput;
    input.value = msg.content;
    modal.classList.add('open');
    
    // Focus and select the input text
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }
  
  saveEditMessage() {
    const input = this.elements.editMessageInput;
    const newContent = input.value.trim();
    
    if (!newContent || this.editingMessageIdx === null || !this.editingChatId) {
      this.closeEditMessageModal();
      return;
    }
    
    const originalChat = this.chats[this.editingChatId];
    if (!originalChat) {
      this.closeEditMessageModal();
      return;
    }
    
    // Find the root chat (follow parent chain to top)
    const getRootChat = (chatId) => {
      const chat = this.chats[chatId];
      if (!chat || !chat.parentId || !this.chats[chat.parentId]) return chat;
      return getRootChat(chat.parentId);
    };
    const rootChat = getRootChat(this.editingChatId);
    
    // Count existing branches from this root
    const rootId = rootChat?.id || this.editingChatId;
    const existingBranches = Object.values(this.chats).filter(c => {
      if (!c.parentId) return false;
      // Check if this chat's root is our root
      const itsRoot = getRootChat(c.id);
      return itsRoot?.id === rootId;
    });
    const branchNumber = existingBranches.length + 1;
    
    // Create a new branched chat
    const branchId = this.generateId();
    const rootTitle = rootChat?.title || originalChat.title;
    const branchTitle = `Branch ${branchNumber}: ${rootTitle}`;
    
    // Copy messages up to (but not including) the edited message
    const messagesBeforeEdit = originalChat.messages.slice(0, this.editingMessageIdx);
    
    // Add the new edited message
    const editedMessage = {
      role: 'user',
      content: newContent
    };
    
    // Create the branched chat with parent reference
    this.chats[branchId] = {
      id: branchId,
      title: branchTitle,
      messages: [...messagesBeforeEdit, editedMessage],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      parentId: this.editingChatId
    };
    
    this.saveChats();
    this.closeEditMessageModal();
    
    // Switch to the branched chat
    this.selectChat(branchId);
    
    // Send to get new response
    this.resendLastUserMessage();
  }
  
  closeEditMessageModal() {
    this.elements.editMessageModal.classList.remove('open');
    this.editingMessageIdx = null;
    this.editingChatId = null;
  }
  
  regenerateResponse() {
    const chat = this.chats[this.currentChatId];
    if (!chat || chat.messages.length < 2) return;
    
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (lastMsg.role !== 'assistant') return;
    
    // If we have models available, show the modal
    const availableModels = this.getAvailableModels();
    if (availableModels.length > 0) {
      this.showRegenerateModal();
    } else {
      // No models loaded, just regenerate with current model
      this.doRegenerate(null);
    }
  }
  
  showRegenerateModal() {
    // Populate the model dropdown with filtered models
    const select = this.elements.regenerateModelSelect;
    const currentLabel = this.currentModelId ? `Current (${this.currentModelId})` : 'Current model';
    select.innerHTML = `<option value="">${currentLabel}</option>`;
    
    const availableModels = this.getAvailableModels();
    availableModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      
      // Clean up the name - remove "(latest)" suffix since we're only showing latest
      let label = (model.name || model.id).replace(' (latest)', '');
      
      // Add description
      const desc = this.getModelDescription(model.id);
      if (desc) label += ` — ${desc}`;
      
      // Add reasoning indicator
      if (model.reasoning) label += ' ⚡';
      
      option.textContent = label;
      select.appendChild(option);
    });
    
    this.elements.regenerateModal.classList.add('open');
    select.focus();
  }
  
  closeRegenerateModal() {
    this.elements.regenerateModal.classList.remove('open');
  }
  
  async confirmRegenerate() {
    const selectedModel = this.elements.regenerateModelSelect.value;
    this.closeRegenerateModal();
    await this.doRegenerate(selectedModel || null);
  }
  
  async doRegenerate(modelId) {
    const chat = this.chats[this.currentChatId];
    if (!chat || chat.messages.length < 2) return;
    
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (lastMsg.role !== 'assistant') return;
    
    // If a different model was selected, switch via /model command
    let switchedModel = null;
    if (modelId) {
      try {
        // Find the model to get its provider (prefer anthropic for Claude, openai for GPT)
        const models = this.allModels?.filter(m => m.id === modelId) || [];
        let model = models.find(m => m.provider === 'anthropic') 
                 || models.find(m => m.provider === 'openai')
                 || models[0];
        
        const fullModelId = model ? `${model.provider}/${modelId}` : modelId;
        
        console.log('Switching model via /model command:', fullModelId);
        
        // Send /model command to switch (this doesn't require admin scope)
        await this.request('chat.send', {
          sessionKey: this.sessionKey,
          message: `/model ${fullModelId}`,
          deliver: false,
          idempotencyKey: 'model-switch-' + this.generateId()
        });
        
        // Wait a moment for the model switch to take effect
        await new Promise(resolve => setTimeout(resolve, 500));
        
        switchedModel = model?.name || modelId;
        console.log('Switched to model:', fullModelId);
      } catch (error) {
        console.error('Failed to set model:', error);
        // Continue anyway - might work with current model
      }
    }
    
    // Create a branch to preserve the original response
    const branchId = this.generateId();
    
    // Find the root chat for naming
    const getRootChat = (chatId) => {
      const c = this.chats[chatId];
      if (!c || !c.parentId || !this.chats[c.parentId]) return c;
      return getRootChat(c.parentId);
    };
    const rootChat = getRootChat(this.currentChatId);
    const rootId = rootChat?.id || this.currentChatId;
    
    // Count existing regens for this root
    const existingRegens = Object.values(this.chats).filter(c => {
      if (!c.parentId || !c.isRegen) return false;
      const itsRoot = getRootChat(c.id);
      return itsRoot?.id === rootId;
    });
    const regenNumber = existingRegens.length + 1;
    
    // Create regen title - mention model if switched
    const rootTitle = rootChat?.title || chat.title;
    let branchTitle = `Regen ${regenNumber}: ${rootTitle}`;
    if (switchedModel) {
      branchTitle = `Regen ${regenNumber} (${switchedModel}): ${rootTitle}`;
    }
    
    // Copy messages WITHOUT the last assistant message
    const messagesWithoutLast = chat.messages.slice(0, -1);
    
    // Create the regen chat
    this.chats[branchId] = {
      id: branchId,
      title: branchTitle,
      messages: [...messagesWithoutLast],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      parentId: this.currentChatId,
      isRegen: true, // Flag to distinguish from edit branches
      model: modelId || chat.model || this.currentModelId // Track model used
    };
    
    this.saveChats();
    
    // Switch to the branched chat
    this.selectChat(branchId);
    
    // Re-send to get new response (with regenerate flag to branch server-side session)
    this.resendLastUserMessage({ regenerate: true });
  }
  
  async fetchModels() {
    try {
      const result = await this.request('models.list', {});
      if (result?.models) {
        this.allModels = result.models;
        console.log('Loaded', this.allModels.length, 'models');
      }
      
      // Also get current session info to know what model family we're using
      const status = await this.request('status', {});
      if (status?.sessions?.defaults?.model) {
        this.currentModelId = status.sessions.defaults.model;
        this.currentModelFamily = this.detectModelFamily(this.currentModelId);
        console.log('Current model:', this.currentModelId, 'Family:', this.currentModelFamily);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
      this.allModels = [];
    }
  }
  
  detectModelFamily(modelId) {
    // Detect model family from model ID patterns
    const id = modelId.toLowerCase();
    if (id.includes('claude')) return 'claude';
    if (id.includes('gpt-4') || id.includes('gpt-5')) return 'gpt';
    if (id.includes('o1') || id.includes('o3') || id.includes('o4')) return 'openai-reasoning';
    if (id.includes('gemini')) return 'gemini';
    if (id.includes('llama')) return 'llama';
    if (id.includes('mistral') || id.includes('codestral')) return 'mistral';
    if (id.includes('deepseek')) return 'deepseek';
    if (id.includes('qwen')) return 'qwen';
    return null;
  }
  
  getAvailableModels() {
    if (!this.allModels) return [];
    
    // Detect the model family from current model
    const family = this.detectModelFamily(this.currentModelId);
    if (!family) return this.allModels.slice(0, 20); // Fallback: show first 20
    
    // Filter to only models from the same family AND from anthropic provider for Claude
    // (to avoid duplicate entries from openrouter, opencode, etc.)
    let familyModels = this.allModels.filter(m => {
      const modelFamily = this.detectModelFamily(m.id);
      if (modelFamily !== family) return false;
      
      // For Claude models, prefer the "anthropic" provider to avoid duplicates
      if (family === 'claude') {
        return m.provider === 'anthropic';
      }
      // For GPT models, prefer "openai" provider
      if (family === 'gpt' || family === 'openai-reasoning') {
        return m.provider === 'openai';
      }
      // For others, allow any provider but dedupe by ID
      return true;
    });
    
    // Filter out deprecated/old models - keep only current generation
    if (family === 'claude') {
      familyModels = familyModels.filter(m => {
        const id = m.id.toLowerCase();
        // Skip: 3.x models (deprecated)
        if (id.includes('claude-3-') || id.includes('claude-3.')) return false;
        // Skip dated versions if we have a "latest" alias - only keep latest aliases
        // e.g., skip "claude-opus-4-5-20251101" if "claude-opus-4-5" exists
        if (id.match(/-\d{8}$/)) return false; // ends with date like -20251101
        return true;
      });
    }
    
    // Dedupe by model ID (keep first occurrence)
    const seen = new Set();
    return familyModels.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }
  
  getModelDescription(modelId) {
    const id = modelId.toLowerCase();
    if (id.includes('haiku')) return 'fast & affordable';
    if (id.includes('sonnet')) return 'balanced';
    if (id.includes('opus')) return 'most capable';
    return '';
  }
  
  async resendLastUserMessage(opts = {}) {
    const chat = this.chats[this.currentChatId];
    if (!chat || !this.connected) return;
    
    const lastUserMsg = [...chat.messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    
    // Start streaming
    this.streaming = true;
    this.streamBuffer = '';
    this.updateStreamingUI();
    this.renderMessages();

    try {
      this.addTokens(this.estimateTokens(lastUserMsg.content));
      
      await this.request('chat.send', {
        sessionKey: this.sessionKey,
        message: lastUserMsg.content,
        deliver: false,
        idempotencyKey: this.generateId()
      });
    } catch (error) {
      console.error('Resend failed:', error);
      this.streaming = false;
      this.updateStreamingUI();
    }
  }

  formatContent(content) {
    if (!content) return '';

    // Store code blocks temporarily to protect them from other transformations
    const codeBlocks = [];
    let html = content;
    
    // Extract and placeholder code blocks first
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
      const index = codeBlocks.length;
      // Map common language aliases
      const langMap = {
        'js': 'javascript',
        'ts': 'typescript',
        'py': 'python',
        'rb': 'ruby',
        'sh': 'bash',
        'shell': 'bash',
        'yml': 'yaml',
        'md': 'markdown'
      };
      const language = langMap[lang] || lang || '';
      codeBlocks.push({ language, code: code.trim() });
      return `__CODEBLOCK_${index}__`;
    });
    
    // Now escape HTML for the rest
    html = this.escapeHtml(html);

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');
    
    // Restore code blocks with proper formatting and copy button
    html = html.replace(/__CODEBLOCK_(\d+)__/g, (match, index) => {
      const block = codeBlocks[parseInt(index)];
      const langClass = block.language ? `language-${block.language}` : '';
      const langAttr = block.language ? `data-language="${block.language}"` : '';
      const escapedCode = this.escapeHtml(block.code);
      const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      return `<div class="code-block"><button class="code-copy-btn" title="Copy code">${copyIcon}</button><pre ${langAttr}><code class="${langClass}">${escapedCode}</code></pre></div>`;
    });

    return html;
  }
  
  highlightCode() {
    // Trigger Prism.js highlighting if available
    if (typeof Prism !== 'undefined') {
      Prism.highlightAll();
    }
    
    // Attach copy button handlers to code blocks
    this.elements.messages.querySelectorAll('.code-copy-btn').forEach(btn => {
      if (btn.dataset.bound) return; // Already bound
      btn.dataset.bound = 'true';
      
      btn.addEventListener('click', () => {
        const codeBlock = btn.closest('.code-block');
        const code = codeBlock.querySelector('code').textContent;
        
        navigator.clipboard.writeText(code).then(() => {
          btn.classList.add('copied');
          btn.innerHTML = '✓';
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
          }, 1500);
        });
      });
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Voice input
  initVoiceInput() {
    const voiceBtn = document.getElementById('voiceBtn');
    if (!voiceBtn) return;
    
    // Check for browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      voiceBtn.classList.add('unsupported');
      voiceBtn.title = 'Voice input not supported in this browser';
      return;
    }
    
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = navigator.language || 'en-US';
    
    this.isRecording = false;
    this.finalTranscript = '';
    
    this.recognition.onstart = () => {
      this.isRecording = true;
      voiceBtn.classList.add('recording');
      voiceBtn.title = 'Click to stop recording';
    };
    
    this.recognition.onend = () => {
      this.isRecording = false;
      voiceBtn.classList.remove('recording');
      voiceBtn.title = 'Voice input';
      
      // Append final transcript to input
      if (this.finalTranscript) {
        const input = this.elements.messageInput;
        const needsSpace = input.value && !input.value.endsWith(' ');
        input.value += (needsSpace ? ' ' : '') + this.finalTranscript;
        this.finalTranscript = '';
        this.onInputChange();
        input.focus();
      }
    };
    
    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          this.finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      
      // Show interim results in placeholder or as preview
      if (interimTranscript) {
        this.elements.messageInput.placeholder = interimTranscript + '...';
      }
    };
    
    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      this.isRecording = false;
      voiceBtn.classList.remove('recording');
      
      if (event.error === 'not-allowed') {
        this.showToast('Microphone access denied', true);
      } else if (event.error !== 'aborted') {
        this.showToast('Voice input error: ' + event.error, true);
      }
      
      this.elements.messageInput.placeholder = 'Message ClawGPT...';
    };
    
    voiceBtn.addEventListener('click', () => this.toggleVoiceInput());
  }
  
  toggleVoiceInput() {
    if (!this.recognition) return;
    
    if (this.isRecording) {
      this.recognition.stop();
    } else {
      this.finalTranscript = '';
      this.elements.messageInput.placeholder = 'Listening...';
      try {
        this.recognition.start();
      } catch (e) {
        // Already started, ignore
        console.log('Recognition already started');
      }
    }
  }
  
  // Image Upload
  initImageUpload() {
    this.pendingImages = [];
    this.pendingTextFiles = [];
    
    const attachBtn = document.getElementById('attachBtn');
    const fileInput = document.getElementById('fileInput');
    const imagePreview = document.getElementById('imagePreview');
    
    if (!attachBtn || !fileInput) return;
    
    // Click attach button opens file picker
    attachBtn.addEventListener('click', () => fileInput.click());
    
    // Handle file selection
    fileInput.addEventListener('change', (e) => {
      this.handleFiles(e.target.files);
      e.target.value = ''; // Reset so same file can be selected again
    });
    
    // Drag and drop
    const dropZone = document.querySelector('.main');
    if (dropZone) {
      // Create drag overlay
      const overlay = document.createElement('div');
      overlay.className = 'drag-overlay';
      overlay.innerHTML = '<div class="drag-overlay-text">Drop files here</div>';
      document.body.appendChild(overlay);
      
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        overlay.classList.add('active');
      });
      
      dropZone.addEventListener('dragleave', (e) => {
        if (!dropZone.contains(e.relatedTarget)) {
          overlay.classList.remove('active');
        }
      });
      
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.classList.remove('active');
        this.handleFiles(e.dataTransfer.files);
      });
      
      overlay.addEventListener('dragleave', () => {
        overlay.classList.remove('active');
      });
      
      overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.classList.remove('active');
        this.handleFiles(e.dataTransfer.files);
      });
    }
    
    // Paste from clipboard
    document.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter(item => item.type.startsWith('image/'));
      
      if (imageItems.length > 0) {
        e.preventDefault();
        const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
        this.handleFiles(files);
      }
    });
  }
  
  // Text file extensions we support
  isTextFile(file) {
    const textExtensions = ['.txt', '.md', '.json', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yaml', '.yml', '.csv', '.log', '.sh', '.bash', '.zsh', '.env', '.ini', '.conf', '.cfg'];
    const name = file.name.toLowerCase();
    return textExtensions.some(ext => name.endsWith(ext)) || file.type.startsWith('text/');
  }
  
  isPdfFile(file) {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  }
  
  isExcelFile(file) {
    const excelTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    const name = file.name.toLowerCase();
    return excelTypes.includes(file.type) || name.endsWith('.xlsx') || name.endsWith('.xls');
  }
  
  async handleFiles(files) {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        await this.handleImageFile(file);
      } else if (this.isTextFile(file)) {
        await this.handleTextFile(file);
      } else if (this.isPdfFile(file)) {
        await this.handlePdfFile(file);
      } else if (this.isExcelFile(file)) {
        await this.handleExcelFile(file);
      }
      // Silently ignore unsupported file types
    }
    
    this.updateFilePreview();
    this.onInputChange();
  }
  
  async handleImageFile(file) {
    const imagePreview = document.getElementById('imagePreview');
    
    // Convert to base64
    const base64 = await this.fileToBase64(file);
    const imageData = {
      id: Date.now() + Math.random(),
      base64,
      mimeType: file.type,
      name: file.name,
      type: 'image'
    };
    
    this.pendingImages.push(imageData);
    
    // Add preview
    const item = document.createElement('div');
    item.className = 'image-preview-item';
    item.dataset.imageId = imageData.id;
    item.innerHTML = `
      <img src="${base64}" alt="${file.name}">
      <button class="remove-image" title="Remove">×</button>
    `;
    
    item.querySelector('.remove-image').addEventListener('click', () => {
      this.removeImage(imageData.id);
    });
    
    imagePreview.appendChild(item);
  }
  
  async handleTextFile(file) {
    const imagePreview = document.getElementById('imagePreview');
    
    // Read file content as text
    const content = await this.fileToText(file);
    const textData = {
      id: Date.now() + Math.random(),
      content,
      name: file.name,
      type: 'text'
    };
    
    this.pendingTextFiles.push(textData);
    
    // Add preview (text file style)
    const item = document.createElement('div');
    item.className = 'image-preview-item text-file-item';
    item.dataset.textFileId = textData.id;
    
    // Get file extension for icon
    const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
    
    item.innerHTML = `
      <div class="text-file-preview">
        <div class="text-file-icon">${this.getFileIcon(ext)}</div>
        <div class="text-file-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</div>
        <div class="text-file-size">${this.formatFileSize(content.length)}</div>
      </div>
      <button class="remove-image" title="Remove">×</button>
    `;
    
    item.querySelector('.remove-image').addEventListener('click', () => {
      this.removeTextFile(textData.id);
    });
    
    imagePreview.appendChild(item);
  }
  
  async handlePdfFile(file) {
    const imagePreview = document.getElementById('imagePreview');
    
    // Add loading preview
    const loadingId = Date.now() + Math.random();
    const loadingItem = document.createElement('div');
    loadingItem.className = 'image-preview-item text-file-item loading';
    loadingItem.dataset.loadingId = loadingId;
    loadingItem.innerHTML = `
      <div class="text-file-preview">
        <div class="text-file-icon">📕</div>
        <div class="text-file-name">${this.escapeHtml(file.name)}</div>
        <div class="text-file-size">Loading...</div>
      </div>
    `;
    imagePreview.appendChild(loadingItem);
    this.updateFilePreview();
    
    try {
      // Lazy load pdf.js
      await this.loadPdfJs();
      
      // Read PDF
      const arrayBuffer = await this.fileToArrayBuffer(file);
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      // Extract text from all pages
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += `[Page ${i}]\n${pageText}\n\n`;
      }
      
      // Remove loading, add real preview
      loadingItem.remove();
      
      const textData = {
        id: Date.now() + Math.random(),
        content: fullText.trim(),
        name: file.name,
        type: 'text'
      };
      
      this.pendingTextFiles.push(textData);
      
      const item = document.createElement('div');
      item.className = 'image-preview-item text-file-item';
      item.dataset.textFileId = textData.id;
      item.innerHTML = `
        <div class="text-file-preview">
          <div class="text-file-icon">📕</div>
          <div class="text-file-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</div>
          <div class="text-file-size">${pdf.numPages} pages</div>
        </div>
        <button class="remove-image" title="Remove">×</button>
      `;
      
      item.querySelector('.remove-image').addEventListener('click', () => {
        this.removeTextFile(textData.id);
      });
      
      imagePreview.appendChild(item);
      this.onInputChange();
      
    } catch (error) {
      console.error('PDF parsing failed:', error);
      loadingItem.remove();
      this.showToast(`Failed to parse PDF: ${error.message}`, true);
    }
  }
  
  async handleExcelFile(file) {
    const imagePreview = document.getElementById('imagePreview');
    
    // Add loading preview
    const loadingId = Date.now() + Math.random();
    const loadingItem = document.createElement('div');
    loadingItem.className = 'image-preview-item text-file-item loading';
    loadingItem.dataset.loadingId = loadingId;
    loadingItem.innerHTML = `
      <div class="text-file-preview">
        <div class="text-file-icon">📗</div>
        <div class="text-file-name">${this.escapeHtml(file.name)}</div>
        <div class="text-file-size">Loading...</div>
      </div>
    `;
    imagePreview.appendChild(loadingItem);
    this.updateFilePreview();
    
    try {
      // Lazy load SheetJS
      await this.loadSheetJs();
      
      // Read Excel
      const arrayBuffer = await this.fileToArrayBuffer(file);
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      // Convert all sheets to text
      let fullText = '';
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        fullText += `[Sheet: ${sheetName}]\n${csv}\n\n`;
      }
      
      // Remove loading, add real preview
      loadingItem.remove();
      
      const textData = {
        id: Date.now() + Math.random(),
        content: fullText.trim(),
        name: file.name,
        type: 'text'
      };
      
      this.pendingTextFiles.push(textData);
      
      const item = document.createElement('div');
      item.className = 'image-preview-item text-file-item';
      item.dataset.textFileId = textData.id;
      item.innerHTML = `
        <div class="text-file-preview">
          <div class="text-file-icon">📗</div>
          <div class="text-file-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</div>
          <div class="text-file-size">${workbook.SheetNames.length} sheet${workbook.SheetNames.length > 1 ? 's' : ''}</div>
        </div>
        <button class="remove-image" title="Remove">×</button>
      `;
      
      item.querySelector('.remove-image').addEventListener('click', () => {
        this.removeTextFile(textData.id);
      });
      
      imagePreview.appendChild(item);
      this.onInputChange();
      
    } catch (error) {
      console.error('Excel parsing failed:', error);
      loadingItem.remove();
      this.showToast(`Failed to parse Excel: ${error.message}`, true);
    }
  }
  
  // Lazy load pdf.js library
  async loadPdfJs() {
    if (window.pdfjsLib) return;
    
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        // Set worker source
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load PDF library'));
      document.head.appendChild(script);
    });
  }
  
  // Lazy load SheetJS library
  async loadSheetJs() {
    if (window.XLSX) return;
    
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Excel library'));
      document.head.appendChild(script);
    });
  }
  
  fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  
  // Parse data URL into mimeType and base64 content
  parseDataUrl(dataUrl) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (match) {
      return { mimeType: match[1], content: match[2] };
    }
    // Fallback - assume it's already just base64
    return { mimeType: 'application/octet-stream', content: dataUrl };
  }
  
  getFileIcon(ext) {
    const icons = {
      'js': '📜',
      'ts': '📜',
      'py': '🐍',
      'json': '📋',
      'md': '📝',
      'txt': '📄',
      'html': '🌐',
      'css': '🎨',
      'xml': '📰',
      'yaml': '⚙️',
      'yml': '⚙️',
      'csv': '📊',
      'log': '📃',
      'sh': '⚡',
      'bash': '⚡',
      'zsh': '⚡',
      'env': '🔐',
      'ini': '⚙️',
      'conf': '⚙️',
      'cfg': '⚙️',
      'pdf': '📕',
      'xlsx': '📗',
      'xls': '📗'
    };
    return icons[ext] || '📄';
  }
  
  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  
  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  
  fileToText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
  
  removeImage(imageId) {
    this.pendingImages = this.pendingImages.filter(img => img.id !== imageId);
    const item = document.querySelector(`.image-preview-item[data-image-id="${imageId}"]`);
    if (item) item.remove();
    this.updateFilePreview();
    this.onInputChange();
  }
  
  removeTextFile(textFileId) {
    this.pendingTextFiles = this.pendingTextFiles.filter(f => f.id !== textFileId);
    const item = document.querySelector(`.image-preview-item[data-text-file-id="${textFileId}"]`);
    if (item) item.remove();
    this.updateFilePreview();
    this.onInputChange();
  }
  
  updateFilePreview() {
    const imagePreview = document.getElementById('imagePreview');
    if (this.pendingImages.length > 0 || this.pendingTextFiles.length > 0) {
      imagePreview.classList.add('has-images');
    } else {
      imagePreview.classList.remove('has-images');
    }
  }
  
  clearPendingImages() {
    this.pendingImages = [];
    this.pendingTextFiles = [];
    const imagePreview = document.getElementById('imagePreview');
    imagePreview.innerHTML = '';
    imagePreview.classList.remove('has-images');
  }

  // Text-to-Speech
  initSpeechSynthesis() {
    if (!('speechSynthesis' in window)) {
      this.ttsSupported = false;
      return;
    }
    
    this.ttsSupported = true;
    this.currentSpeakBtn = null;
    this.voices = [];
    
    // Load voices (may be async)
    this.loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
  }
  
  loadVoices() {
    this.voices = speechSynthesis.getVoices();
    console.log('TTS voices loaded:', this.voices.length);
    
    // Hide speak buttons if no voices available
    if (this.voices.length === 0) {
      document.querySelectorAll('.speak-btn').forEach(btn => {
        btn.style.display = 'none';
      });
      this.ttsSupported = false;
      return;
    }
    
    // Show speak buttons if voices become available
    document.querySelectorAll('.speak-btn').forEach(btn => {
      btn.style.display = '';
    });
    this.ttsSupported = true;
    
    // Log available voices for debugging
    console.log('Available voices:', this.voices.map(v => `${v.name} (${v.lang})`).slice(0, 10));
    
    // Prefer Google UK English Female, then any UK female, then any English
    this.preferredVoice = 
      this.voices.find(v => v.name === 'Google UK English Female') ||
      this.voices.find(v => v.name.includes('UK') && v.name.toLowerCase().includes('female')) ||
      this.voices.find(v => v.lang === 'en-GB') ||
      this.voices.find(v => v.lang.startsWith('en-GB')) ||
      this.voices.find(v => v.lang.startsWith('en')) ||
      this.voices[0];
    
    if (this.preferredVoice) {
      console.log('TTS preferred voice:', this.preferredVoice.name, this.preferredVoice.lang);
    }
  }
  
  toggleSpeech(btn, text) {
    if (!this.ttsSupported) {
      this.showToast('Text-to-speech not supported', true);
      return;
    }
    
    const speakIcon = btn.dataset.speakIcon;
    const stopIcon = btn.dataset.stopIcon;
    
    // If already speaking this message, stop it
    if (this.currentSpeakBtn === btn && speechSynthesis.speaking) {
      speechSynthesis.cancel();
      btn.innerHTML = speakIcon;
      btn.classList.remove('speaking');
      btn.title = 'Read aloud';
      this.currentSpeakBtn = null;
      return;
    }
    
    // Stop any current speech
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      if (this.currentSpeakBtn) {
        this.currentSpeakBtn.innerHTML = this.currentSpeakBtn.dataset.speakIcon;
        this.currentSpeakBtn.classList.remove('speaking');
        this.currentSpeakBtn.title = 'Read aloud';
      }
    }
    
    // Ensure voices are loaded
    if (this.voices.length === 0) {
      this.loadVoices();
    }
    
    // Start speaking
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Set voice if available, otherwise let browser use default
    if (this.preferredVoice) {
      utterance.voice = this.preferredVoice;
    }
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.lang = 'en-GB'; // Hint for language even without specific voice
    
    utterance.onstart = () => {
      btn.innerHTML = stopIcon;
      btn.classList.add('speaking');
      btn.title = 'Stop reading';
      this.currentSpeakBtn = btn;
    };
    
    utterance.onend = () => {
      btn.innerHTML = speakIcon;
      btn.classList.remove('speaking');
      btn.title = 'Read aloud';
      this.currentSpeakBtn = null;
    };
    
    utterance.onerror = (e) => {
      console.error('Speech error:', e.error);
      btn.innerHTML = speakIcon;
      btn.classList.remove('speaking');
      btn.title = 'Read aloud';
      this.currentSpeakBtn = null;
      
      if (e.error === 'synthesis-failed' || e.error === 'audio-busy') {
        // Try again without specific voice
        if (this.preferredVoice) {
          console.log('Retrying with default voice...');
          this.preferredVoice = null;
          setTimeout(() => this.toggleSpeech(btn, text), 100);
        } else {
          this.showToast('Speech synthesis failed', true);
        }
      } else if (e.error !== 'interrupted' && e.error !== 'canceled') {
        this.showToast('Speech error: ' + e.error, true);
      }
    };
    
    // Chrome bug workaround: speech can get stuck, cancel and retry
    speechSynthesis.cancel();
    setTimeout(() => {
      speechSynthesis.speak(utterance);
    }, 50);
  }

  scrollToBottom() {
    this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
  }

  async sendMessage() {
    const text = this.elements.messageInput.value.trim();
    const hasImages = this.pendingImages && this.pendingImages.length > 0;
    const hasTextFiles = this.pendingTextFiles && this.pendingTextFiles.length > 0;
    
    // Need either text, images, or text files
    if ((!text && !hasImages && !hasTextFiles) || !this.connected) return;

    // Clear input
    this.elements.messageInput.value = '';
    this.elements.messageInput.style.height = 'auto';
    this.elements.sendBtn.disabled = true;

    // Create chat if needed
    if (!this.currentChatId) {
      this.currentChatId = this.generateId();
      this.chats[this.currentChatId] = {
        id: this.currentChatId,
        title: (text || 'Image').slice(0, 30) + ((text || '').length > 30 ? '...' : ''),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }

    // Build message content
    let messageContent = text;
    let images = null;
    let textFiles = null;
    
    // Build the full text content (including text file contents)
    let fullText = text;
    if (hasTextFiles) {
      // Store text files for display
      textFiles = this.pendingTextFiles.map(f => ({
        name: f.name,
        content: f.content
      }));
      
      // Prepend file contents to the message
      const fileContents = this.pendingTextFiles.map(f => 
        `--- ${f.name} ---\n${f.content}\n--- end ${f.name} ---`
      ).join('\n\n');
      
      fullText = text 
        ? `${fileContents}\n\n${text}`
        : fileContents;
    }
    
    // Build attachments array for images (OpenClaw format)
    let attachments = null;
    if (hasImages) {
      // Store images for display (includes name for session display)
      images = this.pendingImages.map(img => ({
        base64: img.base64,
        mimeType: img.mimeType,
        name: img.name || 'image'
      }));
      
      // Build attachments for API (OpenClaw expects this format)
      attachments = this.pendingImages.map(img => {
        const parsed = this.parseDataUrl(img.base64);
        return {
          type: 'image',
          mimeType: parsed.mimeType,
          content: parsed.content // base64 without data: prefix
        };
      });
    }
    
    // Message content is always just the text
    messageContent = fullText || '';
    
    // Clear pending files
    this.clearPendingImages();

    // Build display content for user message (show file names, not full content)
    let displayContent = text || '';
    if (textFiles && textFiles.length > 0) {
      const fileList = textFiles.map(f => `[${f.name}]`).join(' ');
      displayContent = text ? `${fileList}\n${text}` : fileList;
    }
    if (!displayContent && images) {
      displayContent = '[Image]';
    }

    // Add user message
    // Note: We don't persist full image data to save storage
    // Just store filenames for reference
    const userMsg = {
      role: 'user',
      content: displayContent || '[File]',
      imageNames: images?.map(img => img.name || 'image') || [], // Store names only
      textFiles: textFiles, // Store text files for display (small)
      timestamp: Date.now()
    };
    
    // Keep images in session memory for current display (until page refresh)
    if (images && images.length > 0) {
      if (!this.sessionImages) this.sessionImages = new Map();
      const msgKey = `${this.currentChatId}-${this.chats[this.currentChatId].messages.length}`;
      this.sessionImages.set(msgKey, images);
    }
    this.chats[this.currentChatId].messages.push(userMsg);
    this.chats[this.currentChatId].updatedAt = Date.now();
    this.saveChats(this.currentChatId);  // Broadcast to peer
    
    // Store in clawgpt-memory for search
    const chat = this.chats[this.currentChatId];
    this.memoryStorage.storeMessage(
      this.currentChatId,
      chat.title,
      userMsg,
      chat.messages.length - 1
    ).catch(err => console.warn('Memory storage failed:', err));
    
    this.renderChatList();
    this.renderMessages();

    // Start streaming
    this.streaming = true;
    this.streamBuffer = '';
    this.updateStreamingUI();
    this.renderMessages();

    try {
      // Track input tokens
      this.addTokens(this.estimateTokens(messageContent || ''));
      
      // Build request params
      const params = {
        sessionKey: this.sessionKey,
        message: messageContent,
        deliver: false,
        idempotencyKey: this.generateId()
      };
      
      // Add attachments if we have images
      if (attachments && attachments.length > 0) {
        params.attachments = attachments;
      }
      
      await this.request('chat.send', params);
      // Response will come via chat events
    } catch (error) {
      console.error('Send failed:', error);
      this.streaming = false;
      this.addAssistantMessage('Error: ' + error.message);
    }
  }

  stopGeneration() {
    if (!this.streaming) return;
    
    this.streaming = false;
    this.updateStreamingUI();
    
    // Save whatever we have so far
    if (this.streamBuffer) {
      this.addAssistantMessage(this.streamBuffer + '\n\n*[Generation stopped]*');
    }
    this.streamBuffer = '';
  }

  updateStreamingUI() {
    this.elements.sendBtn.style.display = this.streaming ? 'none' : 'flex';
    this.elements.stopBtn.style.display = this.streaming ? 'flex' : 'none';
    this.onInputChange();
  }

  handleChatEvent(payload) {
    if (!payload) return;

    const state = payload.state;
    const content = this.extractContent(payload.message?.content);
    
    // Handle summary session responses
    if (payload.sessionKey === '__clawgpt_summarizer') {
      if ((state === 'final' || state === 'aborted') && content) {
        this.handleSummaryResponse(content);
      }
      return;
    }
    
    // Handle semantic search session responses
    if (payload.sessionKey === '__clawgpt_semantic') {
      if ((state === 'final' || state === 'aborted') && content) {
        this.handleSemanticSearchResponse(content);
      }
      return;
    }

    if (payload.sessionKey && payload.sessionKey !== this.sessionKey) {
      return; // Different session
    }

    if (state === 'delta' && content) {
      this.streamBuffer = content;
      this.updateStreamingMessage();
    } else if (state === 'final' || state === 'aborted' || state === 'error') {
      if (!this.streaming) {
        console.log('Ignoring duplicate end event - not streaming');
        return;
      }
      this.streaming = false;
      this.updateStreamingUI();

      // Use final content if available (more complete), fall back to buffer
      const finalContent = content || this.streamBuffer;

      if (state === 'error') {
        this.addAssistantMessage('Error: ' + (payload.errorMessage || 'Unknown error'));
      } else if (finalContent) {
        // Track output tokens
        this.addTokens(this.estimateTokens(finalContent));
        this.addAssistantMessage(finalContent);
      }

      this.streamBuffer = '';
    }
  }

  updateStreamingMessage() {
    const streamDiv = document.getElementById('streaming-message');
    if (streamDiv) {
      const contentDiv = streamDiv.querySelector('.message-content');
      if (contentDiv) {
        contentDiv.innerHTML = this.formatContent(this.streamBuffer) || '<div class="typing-indicator"><span></span><span></span><span></span></div>';
      }
    }
    // Update conversation token total (includes streaming)
    this.updateTokenDisplay();
    this.scrollToBottom();
  }

  addAssistantMessage(content) {
    if (!this.currentChatId || !this.chats[this.currentChatId]) return;
    if (!content || !content.trim()) return; // Skip empty messages

    const assistantMsg = {
      role: 'assistant',
      content: content,
      timestamp: Date.now()
    };
    this.chats[this.currentChatId].messages.push(assistantMsg);
    this.chats[this.currentChatId].updatedAt = Date.now();
    this.saveChats(this.currentChatId);  // Broadcast to peer
    
    // Store in clawgpt-memory for search
    const chat = this.chats[this.currentChatId];
    this.memoryStorage.storeMessage(
      this.currentChatId,
      chat.title,
      assistantMsg,
      chat.messages.length - 1
    ).catch(err => console.warn('Memory storage failed:', err));
    
    this.renderMessages();
    
    // Check if we should generate/update summary
    this.maybeGenerateSummary(this.currentChatId);
  }

  // ===== LAYER 2: SMART SUMMARIES =====
  
  needsSummary(chatId) {
    const chat = this.chats[chatId];
    if (!chat) return false;
    
    const messageCount = chat.messages.length;
    const metadata = chat.metadata;
    
    // Need at least 3 exchanges (6 messages) to summarize
    if (messageCount < 6) return false;
    
    // No metadata yet - needs summary
    if (!metadata || !metadata.summary) return true;
    
    // Re-summarize if chat grew by 8+ messages since last summary
    const lastCount = metadata.messageCountAtSummary || 0;
    if (messageCount - lastCount >= 8) return true;
    
    return false;
  }

  maybeGenerateSummary(chatId) {
    // Check if smart search is enabled
    if (!this.smartSearch) return;
    if (!this.connected) return;
    if (!this.needsSummary(chatId)) return;
    
    // Don't summarize while streaming
    if (this.streaming) return;
    
    // Debounce - wait a bit after last message
    clearTimeout(this.summaryDebounceTimer);
    this.summaryDebounceTimer = setTimeout(() => {
      this.generateSummary(chatId);
    }, 3000);
  }

  async generateSummary(chatId) {
    const chat = this.chats[chatId];
    if (!chat || !this.connected) return;
    
    // Build a condensed version of the chat for summarization
    const condensed = chat.messages.map(m => {
      const role = m.role === 'user' ? 'User' : 'AI';
      // Truncate long messages
      const content = m.content.length > 500 
        ? m.content.slice(0, 500) + '...' 
        : m.content;
      return `${role}: ${content}`;
    }).join('\n\n');
    
    const prompt = `Analyze this conversation and return ONLY a JSON object (no markdown, no explanation):

${condensed}

Return this exact JSON structure:
{
  "summary": "1-2 sentence summary of what was discussed/accomplished",
  "topics": ["topic1", "topic2", "topic3"],
  "entities": ["specific names", "projects", "technologies mentioned"],
  "type": "coding|discussion|planning|debug|other"
}`;

    try {
      console.log('Generating summary for chat:', chat.title);
      
      // Track summary prompt tokens
      this.addTokens(this.estimateTokens(prompt));
      
      // Use a temporary session to avoid polluting main chat
      const result = await this.request('chat.send', {
        sessionKey: '__clawgpt_summarizer',
        message: prompt,
        deliver: false,
        idempotencyKey: 'summary-' + chatId + '-' + Date.now()
      });
      
      // The response comes via events, so we need to capture it differently
      // For now, we'll use a simpler approach - wait for the response
      this.pendingSummary = { chatId, startedAt: Date.now() };
      
    } catch (error) {
      console.error('Failed to generate summary:', error);
    }
  }

  handleSummaryResponse(content) {
    if (!this.pendingSummary) return;
    
    // Track summary response tokens
    this.addTokens(this.estimateTokens(content));
    
    const { chatId } = this.pendingSummary;
    const chat = this.chats[chatId];
    
    if (!chat) {
      this.pendingSummary = null;
      return;
    }
    
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      // Also try to find raw JSON object
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) {
        jsonStr = objMatch[0];
      }
      
      const metadata = JSON.parse(jsonStr);
      
      // Validate and normalize
      chat.metadata = {
        summary: metadata.summary || '',
        topics: Array.isArray(metadata.topics) ? metadata.topics.slice(0, 10) : [],
        entities: Array.isArray(metadata.entities) ? metadata.entities.slice(0, 10) : [],
        type: ['coding', 'discussion', 'planning', 'debug', 'other'].includes(metadata.type) 
          ? metadata.type : 'other',
        messageCountAtSummary: chat.messages.length,
        generatedAt: Date.now()
      };
      
      this.saveChats();
      this.renderChatList(); // Update UI to show summary indicator
      console.log('Summary generated:', chat.metadata);
      
    } catch (error) {
      console.error('Failed to parse summary response:', error, content);
    }
    
    this.pendingSummary = null;
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.clawgpt = new ClawGPT();
});
