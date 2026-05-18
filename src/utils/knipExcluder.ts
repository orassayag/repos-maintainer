import { multiSelect } from './prompts.js';
import { addGlobalExcludeBinary } from './excludes.js';
import { Logger } from './logger.js';

export async function handleUnlistedBinaries(binaries: string[]): Promise<void> {
  if (binaries.length === 0) return;

  const uniqueBinaries = [...new Set(binaries)];
  
  Logger.log('\n🔎 Unlisted binaries found in scan:');
  for (const bin of uniqueBinaries) {
    Logger.log(`  - ${bin}`);
  }

  const choices = uniqueBinaries.map(bin => ({
    name: bin,
    value: bin
  }));

  try {
    const selected = await multiSelect({
      message: 'Select binaries to exclude GLOBALLY (Space to select, Enter to confirm):',
      choices
    });

    if (selected.length > 0) {
      for (const bin of selected) {
        addGlobalExcludeBinary(bin);
        Logger.success(`Added "${bin}" to global binary excludes.`);
      }
    }
  } catch (err) {
    // User might have cancelled or something else went wrong
    Logger.log('Exclusion step skipped.');
  }
}
