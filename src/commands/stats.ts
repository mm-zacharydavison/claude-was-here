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
    
    // Get the earliest commit in our range to use as base
    const oldestCommit = commits[commits.length - 1];
    const baseCommit = await getParentCommit(oldestCommit);
    
    // Collect all files that were touched by Claude in the time period
    const claudeTouchedFiles = new Set<string>();
    
    for (const commit of commits) {
      const noteData = await getCommitNote(commit);
      if (noteData && noteData.claude_was_here) {
        for (const filePath of Object.keys(noteData.claude_was_here.files)) {
          claudeTouchedFiles.add(filePath);
        }
      }
    }
    
    // Collect stats by analyzing final state vs base state for Claude-touched files
    const fileStatsMap = new Map<string, FileStats>();
    
    for (const filePath of claudeTouchedFiles) {
      try {
        // Analyze this file's changes using the same logic as GitHub Actions
        const claudeData = await collectClaudeDataForFile(filePath, commits);
        const finalStats = await analyzeFileClaudeContribution(filePath, claudeData, baseCommit, 'HEAD');
        
        if (finalStats) {
          fileStatsMap.set(filePath, finalStats);
        }
      } catch (error) {
        console.error(`Warning: Could not analyze ${filePath}: ${error}`);
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
      
      // Skip content-signatures line
      if (line.startsWith('content-signatures:')) continue;
      
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

async function getParentCommit(commitHash: string): Promise<string> {
  try {
    return await execGitCommand(['rev-parse', `${commitHash}^`]);
  } catch {
    // If no parent, return the commit itself (probably first commit)
    return commitHash;
  }
}

async function collectClaudeDataForFile(filePath: string, commits: string[]): Promise<string> {
  let claudeData = '';
  
  for (const commit of commits) {
    const noteData = await getCommitNote(commit);
    if (noteData && noteData.claude_was_here && noteData.claude_was_here.files[filePath]) {
      const fileData = noteData.claude_was_here.files[filePath];
      
      // Convert ranges back to range string format
      const ranges = fileData.ranges.map(([start, end]) => 
        start === end ? start.toString() : `${start}-${end}`
      ).join(',');
      
      claudeData += `${commit}|${filePath}|${ranges}\n`;
    }
  }
  
  return claudeData;
}

async function analyzeFileClaudeContribution(
  filePath: string, 
  claudeData: string, 
  baseCommit: string, 
  headCommit: string
): Promise<FileStats | null> {
  if (!claudeData.trim()) {
    return null;
  }
  
  try {
    // Parse Claude's original contributions (same as GitHub Actions script)
    const claudeFiles = new Map<string, Set<number>>();
    
    for (const line of claudeData.split('\n')) {
      if (!line.trim()) continue;
      
      const parts = line.split('|');
      if (parts.length === 3) {
        const [commitHash, filepath, ranges] = parts;
        
        if (filepath === filePath) {
          if (!claudeFiles.has(filepath)) {
            claudeFiles.set(filepath, new Set());
          }
          
          // Parse ranges like "10-20,25-30"
          for (const rangeStr of ranges.split(',')) {
            if (rangeStr.includes('-')) {
              const [start, end] = rangeStr.split('-').map(n => parseInt(n));
              for (let i = start; i <= end; i++) {
                claudeFiles.get(filepath)!.add(i);
              }
            } else {
              claudeFiles.get(filepath)!.add(parseInt(rangeStr));
            }
          }
        }
      }
    }
    
    // Get final diff lines for this file
    const finalLines = await getFinalDiffLinesForFile(filePath, baseCommit, headCommit);
    
    // Map Claude contributions to final lines
    let claudeContributedLines = 0;
    if (claudeFiles.has(filePath) && finalLines.size > 0) {
      // Simple mapping: if Claude touched the file and it has final changes,
      // assume Claude contributed to those changes
      claudeContributedLines = finalLines.size;
    }
    
    // Get current file line count
    const totalLines = await getFileLineCount(filePath);
    
    return {
      totalLines,
      claudeLines: claudeContributedLines,
      percentage: totalLines > 0 ? Math.round((claudeContributedLines / totalLines) * 100) : 0
    };
    
  } catch (error) {
    console.error(`Error analyzing ${filePath}:`, error);
    return null;
  }
}

async function getFinalDiffLinesForFile(filePath: string, baseCommit: string, headCommit: string): Promise<Set<number>> {
  try {
    const result = await execGitCommand([
      'diff', '--unified=0', `${baseCommit}..${headCommit}`, '--', filePath
    ]);
    
    const finalLines = new Set<number>();
    
    for (const line of result.split('\n')) {
      if (line.startsWith('@@')) {
        // Parse hunk header like @@ -1,4 +10,8 @@
        const match = line.match(/\+(\d+)(?:,(\d+))?/);
        if (match) {
          const startLine = parseInt(match[1]);
          const count = match[2] ? parseInt(match[2]) : 1;
          
          // Mark these lines as part of the final diff
          for (let i = startLine; i < startLine + count; i++) {
            finalLines.add(i);
          }
        }
      }
    }
    
    return finalLines;
  } catch {
    return new Set<number>();
  }
}