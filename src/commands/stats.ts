import { rollupAuthorship, getFileStats, getOverallStats } from '../lib/authorship-rollup.ts';

interface StatsOptions {
  since?: string;
}

interface FileDisplayStats {
  filePath: string;
  totalLines: number;
  aiLines: number;
  percentage: number;
}

export async function showStats(options: StatsOptions): Promise<void> {
  try {
    // Use rollup function to get comprehensive authorship data
    const rollupResult = await rollupAuthorship(options.since);
    
    if (rollupResult.totalCommitsProcessed === 0) {
      console.log('No commits with Claude Code tracking data found.');
      if (options.since) {
        console.log(`Try running without --since="${options.since}" to see all tracked changes.`);
      }
      return;
    }
    
    console.log(`📊 Claude Code Statistics (${options.since || 'all time'})`);
    console.log('='.repeat(50));
    
    // Get overall statistics
    const overallStats = getOverallStats(rollupResult);
    
    // Display overall statistics
    console.log('\n🤖 Overall Repository Statistics:');
    console.log(`   AI-authored lines: ${overallStats.aiLines}/${overallStats.totalLines} (${overallStats.aiPercentage.toFixed(1)}%)`);
    
    // Prepare per-file statistics
    const fileDisplayStats: FileDisplayStats[] = [];
    
    for (const [filePath, fileState] of rollupResult.files) {
      if (fileState.totalLines > 0) {
        const fileStats = getFileStats(fileState);
        
        if (fileStats.aiLines > 0) { // Only show files with AI authorship
          fileDisplayStats.push({
            filePath,
            totalLines: fileStats.totalLines,
            aiLines: fileStats.aiLines,
            percentage: fileStats.aiPercentage
          });
        }
      }
    }
    
    if (fileDisplayStats.length === 0) {
      console.log('\nNo files with AI-authored lines currently exist in the repository.');
      return;
    }
    
    // Sort by percentage descending
    fileDisplayStats.sort((a, b) => b.percentage - a.percentage);
    
    // Display per-file statistics
    console.log('\n📁 Per-File Statistics:');
    
    for (const fileStat of fileDisplayStats) {
      console.log(`   ${fileStat.filePath}: ${fileStat.aiLines}/${fileStat.totalLines} (${fileStat.percentage.toFixed(1)}%)`);
    }
    
    console.log(`\n📈 Total tracked commits: ${rollupResult.totalCommitsProcessed}`);
    console.log(`📁 Total tracked files: ${fileDisplayStats.length}`);
    
  } catch (error) {
    console.error('❌ Error calculating stats:', error);
    process.exit(1);
  }
}