import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '../utils/logger.js';

describe('Logger', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log simple message', () => {
    Logger.log('test message');
    expect(consoleLogSpy).toHaveBeenCalledWith('test message');
  });

  it('should log info message', () => {
    Logger.info('info message');
    expect(consoleLogSpy).toHaveBeenCalledWith('ℹ️  info message');
  });

  it('should log success message', () => {
    Logger.success('success message');
    expect(consoleLogSpy).toHaveBeenCalledWith('✅ success message');
  });

  it('should log warn message', () => {
    Logger.warn('warn message');
    expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️  warn message');
  });

  it('should log error message', () => {
    Logger.error('error message');
    expect(consoleErrorSpy).toHaveBeenCalledWith('❌ error message');
  });

  it('should log section message', () => {
    Logger.section('section title');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('section title'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('─'.repeat(60)));
  });

  it('should log suggest message', () => {
    Logger.suggest('test-repo', 'do something');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Suggested change recorded for test-repo: do something')
    );
  });
});
