import { execGitCommand } from '../utils/git.ts';
import type { GitNoteData, LineRange } from '../types.ts';

interface StatsOptions {
  since?: string;
}

interface FileStats {
  totalLines: number;
  claudeLines: number;
  percentage: number;
}

export async function showStats(options: StatsOptions): Promise<void> {
  try {
    const since = options.since || '1 week';
    
    console.log(`🤖 Claude Code Stats - Since: ${since}`);
    console.log('=' + '='.repeat(50));
    
    // Get list of commits within the time range
    const commits = await getCommitsSince(since);
    
    if (commits.length === 0) {
      console.log('\nNo commits found in the specified time period.');
      return;
    }
    
    console.log(`\nAnalyzing ${commits.length} commits...`);
    
    // Collect stats for all files
    const fileStatsMap = new Map<string, FileStats>();
    
    for (const commit of commits) {
      // Check if this commit has Claude metadata
      const noteData = await getCommitNote(commit);
      if (noteData && noteData.claude_was_here) {
        // Process files in this commit
        for (const [filePath, fileData] of Object.entries(noteData.claude_was_here.files)) {
          if (!fileStatsMap.has(filePath)) {
            fileStatsMap.set(filePath, {
              totalLines: 0,
              claudeLines: 0,
              percentage: 0
            });
          }
          
          const stats = fileStatsMap.get(filePath)!;
          
          // Count Claude lines from ranges
          for (const range of fileData.ranges) {
            const [start, end] = range;
            stats.claudeLines += (end - start + 1);
          }
        }
      }
    }
    
    // Get current line counts for all tracked files
    for (const [filePath, stats] of fileStatsMap.entries()) {
      try {
        const lineCount = await getFileLineCount(filePath);
        stats.totalLines = lineCount;
        stats.percentage = stats.totalLines > 0 
          ? Math.round((stats.claudeLines / stats.totalLines) * 100) 
          : 0;
      } catch (error) {
        // File might have been deleted, but we still have Claude lines tracked
        // For deleted files, show the Claude lines as both total and Claude lines
        stats.totalLines = stats.claudeLines;
        stats.percentage = stats.claudeLines > 0 ? 100 : 0;
      }
    }
    
    // Calculate overall statistics
    let totalLines = 0;
    let totalClaudeLines = 0;
    
    for (const stats of fileStatsMap.values()) {
      totalLines += stats.totalLines;
      totalClaudeLines += stats.claudeLines;
    }
    
    const overallPercentage = totalLines > 0 
      ? Math.round((totalClaudeLines / totalLines) * 100) 
      : 0;
    
    // Display results
    console.log('\n📊 Overall Statistics:');
    console.log(`Total lines: ${totalLines.toLocaleString()}`);
    console.log(`Claude-authored lines: ${totalClaudeLines.toLocaleString()}`);
    console.log(`Percentage: ${overallPercentage}%`);
    
    // Show top files by Claude contribution
    const sortedFiles = Array.from(fileStatsMap.entries())
      .sort((a, b) => b[1].claudeLines - a[1].claudeLines)
      .slice(0, 10);
    
    if (sortedFiles.length > 0) {
      console.log('\n📁 Top files by Claude contribution:');
      for (const [filePath, stats] of sortedFiles) {
        console.log(`  ${filePath}: ${stats.claudeLines}/${stats.totalLines} lines (${stats.percentage}%)`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error calculating stats:', error);
    process.exit(1);
  }
}

async function getCommitsSince(since: string): Promise<string[]> {
  try {
    const result = await execGitCommand(['log', `--since`, since, '--format=%H']);
    return result.split('\n').filter(hash => hash.trim());
  } catch {
    return [];
  }
}

async function getCommitNote(commitHash: string): Promise<GitNoteData | null> {
  try {
    const noteContent = await execGitCommand(['notes', 'show', commitHash]);
    
    // Parse aligned key-value format
    const lines = noteContent.trim().split('\n');
    if (lines.length < 2) return null;
    
    // First line should be "claude-was-here"
    if (lines[0] !== 'claude-was-here') return null;
    
    // Second line should be "version: X.X"
    const versionMatch = lines[1].match(/^version:\s*(.+)$/);
    if (!versionMatch) return null;
    
    const noteData: GitNoteData = {
      claude_was_here: {
        version: versionMatch[1],
        files: {}
      }
    };
    
    // Parse file entries (from line 2 onwards)
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Find the colon and split there
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const filePath = line.substring(0, colonIndex);
      const rangesStr = line.substring(colonIndex + 1).trim();
      
      if (!filePath || !rangesStr) continue;
      
      // Parse ranges (e.g., "1-10,15-20,25-25")
      const ranges: LineRange[] = rangesStr.split(',').map(range => {
        const [start, end] = range.split('-').map(n => parseInt(n, 10));
        return [start, end];
      });
      
      noteData.claude_was_here.files[filePath] = { ranges };
    }
    
    return noteData;
  } catch {
    // No note for this commit
    return null;
  }
}

async function getFileLineCount(filePath: string): Promise<number> {
  const result = await execGitCommand(['show', `HEAD:${filePath}`]);
  return result.split('\n').length;
}