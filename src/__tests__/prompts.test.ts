import { describe, it, expect, vi, beforeEach } from 'vitest';
import { select, input } from '../utils/prompts.js';

// Mock enquirer
vi.mock('enquirer', () => {
  class Select {
    constructor(public config: any) {}
    run = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          this.config.result
            ? this.config.result(this.config.choices[0])
            : this.config.choices[0]
        )
      );
  }
  class Input {
    run = vi.fn().mockResolvedValue('test-input');
  }

  return {
    Select,
    Input,
    default: {
      Select,
      Input,
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
