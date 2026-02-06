// IndexedDB wrapper for chat storage with optional encryption

// CryptoHelper: Client-side encryption using Web Crypto API (AES-GCM)
class CryptoHelper {
  constructor() {
    this.key = null;
    this.salt = null;
    this.PBKDF2_ITERATIONS = 100000;
    this.SALT_LENGTH = 16;
    this.IV_LENGTH = 12;
  }

  // Derive encryption key from password using PBKDF2
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

  // Initialize with password (generates or loads salt)
  async init(password) {
    // Try to load existing salt
    const storedSalt = localStorage.getItem('clawgpt-crypto-salt');
    if (storedSalt) {
      this.salt = this.base64ToBuffer(storedSalt);
    } else {
      // Generate new salt
      this.salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
      localStorage.setItem('clawgpt-crypto-salt', this.bufferToBase64(this.salt));
    }

    this.key = await this.deriveKey(password, this.salt);
    return true;
  }

  // Check if encryption is already configured
  static isConfigured() {
    return localStorage.getItem('clawgpt-crypto-salt') !== null;
  }

  // Encrypt data
  async encrypt(plaintext) {
    if (!this.key) throw new Error('Encryption not initialized');

    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      this.key,
      encoder.encode(plaintext)
    );

    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return this.bufferToBase64(combined);
  }

  // Decrypt data
  async decrypt(encryptedData) {
    if (!this.key) throw new Error('Encryption not initialized');

    const combined = this.base64ToBuffer(encryptedData);
    const iv = combined.slice(0, this.IV_LENGTH);
    const ciphertext = combined.slice(this.IV_LENGTH);

    const decoder = new TextDecoder();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      this.key,
      ciphertext
    );

    return decoder.decode(plaintext);
  }

  // Verify password by attempting to decrypt test data
  async verifyPassword(password) {
    const testData = localStorage.getItem('clawgpt-crypto-verify');
    if (!testData) return true; // No verification data, assume correct

    try {
      const storedSalt = localStorage.getItem('clawgpt-crypto-salt');
      if (!storedSalt) return false;

      const salt = this.base64ToBuffer(storedSalt);
      const tempKey = await this.deriveKey(password, salt);

      const combined = this.base64ToBuffer(testData);
      const iv = combined.slice(0, this.IV_LENGTH);
      const ciphertext = combined.slice(this.IV_LENGTH);

      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        tempKey,
        ciphertext
      );
      return true;
    } catch {
      return false;
    }
  }

  // Create verification data for password checking
  async createVerification() {
    const testMessage = 'clawgpt-verify-' + Date.now();
    const encrypted = await this.encrypt(testMessage);
    localStorage.setItem('clawgpt-crypto-verify', encrypted);
  }

  // Helper: ArrayBuffer to Base64
  bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Helper: Base64 to ArrayBuffer
  base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Clear encryption (remove salt and verification)
  static clearEncryption() {
    localStorage.removeItem('clawgpt-crypto-salt');
    localStorage.removeItem('clawgpt-crypto-verify');
  }
}

