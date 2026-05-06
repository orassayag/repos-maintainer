import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixRulesets } from '../fixers/rulesetsFixer.js';
import { getRulesets, getRulesetDetails, createRuleset, updateRuleset } from '../github.js';
import fs from 'fs/promises';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';

vi.mock('../github.js');
vi.mock('fs/promises');
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    RULESETS_PATH: '/mock/rulesets.json',
    DRY_RUN: false,
  },
}));

describe('rulesetsFixer', () => {
  const owner = 'user';
  const repo = 'test-repo';
  const templateRuleset = {
    name: 'standard',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~all'] } },
    rules: [{ type: 'deletion' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    settings.DRY_RUN = false;
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(templateRuleset));
  });

  it('should create ruleset if missing', async () => {
    vi.mocked(getRulesets).mockResolvedValue([]);

    const result = await fixRulesets(owner, repo);

    expect(result).toBe(true);
    expect(createRuleset).toHaveBeenCalledWith(owner, repo, expect.objectContaining({ name: 'standard' }));
    expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Ruleset created'));
  });

  it('should update ruleset if it exists but differs', async () => {
    const existing = { id: 123, name: 'standard' };
    const details = { ...templateRuleset, id: 123, enforcement: 'disabled' };
    vi.mocked(getRulesets).mockResolvedValue([existing as any]);
    vi.mocked(getRulesetDetails).mockResolvedValue(details as any);

    const result = await fixRulesets(owner, repo);

    expect(result).toBe(true);
    expect(updateRuleset).toHaveBeenCalledWith(owner, repo, 123, expect.objectContaining({ enforcement: 'active' }));
    expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Ruleset updated'));
  });

  it('should return false if already matches', async () => {
    const existing = { id: 123, name: 'standard' };
    const details = { ...templateRuleset, id: 123 };
    vi.mocked(getRulesets).mockResolvedValue([existing as any]);
    vi.mocked(getRulesetDetails).mockResolvedValue(details as any);

    const result = await fixRulesets(owner, repo);

    expect(result).toBe(false);
    expect(updateRuleset).not.toHaveBeenCalled();
  });

  it('should handle dry run', async () => {
    vi.mocked(getRulesets).mockResolvedValue([]);
    settings.DRY_RUN = true;

    const result = await fixRulesets(owner, repo);

    expect(result).toBe(false);
    expect(createRuleset).not.toHaveBeenCalled();
    expect(Logger.log).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));
  });
});
