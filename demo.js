const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  websocketUrl: 'wss://mempool.space/api/v1/ws',
  logFilePath: path.join(__dirname, 'acceleration-logs.json'),
  reconnectInterval: 5000, // 5 seconds
  heartbeatInterval: 30000, // 30 seconds
  logToConsole: true,
  debugMode: false, // Set to true for additional debugging information
  trackUpdatesByTxid: true, // Keep track of updates to the same transaction
  deduplicateEntries: true // Avoid duplicate entries in the log file
};

class MempoolMonitor {
  constructor() {
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.connected = false;
    this.accelerations = [];
    this.txidSet = new Set(); // Keep track of txids we've seen
    
    // Create log file if it doesn't exist
    if (!fs.existsSync(config.logFilePath)) {
      fs.writeFileSync(config.logFilePath, JSON.stringify({ accelerations: [] }, null, 2));
    } else {
      // Load existing txids into our set if tracking by txid is enabled
      if (config.trackUpdatesByTxid) {
        try {
          const fileContent = fs.readFileSync(config.logFilePath, 'utf8');
          const logData = JSON.parse(fileContent);
          
          if (logData && logData.accelerations && Array.isArray(logData.accelerations)) {
            for (const acc of logData.accelerations) {
              if (acc.txid) {
                this.txidSet.add(acc.txid);
              }
            }
          }
          
          console.log(`Loaded ${this.txidSet.size} existing transaction IDs from log file`);
        } catch (error) {
          console.error('Error loading existing txids:', error);
        }
      }
    }
  }

  // Start monitoring
  start() {
    console.log('Starting mempool acceleration monitor...');
    console.log(`Debug mode: ${config.debugMode ? 'Enabled' : 'Disabled'}`);
    this.connect();
  }

  // Connect to WebSocket
  connect() {
    if (this.ws) {
      this.cleanup();
    }

    this.ws = new WebSocket(config.websocketUrl);

    this.ws.on('open', () => {
      console.log('Connected to mempool.space websocket');
      this.connected = true;
      
      // Subscribe to the required channels
      this.ws.send(JSON.stringify({ action: "want", data: ["blocks", "mempool-blocks", "stats"] }));
      this.ws.send(JSON.stringify({ "track-accelerations": true }));
      
      // Start heartbeat
      this.startHeartbeat();
    });

    this.ws.on('message', (data) => {
      try {
        // First, log the raw message in debug mode
        if (config.logToConsole && config.debugMode) {
          console.log('Raw message received:', data.toString());
        }
        
        const message = JSON.parse(data);
        
        // Process acceleration data - handle different message structures safely
        if (message && message.accelerations) {
          // CASE 1: The most common format from mempool.space (added/removed format)
          if (message.accelerations.added && Array.isArray(message.accelerations.added)) {
            const addedCount = message.accelerations.added.length;
            const removedCount = message.accelerations.removed && Array.isArray(message.accelerations.removed) 
              ? message.accelerations.removed.length : 0;
              
            if (config.logToConsole) {
              console.log(`Received acceleration update: ${addedCount} added, ${removedCount} removed`);
            }
            
            // Process both added and removed accelerations
            this.handleAddedAndRemovedAccelerations(message.accelerations.added, message.accelerations.removed || []);
          }
          // CASE 2: Legacy format that was originally expected
          else if (message.accelerations.accelerations && Array.isArray(message.accelerations.accelerations)) {
            const count = message.accelerations.accelerations.length;
            if (config.logToConsole) {
              console.log(`Received ${count} acceleration events (legacy format)`);
            }
            this.handleLegacyAccelerations(message.accelerations.accelerations);
          }
          // CASE 3: Direct array format
          else if (Array.isArray(message.accelerations)) {
            const count = message.accelerations.length;
            if (config.logToConsole) {
              console.log(`Received ${count} acceleration events (direct array format)`);
            }
            this.handleLegacyAccelerations(message.accelerations);
          }
          // Unknown format - log it for analysis
          else {
            if (config.logToConsole) {
              console.log('Received unknown acceleration format:', JSON.stringify(message));
            }
          }
        } 
        // Handle other message types
        else if (message && message.block) {
          // Handle block notifications
          if (config.logToConsole) {
            console.log(`Received block notification: height=${message.block.height}`);
          }
        } else if (message && message.mempoolInfo) {
          // Handle mempool info
          if (config.logToConsole) {
            console.log(`Received mempool info: ${message.mempoolInfo.size} txs`);
          }
        } else if (message) {
          // Log other message types for debugging
          if (config.logToConsole) {
            console.log('Received other message type:', Object.keys(message).join(', '));
          }
        }
      } catch (error) {
        console.error('Error processing message:', error);
        if (config.debugMode) {
          console.error('Raw message that caused error:', data.toString());
        }
      }
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
      this.scheduleReconnect();
    });

    this.ws.on('close', () => {
      console.log('Connection closed');
      this.connected = false;
      this.scheduleReconnect();
    });
  }

