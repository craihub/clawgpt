// ClawGPT Security Module
// Handles PIN lock, session timeout, token rotation, and idle detection

class SecurityManager {
  constructor(app) {
    this.app = app;
    this.pinHash = null;
    this.idleTimeoutMs = 15 * 60 * 1000; // 15 minutes default
    this.sessionTimeoutMs = 30 * 60 * 1000; // 30 minutes default
    this.lastActivity = Date.now();
    this.idleTimer = null;
    this.sessionTimer = null;
    this.locked = false;
    this.PBKDF2_ITERATIONS = 100000;
  }

  async init() {
    this.loadSettings();
    this.setupActivityTracking();
    this.setupTokenAgeCheck();
    
    // Check if PIN lock is enabled and we need to show lock screen
    if (this.isPinEnabled()) {
      this.showLockScreen();
    }
    
    // Check if encryption needs unlock
    if (this.app.storage.needsUnlock()) {
      this.showEncryptionUnlock();
    }
  }

  loadSettings() {
    const settings = localStorage.getItem('clawgpt-security');
    if (settings) {
      try {
        const parsed = JSON.parse(settings);
        this.pinHash = parsed.pinHash || null;
        this.idleTimeoutMs = (parsed.idleTimeoutMin || 15) * 60 * 1000;
        this.sessionTimeoutMs = (parsed.sessionTimeoutMin || 30) * 60 * 1000;
      } catch {}
    }
  }

  saveSettings() {
    const settings = {
      pinHash: this.pinHash,
      idleTimeoutMin: this.idleTimeoutMs / 60000,
      sessionTimeoutMin: this.sessionTimeoutMs / 60000
    };
    localStorage.setItem('clawgpt-security', JSON.stringify(settings));
  }

  // PIN Management
  isPinEnabled() {
    return this.pinHash !== null;
  }

  async hashPin(pin) {
    const encoder = new TextEncoder();
    const salt = localStorage.getItem('clawgpt-pin-salt');
    let saltBytes;
    
    if (salt) {
      saltBytes = this.base64ToBuffer(salt);
    } else {
      saltBytes = crypto.getRandomValues(new Uint8Array(16));
      localStorage.setItem('clawgpt-pin-salt', this.bufferToBase64(saltBytes));
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pin),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: this.PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    return this.bufferToBase64(new Uint8Array(derivedBits));
  }

  async setPin(pin) {
    if (pin.length < 4 || pin.length > 20) {
      throw new Error('PIN must be 4-20 characters');
    }
    
    // Remove old salt to generate new one
    localStorage.removeItem('clawgpt-pin-salt');
    this.pinHash = await this.hashPin(pin);
    this.saveSettings();
    return true;
  }

  async verifyPin(pin) {
    if (!this.pinHash) return true;
    const hash = await this.hashPin(pin);
    return hash === this.pinHash;
  }

  removePin() {
    this.pinHash = null;
    localStorage.removeItem('clawgpt-pin-salt');
    this.saveSettings();
  }

  // Lock Screen
  showLockScreen(message = 'Enter your PIN to continue') {
    this.locked = true;
    const lockScreen = document.getElementById('lockScreen');
    const lockMessage = document.getElementById('lockScreenMessage');
    const lockInput = document.getElementById('lockPinInput');
    const lockError = document.getElementById('lockError');
    
    if (lockScreen) {
      lockScreen.style.display = 'flex';
      if (lockMessage) lockMessage.textContent = message;
      if (lockInput) {
        lockInput.value = '';
        lockInput.focus();
      }
      if (lockError) lockError.style.display = 'none';
    }
  }

  hideLockScreen() {
    this.locked = false;
    const lockScreen = document.getElementById('lockScreen');
    if (lockScreen) {
      lockScreen.style.display = 'none';
    }
    this.resetActivityTimers();
  }

  async attemptUnlock(pin) {
    const valid = await this.verifyPin(pin);
    const lockError = document.getElementById('lockError');
    const lockInput = document.getElementById('lockPinInput');
    
    if (valid) {
      this.hideLockScreen();
      return true;
    } else {
      if (lockError) lockError.style.display = 'block';
      if (lockInput) {
        lockInput.value = '';
        lockInput.focus();
      }
      return false;
    }
  }

  // Encryption Unlock
  showEncryptionUnlock() {
    const modal = document.getElementById('encryptionModal');
    const title = document.getElementById('encryptionModalTitle');
    const desc = document.getElementById('encryptionModalDesc');
    
    if (modal) {
      modal.classList.add('open');
      if (title) title.textContent = '🔐 Unlock Encrypted Data';
      if (desc) desc.textContent = 'Enter your encryption password to access your chats.';
    }
  }

