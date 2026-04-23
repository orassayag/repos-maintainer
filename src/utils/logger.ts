import { settings } from '../settings.js';

/**
 * A simple logger that writes to the console.
 */
export class Logger {
  static log(message: string): void {
    console.log(message);
  }

  static info(message: string): void {
    console.log(`ℹ️  ${message}`);
  }

  static success(message: string): void {
    console.log(`✅ ${message}`);
  }

  static warn(message: string): void {
    console.warn(`⚠️  ${message}`);
  }

  static error(message: string): void {
    console.error(`❌ ${message}`);
  }

  static section(title: string): void {
    const line = '─'.repeat(60);
    console.log(`\n${line}\n${title}\n${line}`);
  }

  /**
   * Logs a "suggested change" that was not automatically applied.
   */
  static suggest(repoName: string, change: string): void {
    this.warn(`Suggested change recorded for ${repoName}: ${change}`);
  }
}