class ChatStorage {
  constructor() {
    this.dbName = 'clawgpt';
    this.dbVersion = 1;
    this.storeName = 'chats';
    this.db = null;
    this.crypto = null;
    this.encryptionEnabled = false;
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

  // Set up encryption with password
  async setEncryptionPassword(password) {
    this.crypto = new CryptoHelper();
    await this.crypto.init(password);
    await this.crypto.createVerification();
    this.encryptionEnabled = true;
    localStorage.setItem('clawgpt-encryption-enabled', 'true');
    return true;
  }

  // Initialize encryption with existing password
  async unlockWithPassword(password) {
    if (!CryptoHelper.isConfigured()) {
      return false;
    }

    this.crypto = new CryptoHelper();
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
    return localStorage.getItem('clawgpt-encryption-enabled') === 'true';
  }

  // Check if encryption needs password unlock
  needsUnlock() {
    return this.isEncrypted() && !this.encryptionEnabled;
  }

  // Disable encryption and re-save all chats unencrypted
  async disableEncryption() {
    // Load all chats first (will decrypt them)
    const chats = await this.loadAll();
    
    // Disable encryption
    this.encryptionEnabled = false;
    this.crypto = null;
    localStorage.removeItem('clawgpt-encryption-enabled');
    CryptoHelper.clearEncryption();
    
    // Re-save without encryption
    await this.saveAll(chats);
  }

  // Encrypt chat content (messages only, not metadata)
  async encryptChat(chat) {
    if (!this.encryptionEnabled || !this.crypto) return chat;

    const encrypted = { ...chat };
    if (chat.messages && Array.isArray(chat.messages)) {
      encrypted._encrypted = true;
      encrypted._messagesEncrypted = await this.crypto.encrypt(JSON.stringify(chat.messages));
      delete encrypted.messages;
    }
    return encrypted;
  }

  // Decrypt chat content
  async decryptChat(chat) {
    if (!chat._encrypted || !this.crypto) return chat;

    try {
      const decrypted = { ...chat };
      if (chat._messagesEncrypted) {
        decrypted.messages = JSON.parse(await this.crypto.decrypt(chat._messagesEncrypted));
        delete decrypted._messagesEncrypted;
        delete decrypted._encrypted;
      }
      return decrypted;
    } catch (e) {
      console.error('Failed to decrypt chat:', chat.id, e);
      // Return chat without messages if decryption fails
      return { ...chat, messages: [], _decryptionFailed: true };
    }
  }

  async loadAll() {
    // Migrate from localStorage if needed
    const legacyData = localStorage.getItem('clawgpt-chats');
    
    if (this.useFallback) {
      const chats = legacyData ? JSON.parse(legacyData) : {};
      // Decrypt if needed
      if (this.encryptionEnabled) {
        for (const id of Object.keys(chats)) {
          chats[id] = await this.decryptChat(chats[id]);
        }
      }
      return chats;
    }

    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      
      request.onsuccess = async () => {
        const chats = {};
        for (const chat of request.result) {
          // Decrypt if needed
          chats[chat.id] = this.encryptionEnabled ? await this.decryptChat(chat) : chat;
        }
        
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
      // Encrypt before saving if enabled
      const toSave = {};
      for (const id of Object.keys(chats)) {
        toSave[id] = this.encryptionEnabled ? await this.encryptChat(chats[id]) : chats[id];
      }
      localStorage.setItem('clawgpt-chats', JSON.stringify(toSave));
      return;
    }

    await this.init();
    
    return new Promise(async (resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      // Clear and re-add all (simple approach)
      store.clear();
      
      for (const chat of Object.values(chats)) {
        const toStore = this.encryptionEnabled ? await this.encryptChat(chat) : chat;
        store.put(toStore);
      }
      
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
      all[chat.id] = this.encryptionEnabled ? await this.encryptChat(chat) : chat;
      localStorage.setItem('clawgpt-chats', JSON.stringify(all));
      return;
    }

    await this.init();
    
    return new Promise(async (resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const toStore = this.encryptionEnabled ? await this.encryptChat(chat) : chat;
      store.put(toStore);
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => {
        console.error('Failed to save chat:', e);
        this.checkStorageQuota();
        reject(transaction.error);
      };
    });
  }

  async checkStorageQuota() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usedMB = Math.round((estimate.usage || 0) / 1024 / 1024);
        const quotaMB = Math.round((estimate.quota || 0) / 1024 / 1024);
        const usedPercent = quotaMB > 0 ? Math.round((usedMB / quotaMB) * 100) : 0;
        if (usedPercent > 90) {
          console.warn(`Storage nearly full: ${usedMB}MB / ${quotaMB}MB (${usedPercent}%)`);
          showErrorBanner(`Storage nearly full (${usedPercent}%). Consider deleting old chats.`, true);
        }
      } catch (e) {
        // Silently ignore quota check failures
      }
    }
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
