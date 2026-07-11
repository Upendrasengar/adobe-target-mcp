/**
 * Logger utility that respects MCP transport modes
 * In STDIO mode, console.log interferes with JSON-RPC protocol
 */

let isStdioMode = false;
let logToFile = false;
let logFilePath = null;

// Global flag to enable/disable tool logging
let toolLoggingEnabled = process.env.MCP_TOOL_LOGGING === 'true';

/**
 * Set the transport mode for logging
 * @param {string} mode - 'stdio', 'http', or 'sse'
 */
export function setTransportMode(mode) {
  isStdioMode = mode === 'stdio';
  
  // In STDIO mode, we can optionally log to a file
  if (isStdioMode && process.env.MCP_LOG_FILE) {
    logToFile = true;
    logFilePath = process.env.MCP_LOG_FILE;
  }
}

/**
 * Safe logging function that respects transport mode
 * @param {string} level - log level (INFO, ERROR, DEBUG, etc.)
 * @param {string} message - log message
 * @param {any} data - optional data to log
 */
export function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} [${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
  
  if (isStdioMode) {
    // In STDIO mode, only log critical errors to stderr
    if (level === 'ERROR') {
      console.error(logEntry);
    }
    // Otherwise, don't log to avoid interfering with JSON-RPC
  } else {
    // Safe to log to console in HTTP/SSE modes
    console.log(logEntry);
  }
}

/**
 * Tool-specific logging function that can be disabled
 * @param {string} level - log level
 * @param {string} message - log message
 * @param {any} data - optional data to log
 */
export function toolLog(level, message, data = null) {
  if (!toolLoggingEnabled && !isStdioMode) {
    return; // Skip tool logging if disabled and not in STDIO mode
  }
  
  if (isStdioMode) {
    // In STDIO mode, never log tool details to avoid JSON-RPC interference
    return;
  }
  
  log(level, message, data);
}

/**
 * Convenience logging functions
 */
export const logger = {
  info: (message, data) => log('INFO', message, data),
  error: (message, data) => log('ERROR', message, data),
  debug: (message, data) => log('DEBUG', message, data),
  warn: (message, data) => log('WARN', message, data),
  success: (message, data) => log('SUCCESS', message, data)
};

/**
 * Tool-specific logger that respects STDIO mode
 */
export const toolLogger = {
  info: (message, data) => toolLog('TOOL-INFO', message, data),
  error: (message, data) => toolLog('TOOL-ERROR', message, data),
  debug: (message, data) => toolLog('TOOL-DEBUG', message, data),
  warn: (message, data) => toolLog('TOOL-WARN', message, data),
  success: (message, data) => toolLog('TOOL-SUCCESS', message, data)
};