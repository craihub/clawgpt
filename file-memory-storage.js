// ClawGPT Memory - File-based persistent storage for cross-device sync
// This writes messages to files that can be accessed by external tools (like OpenClaw agents)
// Default folder: clawgpt-memory/ in the app directory
// Supports optional encryption for sensitive chats

class FileMemoryStorage {
  constructor() {
    this.dirHandle = null;
    this.dbName = 'clawgpt-file-handles';
    this.db = null;
    this.enabled = false;
    this.pendingWrites = [];
    this.writeDebounce = null;
    this.defaultFolderName = 'clawgpt-memory';
    
    // Encryption support
    this.crypto = null;
    this.encryptionEnabled = false;
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

  // Enable encryption for file-based memory
  async enableEncryption(password) {
    this.crypto = new FileMemoryCrypto();
    await this.crypto.init(password);
    this.encryptionEnabled = true;
    localStorage.setItem('clawgpt-filememory-encrypted', 'true');
    return true;
  }

  // Initialize encryption with existing password
  async unlockEncryption(password) {
    if (!this.isEncrypted()) return true;

    this.crypto = new FileMemoryCrypto();
    const valid = await this.crypto.verifyPassword(password);
    if (!valid) {
      this.crypto = null;
      return false;
    }
    await this.crypto.init(password);
    this.encryptionEnabled = true;
    return true;
  }

  // Check if encryption is enabled
  isEncrypted() {
    return localStorage.getItem('clawgpt-filememory-encrypted') === 'true';
  }

  // Check if encryption needs password unlock
  needsUnlock() {
    return this.isEncrypted() && !this.encryptionEnabled;
  }

  // Auto-setup: prompt user to select the clawgpt-memory folder on first run
  async autoSetup() {
    if (this.enabled) return true; // Already set up
    
    // Check if File System Access API is available
    if (!('showDirectoryPicker' in window)) {
      console.log('FileMemoryStorage: Auto-setup skipped (API not available)');
      return false;
    }
    
    return await this.selectDirectory(true);
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
              // Permission not granted yet — can't request without user gesture.
              // Store the handle so we can request permission on next user interaction.
              this._pendingHandle = req.result.handle;
              resolve(false);
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

  // Re-request permission for a previously saved handle (must be called from user gesture)
  async reconnect() {
    if (this.enabled) return true;
    if (!this._pendingHandle) return false;

    try {
      const permission = await this._pendingHandle.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        this.dirHandle = this._pendingHandle;
        this._pendingHandle = null;
        this.enabled = true;
        console.log('FileMemoryStorage: Reconnected via user gesture');
        return true;
      }
    } catch (e) {
      console.warn('FileMemoryStorage: Reconnect failed:', e);
    }
    return false;
  }

  async selectDirectory(isAutoSetup = false) {
    try {
      // startIn: 'documents' works on Windows/Mac, broken on Linux Chrome
      const options = {
        mode: 'readwrite',
        startIn: 'documents'
      };
      
      this.dirHandle = await window.showDirectoryPicker(options);

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
    const filename = this.encryptionEnabled ? `${date}.enc.jsonl` : `${date}.jsonl`;
    
    try {
      // Get or create file
      const fileHandle = await this.dirHandle.getFileHandle(filename, { create: true });
      
      // Read existing content
      const file = await fileHandle.getFile();
      const existingContent = await file.text();
      
      // Check for encryption header
      let isEncryptedFile = false;
      let existingIds = new Set();
      
      if (existingContent) {
        const lines = existingContent.split('\n');
        
        // Check first line for header
        if (lines[0]) {
          try {
            const header = JSON.parse(lines[0]);
            if (header._encrypted === true) {
              isEncryptedFile = true;
            }
          } catch {}
        }
        
        // Parse existing IDs
        const dataLines = isEncryptedFile ? lines.slice(1) : lines;
        for (const line of dataLines) {
          if (line.trim()) {
            try {
              let msg;
              if (isEncryptedFile && this.crypto) {
                msg = JSON.parse(await this.crypto.decrypt(line.trim()));
              } else if (!isEncryptedFile) {
                msg = JSON.parse(line);
              }
              if (msg?.id) existingIds.add(msg.id);
            } catch {}
          }
        }
      }
      
      // Filter out duplicates
      const newMessages = messages.filter(m => !existingIds.has(m.id));
      if (newMessages.length === 0) return;
      
      // Prepare lines
      let newLines = '';
      
      // Add header if new encrypted file
      if (this.encryptionEnabled && !existingContent) {
        newLines = JSON.stringify({ _encrypted: true, _version: 1 }) + '\n';
      }
      
      // Add messages
      for (const m of newMessages) {
        if (this.encryptionEnabled && this.crypto) {
          const encrypted = await this.crypto.encrypt(JSON.stringify(m));
          newLines += encrypted + '\n';
        } else {
          newLines += JSON.stringify(m) + '\n';
        }
      }
      
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

  // Load chats from memory folder - reconstructs chat objects from JSONL files
  async loadFromMemory() {
    if (!this.enabled || !this.dirHandle) return {};

    const chats = {};
    
    try {
      // List all .jsonl and .json files in the directory
      for await (const entry of this.dirHandle.values()) {
        if (entry.kind === 'file') {
          try {
            const file = await entry.getFile();
            const content = await file.text();
            
            if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.enc.jsonl')) {
              // JSONL format: one message per line
              const lines = content.split('\n');
              let isEncrypted = false;
              let startIndex = 0;
              
              // Check for encryption header
              if (lines[0]) {
                try {
                  const header = JSON.parse(lines[0]);
                  if (header._encrypted === true) {
                    isEncrypted = true;
                    startIndex = 1;
                    
                    if (!this.crypto) {
                      console.warn(`FileMemoryStorage: Cannot read encrypted file ${entry.name} - not unlocked`);
                      continue;
                    }
                  }
                } catch {}
              }
              
              for (let i = startIndex; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                
                try {
                  let msg;
                  if (isEncrypted && this.crypto) {
                    msg = JSON.parse(await this.crypto.decrypt(line.trim()));
                  } else if (!isEncrypted) {
                    msg = JSON.parse(line);
                  } else {
                    continue; // Skip encrypted content without crypto
                  }
                  
                  if (!msg.chatId) continue;
                  
                  // Create or update chat
                  if (!chats[msg.chatId]) {
                    chats[msg.chatId] = {
                      id: msg.chatId,
                      title: msg.chatTitle || 'Untitled',
                      messages: [],
                      createdAt: msg.timestamp,
                      updatedAt: msg.timestamp
                    };
                  }
                  
                  const chat = chats[msg.chatId];
                  
                  // Update timestamps
                  if (msg.timestamp < chat.createdAt) chat.createdAt = msg.timestamp;
                  if (msg.timestamp > chat.updatedAt) chat.updatedAt = msg.timestamp;
                  
                  // Add message (will sort and dedupe later)
                  chat.messages.push({
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    _order: msg.order // Keep original order for sorting
                  });
                } catch (parseErr) {
                  // Skip invalid lines
                }
              }
            } else if (entry.name.endsWith('.json')) {
              // JSON format: export file with {chats: {...}}
              try {
                const data = JSON.parse(content);
                if (data.chats) {
                  console.log(`FileMemoryStorage: Found export file ${entry.name} with ${Object.keys(data.chats).length} chats`);
                  for (const [chatId, chat] of Object.entries(data.chats)) {
                    if (!chats[chatId]) {
                      chats[chatId] = chat;
                    }
                  }
                }
              } catch (parseErr) {
                console.warn(`FileMemoryStorage: Error parsing ${entry.name}:`, parseErr);
              }
            }
          } catch (fileErr) {
            console.warn(`FileMemoryStorage: Error reading ${entry.name}:`, fileErr);
          }
        }
      }
      
      // Sort messages in each chat and remove duplicates
      for (const chat of Object.values(chats)) {
        // Sort by order if available, otherwise by timestamp
        chat.messages.sort((a, b) => {
          if (a._order !== undefined && b._order !== undefined) {
            return a._order - b._order;
          }
          return (a.timestamp || 0) - (b.timestamp || 0);
        });
        
        // Remove _order helper and dedupe by content+role+timestamp
        const seen = new Set();
        chat.messages = chat.messages.filter(m => {
          delete m._order;
          const key = `${m.role}:${m.timestamp}:${m.content?.substring(0, 100)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      
      console.log(`FileMemoryStorage: Loaded ${Object.keys(chats).length} chats from memory folder`);
      return chats;
    } catch (e) {
      console.error('FileMemoryStorage: Error loading from memory:', e);
      return {};
    }
  }

  isEnabled() {
    return this.enabled;
  }

  getDirectoryName() {
    return this.dirHandle?.name || null;
  }
}

// Encryption helper for FileMemoryStorage
class FileMemoryCrypto {
  constructor() {
    this.key = null;
    this.salt = null;
    this.PBKDF2_ITERATIONS = 100000;
    this.SALT_LENGTH = 16;
    this.IV_LENGTH = 12;
  }

  async deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: this.PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async init(password) {
    const storedSalt = localStorage.getItem('clawgpt-filememory-salt');
    if (storedSalt) {
      this.salt = this.base64ToBuffer(storedSalt);
    } else {
      this.salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
      localStorage.setItem('clawgpt-filememory-salt', this.bufferToBase64(this.salt));
    }

    this.key = await this.deriveKey(password, this.salt);

    // Create verification
    if (!localStorage.getItem('clawgpt-filememory-verify')) {
      const testEnc = await this.encrypt('clawgpt-filememory-verify-' + Date.now());
      localStorage.setItem('clawgpt-filememory-verify', testEnc);
    }

    return true;
  }

  async verifyPassword(password) {
    const testData = localStorage.getItem('clawgpt-filememory-verify');
    if (!testData) return true;

    try {
      const storedSalt = localStorage.getItem('clawgpt-filememory-salt');
      if (!storedSalt) return false;

      const salt = this.base64ToBuffer(storedSalt);
      const tempKey = await this.deriveKey(password, salt);

      const combined = this.base64ToBuffer(testData);
      const iv = combined.slice(0, this.IV_LENGTH);
      const ciphertext = combined.slice(this.IV_LENGTH);

      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, tempKey, ciphertext);
      return true;
    } catch {
      return false;
    }
  }

  async encrypt(plaintext) {
    if (!this.key) throw new Error('Not initialized');

    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      encoder.encode(plaintext)
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return this.bufferToBase64(combined);
  }

  async decrypt(encryptedData) {
    if (!this.key) throw new Error('Not initialized');

    const combined = this.base64ToBuffer(encryptedData);
    const iv = combined.slice(0, this.IV_LENGTH);
    const ciphertext = combined.slice(this.IV_LENGTH);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.key,
      ciphertext
    );

    return new TextDecoder().decode(plaintext);
  }

  bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
