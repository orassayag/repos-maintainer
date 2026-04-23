import { readRepoList } from '../utils/repoList';
import { standardizeRepo } from '../fixers/standardizer';
import { settings } from '../settings';

export async function reposSyncCommand(): Promise<void> {
  console.log('\n♻️  Repos Sync - Starting full standardization crawl...\n');

  const repoNames = await readRepoList();

  if (repoNames.length === 0) {
    console.error('❌ No repositories found in project-repos-names.txt');
    return;
  }

  console.log(`Found ${repoNames.length} repositories to process.\n`);

  const results = [];
  let successCount = 0;

  for (const repoName of repoNames) {
    // For sync we assume the repo name is enough - we can enhance URL storage later
    const repoUrl = `https://github.com/orassayag/${repoName}`; // fallback - improve if needed

    console.log(`\nProcessing: ${repoName}`);
    const result = await standardizeRepo(repoUrl);

    results.push(result);
    if (result.success) successCount++;
  }

  // Final summary table
  console.log('\n' + '═'.repeat(80));
  console.log('📊 REPOS SYNC SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total repos processed : ${repoNames.length}`);
  console.log(`✅ Successful         : ${successCount}`);
  console.log(`⚠️  With issues        : ${repoNames.length - successCount}`);
  console.log('═'.repeat(80));

  // Detailed per-repo summary
  for (const result of results) {
    const status = result.success ? '✅' : '⚠️';
    console.log(`\n${status}  ${result.repoName}`);
    
    if (result.changes.length > 0) {
      console.log('   Changes:');
      result.changes.slice(0, 5).forEach(c => console.log(`     • ${c}`)); // limit output
      if (result.changes.length > 5) console.log(`     ... and ${result.changes.length - 5} more`);
    }

    if (result.errors.length > 0) {
      console.log('   Issues:');
      result.errors.forEach(e => console.log(`     • ${e}`));
    }
  }

  console.log(`\n🎯 Repos Sync completed!`);
  if (settings.GIT_CLEAN_ENABLED) {
    console.log('   (Git clean was enabled)');
  }
}