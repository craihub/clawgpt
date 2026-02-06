// Secure Configuration Manager
// Stores sensitive tokens in IndexedDB with optional encryption
// Never exposes tokens in source files or URLs after initial setup

class SecureConfig {
  constructor() {
    this.dbName = 'clawgpt-secure';
    this.dbVersion = 1;
    this.storeName = 'config';
    this.db = null;
    this.crypto = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('SecureConfig: Failed to open IndexedDB');
        resolve(null);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  // Enable encryption for stored config
  async enableEncryption(password) {
    this.crypto = new SecureConfigCrypto();
    await this.crypto.init(password);
    localStorage.setItem('clawgpt-config-encrypted', 'true');
    return true;
  }

  // Unlock encrypted config
  async unlock(password) {
    if (!this.isEncrypted()) return true;

    this.crypto = new SecureConfigCrypto();
    const valid = await this.crypto.verifyPassword(password);
    if (!valid) {
      this.crypto = null;
      return false;
    }
    await this.crypto.init(password);
    return true;
  }

  // Check if config storage is encrypted
  isEncrypted() {
    return localStorage.getItem('clawgpt-config-encrypted') === 'true';
  }

  // Check if first-run setup is needed
  async needsSetup() {
    await this.init();
    const token = await this.get('authToken');
    return !token;
  }

  // Store a config value
  async set(key, value, options = {}) {
    await this.init();
    if (!this.db) return false;

    let storedValue = value;
    if (this.crypto && options.sensitive !== false) {
      storedValue = await this.crypto.encrypt(value);
    }

    return new Promise((resolve) => {
      const tx = this.db.transaction([this.storeName], 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.put({
        key,
        value: storedValue,
        encrypted: !!(this.crypto && options.sensitive !== false),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  // Get a config value
  async get(key) {
    await this.init();
    if (!this.db) return null;

    return new Promise(async (resolve) => {
      const tx = this.db.transaction([this.storeName], 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = async () => {
        if (!request.result) {
          resolve(null);
          return;
        }

        let value = request.result.value;
        if (request.result.encrypted && this.crypto) {
          try {
            value = await this.crypto.decrypt(value);
          } catch (e) {
            console.error('SecureConfig: Failed to decrypt', key);
            resolve(null);
            return;
          }
        }
        resolve(value);
      };

      request.onerror = () => resolve(null);
    });
  }

  // Delete a config value
  async delete(key) {
    await this.init();
    if (!this.db) return false;

    return new Promise((resolve) => {
      const tx = this.db.transaction([this.storeName], 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }

  // Store token securely
  async storeToken(token, gatewayUrl = 'ws://127.0.0.1:18789', sessionKey = 'main') {
    await this.set('authToken', token);
    await this.set('gatewayUrl', gatewayUrl, { sensitive: false });
    await this.set('sessionKey', sessionKey, { sensitive: false });
    await this.set('tokenCreatedAt', Date.now(), { sensitive: false });

    // Record in token history (hashed)
    await this.addToTokenHistory(token);

    // Mark setup as complete
    localStorage.setItem('clawgpt-setup-complete', 'true');
    return true;
  }

  // Get stored token
  async getToken() {
    return this.get('authToken');
  }

  // Get gateway URL
  async getGatewayUrl() {
    return (await this.get('gatewayUrl')) || 'ws://127.0.0.1:18789';
  }

  // Get session key
  async getSessionKey() {
    return (await this.get('sessionKey')) || 'main';
  }

  // Add token to history (stores hash only)
  async addToTokenHistory(token) {
    const hash = await this.hashToken(token);
    const history = await this.getTokenHistory();
    
    // Check for reuse
    if (history.some(h => h.hash === hash)) {
      console.warn('SecureConfig: Token reuse detected');
    }

    history.push({
      hash,
      createdAt: Date.now()
    });

    // Keep last 10 entries
    const trimmed = history.slice(-10);
    await this.set('tokenHistory', JSON.stringify(trimmed), { sensitive: false });
  }

  // Get token history
  async getTokenHistory() {
    const data = await this.get('tokenHistory');
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  // Hash a token for history tracking
  async hashToken(token) {
    const encoder = new TextEncoder();
    const data = encoder.encode(token + '-clawgpt-token-hash');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Check if current token is in history (reuse detection)
  async isTokenReused(token) {
    const hash = await this.hashToken(token);
    const history = await this.getTokenHistory();
    const matches = history.filter(h => h.hash === hash);
    return matches.length > 1;
  }

  // Get token age in days
  async getTokenAgeDays() {
    const createdAt = await this.get('tokenCreatedAt');
    if (!createdAt) return null;
    return Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
  }

  // Check if token rotation is recommended
  async shouldRotateToken() {
    const ageDays = await this.getTokenAgeDays();
    return ageDays !== null && ageDays >= 90;
  }

  // Clear all secure config (for logout/reset)
  async clear() {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db.transaction([this.storeName], 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.clear();
      tx.oncomplete = () => {
        localStorage.removeItem('clawgpt-setup-complete');
        localStorage.removeItem('clawgpt-config-encrypted');
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    });
  }

  // Migrate from old config.js/localStorage setup
  async migrateFromLegacy() {
    // Check for config.js
    const legacyConfig = window.CLAWGPT_CONFIG || {};
    
    // Check for localStorage settings
    const savedSettings = localStorage.getItem('clawgpt-settings');
    let settings = {};
    if (savedSettings) {
      try {
        settings = JSON.parse(savedSettings);
      } catch {}
    }

    // Priority: config.js > localStorage
    const token = legacyConfig.authToken || settings.authToken;
    const gateway = legacyConfig.gatewayUrl || settings.gatewayUrl || 'ws://127.0.0.1:18789';
    const session = legacyConfig.sessionKey || settings.sessionKey || 'main';

    if (token) {
      await this.storeToken(token, gateway, session);
      
      // Clear legacy token from localStorage (keep other settings)
      if (settings.authToken) {
        delete settings.authToken;
        localStorage.setItem('clawgpt-settings', JSON.stringify(settings));
      }
      
      console.log('SecureConfig: Migrated from legacy config');
      return true;
    }

    return false;
  }

  // Check if setup is complete
  static isSetupComplete() {
    return localStorage.getItem('clawgpt-setup-complete') === 'true';
  }
}

// Encryption helper for SecureConfig
class SecureConfigCrypto {
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
    const storedSalt = localStorage.getItem('clawgpt-config-salt');
    if (storedSalt) {
      this.salt = this.base64ToBuffer(storedSalt);
    } else {
      this.salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
      localStorage.setItem('clawgpt-config-salt', this.bufferToBase64(this.salt));
    }

    this.key = await this.deriveKey(password, this.salt);

    // Create verification
    if (!localStorage.getItem('clawgpt-config-verify')) {
      const testEnc = await this.encrypt('clawgpt-config-verify-' + Date.now());
      localStorage.setItem('clawgpt-config-verify', testEnc);
    }

    return true;
  }

  async verifyPassword(password) {
    const testData = localStorage.getItem('clawgpt-config-verify');
    if (!testData) return true;

    try {
      const storedSalt = localStorage.getItem('clawgpt-config-salt');
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

// Global instance
window.secureConfig = new SecureConfig();
