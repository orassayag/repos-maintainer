import { describe, it, expect, vi, beforeEach } from 'vitest';
import { select, input } from '../utils/prompts.js';

// Mock enquirer
vi.mock('enquirer', () => {
  return {
    default: {
      Select: function (config: any): {} {
        return {
          run: vi.fn().mockResolvedValue(
            config.result ? config.result(config.choices[0]) : config.choices[0]
          ),
        };
      },
      Input: function (): {} {
        return {
          run: vi.fn().mockResolvedValue('test-input'),
        };
      },
    },
  };
});

describe('prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('select', () => {
    it('should return the selected value', async () => {
      const config = {
        message: 'Pick one',
        choices: [
          { name: 'Choice 1', value: 'v1' },
          { name: 'Choice 2', value: 'v2' },
        ],
      };

      const result = await select(config);
      expect(result).toBe('v1');
    });
  });

  describe('input', () => {
    it('should return the input string', async () => {
      const config = {
        message: 'Enter something',
      };

      const result = await input(config);
      expect(result).toBe('test-input');
    });
  });
});
