import { promises as fs } from 'fs';
import { join } from 'path';
import { LOG_CONFIG, LogLevel, LogEntry } from './logConfig.js';

/**
 * A logger that writes to a file and optionally to the console.
 */
export class Logger {
  private static context: string = 'App';

  static setContext(context: string): void {
    this.context = context;
  }

  static debug(message: string, data?: any): void {
    this.logEntry(LogLevel.DEBUG, message, data);
  }

  static log(message: string, data?: any): void {
    this.logEntry(LogLevel.INFO, message, data);
  }

  static info(message: string, data?: any): void {
    this.logEntry(LogLevel.INFO, `ℹ️  ${message}`, data);
  }

  static success(message: string, data?: any): void {
    this.logEntry(LogLevel.INFO, `✅ ${message}`, data);
  }

  static warn(message: string, data?: any): void {
    this.logEntry(LogLevel.WARN, `⚠️  ${message}`, data);
  }

  static error(message: string, error?: Error | unknown, data?: any): void {
    const errorData =
      error instanceof Error
        ? { error: error.message, stack: error.stack }
        : { error: String(error) };

    this.logEntry(LogLevel.ERROR, `❌ ${message}`, {
      ...data,
      ...errorData,
    });
  }

  static section(title: string): void {
    const line = '─'.repeat(60);
    const message = `\n${line}\n${title}\n${line}`;
    this.logEntry(LogLevel.INFO, message);
  }

  /**
   * Logs a "suggested change" that was not automatically applied.
   */
  static suggest(repoName: string, change: string): void {
    this.warn(`Suggested change recorded for ${repoName}: ${change}`);
  }

  private static logEntry(level: LogLevel, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      data,
    };

    if (LOG_CONFIG.enableConsole && this.shouldLog(level)) {
      const formattedMessage = `[${level.toUpperCase()}] [${this.context}] ${message}`;
      if (level === LogLevel.ERROR) {
        console.error(formattedMessage);
      } else if (level === LogLevel.WARN) {
        console.warn(formattedMessage);
      } else {
        console.log(formattedMessage);
      }
    }

    if (LOG_CONFIG.enableFile) {
      this.writeToFile(entry).catch(() => {
        // Silently fail to avoid infinite loops if console is redirected
      });
    }
  }

  private static shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3,
    };
    const configLevel = LOG_CONFIG.level.toLowerCase() as LogLevel;
    const configLevelValue = levels[configLevel] ?? 1;
    return levels[level] >= configLevelValue;
  }

  private static async writeToFile(entry: LogEntry): Promise<void> {
    const logDir = join(process.cwd(), LOG_CONFIG.logDir);
    const logFilePath = join(logDir, 'app.log');
    const logLine = JSON.stringify(entry) + '\n';
    try {
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(logFilePath, logLine);
    } catch {
      // Ignore errors
    }
  }
}
