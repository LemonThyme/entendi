/**
 * Structured logger for Cloudflare Workers.
 * All output goes to console.log/warn/error as JSON.
 * CF Workers indexes these fields automatically when [observability] is enabled.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogData {
  [key: string]: unknown;
}

function emit(level: LogLevel, event: string, data?: LogData): void {
  const payload = {
    level,
    event,
    service: 'entendi-api',
    timestamp: new Date().toISOString(),
    ...data,
  };
  switch (level) {
    case 'error': console.error(JSON.stringify(payload)); break;
    case 'warn':  console.warn(JSON.stringify(payload)); break;
    default:      console.log(JSON.stringify(payload)); break;
  }
}

export const logger = {
  debug: (event: string, data?: LogData) => emit('debug', event, data),
  info:  (event: string, data?: LogData) => emit('info', event, data),
  warn:  (event: string, data?: LogData) => emit('warn', event, data),
  error: (event: string, data?: LogData) => emit('error', event, data),
};
