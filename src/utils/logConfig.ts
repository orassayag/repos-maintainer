export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  data?: any;
}

export const LOG_CONFIG = {
  level: (process.env.LOG_LEVEL as LogLevel) || LogLevel.DEBUG,
  logDir: 'logs',
  enableConsole: process.env.ENABLE_CONSOLE_LOGGING === 'true', // Default to false as requested
  enableFile: true,
};