  // Handle added and removed accelerations (new preferred format)
  handleAddedAndRemovedAccelerations(addedAccelerations, removedAccelerations) {
    // Check if we have valid acceleration data
    if (!Array.isArray(addedAccelerations)) {
      console.warn('Invalid added accelerations format');
      return;
    }
    
    if (!Array.isArray(removedAccelerations)) {
      console.warn('Invalid removed accelerations format');
      return;
    }
    
    // If both arrays are empty, just log and return
    if (addedAccelerations.length === 0 && removedAccelerations.length === 0) {
      if (config.logToConsole) {
        console.log('Received empty accelerations arrays');
      }
      return;
    }
    
    // Read current log file
    let logData;
    try {
      const fileContent = fs.readFileSync(config.logFilePath, 'utf8');
      logData = JSON.parse(fileContent);
    } catch (error) {
      console.error('Error reading log file:', error);
      logData = { accelerations: [] };
    }
    
    // Process added accelerations
    if (addedAccelerations.length > 0) {
      // Filter out accelerations we've already seen if deduplication is enabled
      let newAddedAccelerations = addedAccelerations;
      
      if (config.deduplicateEntries && config.trackUpdatesByTxid) {
        const newTxids = [];
        newAddedAccelerations = addedAccelerations.filter(acc => {
          // If it's a new txid or we're not tracking by txid, include it
          const isNew = !this.txidSet.has(acc.txid);
          if (isNew) {
            this.txidSet.add(acc.txid);
            newTxids.push(acc.txid);
          }
          return !config.deduplicateEntries || isNew;
        });
        
        if (newTxids.length > 0 && config.logToConsole) {
          console.log(`Found ${newTxids.length} new transaction accelerations: ${newTxids.join(', ')}`);
        }
      }
      
      // Add timestamp and event type to each acceleration event
      const timestampedAddedAccelerations = newAddedAccelerations.map(acc => {
        return {
          ...acc,
          eventType: 'added',
          loggedAt: new Date().toISOString()
        };
      });
      
      // Skip if we filtered out all accelerations
      if (timestampedAddedAccelerations.length > 0) {
        // Append new accelerations
        logData.accelerations = [...logData.accelerations, ...timestampedAddedAccelerations];
        
        // Log to console
        if (config.logToConsole) {
          for (const acc of timestampedAddedAccelerations) {
            console.log(`Logged acceleration (added): ${acc.txid} - Fee delta: ${acc.feeDelta}, Effective fee: ${acc.effectiveFee}`);
          }
        }
      } else if (config.logToConsole && config.deduplicateEntries) {
        console.log(`Skipped ${addedAccelerations.length} already logged transactions`);
      }
    }
    
    // Process removed accelerations (if any)
    if (removedAccelerations.length > 0) {
      // Add timestamp and event type to each acceleration event
      const timestampedRemovedAccelerations = removedAccelerations.map(acc => {
        return {
          ...acc,
          eventType: 'removed',
          loggedAt: new Date().toISOString()
        };
      });
      
      // Append removed accelerations
      logData.accelerations = [...logData.accelerations, ...timestampedRemovedAccelerations];
      
      // Log to console
      if (config.logToConsole) {
        for (const acc of timestampedRemovedAccelerations) {
          console.log(`Logged acceleration (removed): ${acc.txid}`);
        }
      }
    }
    
    // Write updated data back to the log file
    try {
      fs.writeFileSync(config.logFilePath, JSON.stringify(logData, null, 2));
      console.log(`Successfully updated log file with ${logData.accelerations.length} total entries`);
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }
  
  // Handle legacy acceleration format (original expected format)
  handleLegacyAccelerations(accelerations) {
    // Check if we have valid acceleration data
    if (!Array.isArray(accelerations)) {
      console.warn('Invalid accelerations array');
      return;
    }
    
    // If the array is empty, just log and return
    if (accelerations.length === 0) {
      if (config.logToConsole) {
        console.log('Received empty accelerations array');
      }
      return;
    }
    
    // Read current log file
    let logData;
    try {
      const fileContent = fs.readFileSync(config.logFilePath, 'utf8');
      logData = JSON.parse(fileContent);
    } catch (error) {
      console.error('Error reading log file:', error);
      logData = { accelerations: [] };
    }
    
    // Add timestamp to each acceleration event
    const timestampedAccelerations = accelerations.map(acc => {
      return {
        ...acc,
        eventType: 'legacy',
        loggedAt: new Date().toISOString()
      };
    });
    
    // Append new accelerations
    logData.accelerations = [...logData.accelerations, ...timestampedAccelerations];
    
    // Write updated data back to the log file
    try {
      fs.writeFileSync(config.logFilePath, JSON.stringify(logData, null, 2));
      if (config.logToConsole) {
        for (const acc of timestampedAccelerations) {
          console.log(`Logged acceleration (legacy): ${acc.txid} - Fee delta: ${acc.feeDelta}, Effective fee: ${acc.effectiveFee}`);
        }
      }
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }

  // Start heartbeat to keep connection alive
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.connected) {
        this.ws.ping();
        if (config.logToConsole) {
          console.log('Sent ping');
        }
      }
    }, config.heartbeatInterval);
  }

  // Stop heartbeat
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Schedule reconnection
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.cleanup();
    
    this.reconnectTimer = setTimeout(() => {
      console.log('Attempting to reconnect...');
      this.connect();
    }, config.reconnectInterval);
  }

  // Clean up resources
  cleanup() {
    this.stopHeartbeat();
    this.connected = false;
    
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (error) {
        console.error('Error terminating WebSocket:', error);
      }
      this.ws = null;
    }
  }

  // Gracefully stop monitoring
  stop() {
    console.log('Stopping mempool acceleration monitor...');
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.cleanup();
  }
}

// Create and start the monitor
const monitor = new MempoolMonitor();
monitor.start();

// Handle process termination
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  monitor.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  monitor.stop();
  process.exit(0);
});

// Display startup message with configuration details
console.log(`=== Mempool Acceleration Monitor ===`);
console.log(`Monitoring mempool accelerations. Logs saved to: ${config.logFilePath}`);
console.log(`Configuration:`);
console.log(`- Debug mode: ${config.debugMode ? 'Enabled' : 'Disabled'}`);
console.log(`- Track updates by txid: ${config.trackUpdatesByTxid ? 'Enabled' : 'Disabled'}`);
console.log(`- Deduplicate entries: ${config.deduplicateEntries ? 'Enabled' : 'Disabled'}`);
console.log(`- Console logging: ${config.logToConsole ? 'Enabled' : 'Disabled'}`);
console.log(`=====================================`);