  async attemptEncryptionUnlock(password) {
    const success = await this.app.storage.unlockWithPassword(password);
    const error = document.getElementById('encryptionError');
    const input = document.getElementById('encryptionPasswordInput');
    const modal = document.getElementById('encryptionModal');
    
    if (success) {
      if (modal) modal.classList.remove('open');
      // Reload chats with decryption
      await this.app.loadChats();
      this.app.renderChatList();
      return true;
    } else {
      if (error) error.style.display = 'block';
      if (input) {
        input.value = '';
        input.focus();
      }
      return false;
    }
  }

  // Activity Tracking
  setupActivityTracking() {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(event => {
      document.addEventListener(event, () => this.recordActivity(), { passive: true });
    });
    
    this.resetActivityTimers();
  }

  recordActivity() {
    this.lastActivity = Date.now();
    
    // Reset timers on activity
    if (!this.locked) {
      this.resetActivityTimers();
    }
  }

  resetActivityTimers() {
    // Clear existing timers
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    
    // Set up idle timer (for PIN lock)
    if (this.isPinEnabled() && this.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        this.showLockScreen('Session locked due to inactivity');
      }, this.idleTimeoutMs);
    }
    
    // Set up session timer (for WebSocket disconnect)
    if (this.sessionTimeoutMs > 0) {
      this.sessionTimer = setTimeout(() => {
        this.handleSessionTimeout();
      }, this.sessionTimeoutMs);
    }
  }

  // Session Timeout
  handleSessionTimeout() {
    // Disconnect WebSocket
    if (this.app.ws) {
      this.app.ws.close();
      this.app.ws = null;
    }
    this.app.connected = false;
    this.app.setStatus('Session expired');
    
    // Show session expired overlay
    const overlay = document.getElementById('sessionExpiredOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
    }
    
    // If PIN enabled, also show lock screen
    if (this.isPinEnabled()) {
      this.showLockScreen('Session expired - enter PIN to continue');
    }
  }

  hideSessionExpired() {
    const overlay = document.getElementById('sessionExpiredOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  async reconnectSession() {
    this.hideSessionExpired();
    this.resetActivityTimers();
    
    // If PIN lock, require unlock first
    if (this.isPinEnabled() && this.locked) {
      return;
    }
    
    // Reconnect
    await this.app.connect();
  }

  // Token Rotation
  setupTokenAgeCheck() {
    this.updateTokenAgeDisplay();
  }

  async updateTokenAgeDisplay() {
    const statusEl = document.getElementById('tokenAgeStatus');
    const hintEl = document.getElementById('tokenRotationHint');
    
    if (!statusEl) return;
    
    try {
      const ageDays = await window.secureConfig?.getTokenAgeDays();
      
      if (ageDays === null) {
        statusEl.textContent = 'Token age: Unknown';
        statusEl.className = '';
      } else if (ageDays >= 90) {
        statusEl.textContent = `Token age: ${ageDays} days`;
        statusEl.className = 'danger';
        if (hintEl) {
          hintEl.textContent = '⚠️ Token is over 90 days old - rotation recommended!';
          hintEl.className = 'setting-hint warning';
        }
      } else if (ageDays >= 60) {
        statusEl.textContent = `Token age: ${ageDays} days`;
        statusEl.className = 'warning';
      } else {
        statusEl.textContent = `Token age: ${ageDays} days`;
        statusEl.className = '';
      }
    } catch (e) {
      statusEl.textContent = 'Token age: Unknown';
    }
  }

  async rotateToken() {
    // Request new token from gateway
    // This typically requires user action on the gateway side
    const confirmRotate = confirm(
      'Token rotation requires generating a new token from the gateway.\n\n' +
      'After rotation:\n' +
      '1. The old token will stop working\n' +
      '2. You\'ll need to update the token here\n' +
      '3. Any other devices using the old token will need updating\n\n' +
      'Continue?'
    );
    
    if (!confirmRotate) return false;
    
    // Open gateway config page
    const gatewayUrl = this.app.gatewayUrl || 'ws://127.0.0.1:18789';
    const httpUrl = gatewayUrl
      .replace('wss://', 'https://')
      .replace('ws://', 'http://')
      .replace(/\/$/, '');
    
    window.open(httpUrl + '/config', '_blank');
    
    // Show instructions
    if (this.app.showToast) {
      this.app.showToast('Generate a new token in the gateway config, then update it in Settings');
    }
    
    return true;
  }

  // Set timeout durations
  setIdleTimeout(minutes) {
    this.idleTimeoutMs = minutes * 60 * 1000;
    this.saveSettings();
    this.resetActivityTimers();
  }

  setSessionTimeout(minutes) {
    this.sessionTimeoutMs = minutes * 60 * 1000;
    this.saveSettings();
    this.resetActivityTimers();
  }

  // Helper functions
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

// Export for use in app.js
window.SecurityManager = SecurityManager;
