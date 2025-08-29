import { readFile } from 'fs/promises';
import { CommitAuthorshipData, LineRange } from '../types.ts';
import { execGitCommand, getGitNote } from '../utils/git.ts';
import { fileExists } from '../utils/files.ts';

export interface AuthorshipEntry {
  lineNumber: number;
  isAiAuthored: boolean;
  commitHash: string;
  timestamp: number;
}

export interface FileAuthorshipState {
  filePath: string;
  totalLines: number;
  authorshipMap: Map<number, AuthorshipEntry>; // line number -> authorship info
}

export interface RollupResult {
  files: Map<string, FileAuthorshipState>;
  totalCommitsProcessed: number;
}

export interface CommitInfo {
  hash: string;
  timestamp: number;
  authorshipData?: CommitAuthorshipData;
}

/**
 * Converts line ranges to individual line numbers
 */
function expandLineRanges(ranges: LineRange[]): number[] {
  const lines: number[] = [];
  
  for (const range of ranges) {
    for (let lineNum = range.start; lineNum <= range.end; lineNum++) {
      lines.push(lineNum);
    }
  }
  
  return lines.sort((a, b) => a - b);
}

/**
 * Merges overlapping line ranges and returns deduplicated ranges
 */
function mergeLineRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) return [];
  
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: LineRange[] = [];
  
  let currentRange = sorted[0];
  
  for (let i = 1; i < sorted.length; i++) {
    const nextRange = sorted[i];
    
    if (nextRange.start <= currentRange.end + 1) {
      currentRange = {
        start: currentRange.start,
        end: Math.max(currentRange.end, nextRange.end)
      };
    } else {
      merged.push(currentRange);
      currentRange = nextRange;
    }
  }
  
  merged.push(currentRange);
  return merged;
}

/**
 * Gets all commits with their timestamps, optionally filtered by time period
 */
async function getCommitsWithTimestamps(since?: string): Promise<CommitInfo[]> {
  const args = ['log', '--format=%H|%ct', '--reverse']; // chronological order
  if (since) {
    args.push(`--since=${since}`);
  }
  
  try {
    const output = await execGitCommand(args);
    if (!output) return [];
    
    return output.split('\n').map(line => {
      const [hash, timestampStr] = line.split('|');
      return {
        hash,
        timestamp: parseInt(timestampStr, 10) * 1000 // convert to milliseconds
      };
    });
  } catch {
    return [];
  }
}

/**
 * Parses a git note in the claude-was-here format
 */
function parseCommitNote(noteText: string): CommitAuthorshipData | null {
  const lines = noteText.split('\n');
  
  if (lines[0] !== 'claude-was-here') {
    return null;
  }
  
  let version = '1.0';
  let startIndex = 1;
  
  if (lines[1]?.startsWith('version: ')) {
    version = lines[1].substring('version: '.length);
    startIndex = 2;
  }
  
  const files = [];
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(': ')) continue;
    
    const [filePath, rangesStr] = line.split(': ', 2);
    const ranges: LineRange[] = [];
    
    if (rangesStr) {
      const rangeStrings = rangesStr.split(', ');
      for (const rangeStr of rangeStrings) {
        if (rangeStr.includes('-')) {
          const [start, end] = rangeStr.split('-').map(n => parseInt(n, 10));
          ranges.push({ start, end });
        } else {
          const lineNumber = parseInt(rangeStr, 10);
          ranges.push({ start: lineNumber, end: lineNumber });
        }
      }
    }
    
    files.push({
      filePath,
      aiAuthoredRanges: ranges
    });
  }
  
  return {
    version,
    files
  };
}

/**
 * Gets the current line count for a file
 */
async function getCurrentLineCount(filePath: string): Promise<number> {
  try {
    if (!(await fileExists(filePath))) {
      return 0;
    }
    const content = await readFile(filePath, 'utf-8');
    return content ? content.split('\n').length : 0;
  } catch {
    return 0;
  }
}

/**
 * Rolls up authorship data across multiple commits to produce final authorship state
 * 
 * This function processes commits chronologically and tracks how line authorship evolves:
 * 1. Start with empty authorship state
 * 2. For each commit, apply AI authorship data from git notes
 * 3. Any lines not marked as AI-authored are considered human-authored
 * 4. Handle file changes (lines added/removed) by adjusting line numbers
 * 5. Return final state that reflects current file contents
 */
export async function rollupAuthorship(since?: string): Promise<RollupResult> {
  const commits = await getCommitsWithTimestamps(since);
  
  if (commits.length === 0) {
    return {
      files: new Map(),
      totalCommitsProcessed: 0
    };
  }
  
  // Load authorship data for all commits
  for (const commit of commits) {
    const noteText = await getGitNote(commit.hash, 'claude-was-here');
    if (noteText) {
      commit.authorshipData = parseCommitNote(noteText);
    }
  }
  
  // Track final authorship state for each file
  const fileStates = new Map<string, FileAuthorshipState>();
  
  // Process commits chronologically
  for (const commit of commits) {
    if (!commit.authorshipData) continue;
    
    for (const fileInfo of commit.authorshipData.files) {
      const filePath = fileInfo.filePath;
      
      // Get or create file state
      let fileState = fileStates.get(filePath);
      if (!fileState) {
        fileState = {
          filePath,
          totalLines: 0,
          authorshipMap: new Map()
        };
        fileStates.set(filePath, fileState);
      }
      
      // Mark AI-authored lines from this commit
      const aiLines = expandLineRanges(fileInfo.aiAuthoredRanges);
      
      for (const lineNumber of aiLines) {
        fileState.authorshipMap.set(lineNumber, {
          lineNumber,
          isAiAuthored: true,
          commitHash: commit.hash,
          timestamp: commit.timestamp
        });
      }
    }
  }
  
  // Update current line counts and validate against current file state
  for (const [filePath, fileState] of fileStates) {
    const currentLineCount = await getCurrentLineCount(filePath);
    fileState.totalLines = currentLineCount;
    
    // Remove authorship entries for lines that no longer exist
    for (const [lineNumber] of fileState.authorshipMap) {
      if (lineNumber > currentLineCount) {
        fileState.authorshipMap.delete(lineNumber);
      }
    }
  }
  
  return {
    files: fileStates,
    totalCommitsProcessed: commits.length
  };
}

/**
 * Gets authorship statistics for a specific file from rollup result
 */
export function getFileStats(fileState: FileAuthorshipState): {
  totalLines: number;
  aiLines: number;
  humanLines: number;
  aiPercentage: number;
  humanPercentage: number;
} {
  const totalLines = fileState.totalLines;
  let aiLines = 0;
  
  // Count AI-authored lines that still exist
  for (const [lineNumber, entry] of fileState.authorshipMap) {
    if (entry.isAiAuthored && lineNumber <= totalLines) {
      aiLines++;
    }
  }
  
  const humanLines = totalLines - aiLines;
  
  return {
    totalLines,
    aiLines,
    humanLines,
    aiPercentage: totalLines > 0 ? (aiLines / totalLines) * 100 : 0,
    humanPercentage: totalLines > 0 ? (humanLines / totalLines) * 100 : 0
  };
}

/**
 * Gets overall repository statistics from rollup result
 */
export function getOverallStats(rollupResult: RollupResult): {
  totalFiles: number;
  totalLines: number;
  aiLines: number;
  humanLines: number;
  aiPercentage: number;
  humanPercentage: number;
} {
  let totalFiles = 0;
  let totalLines = 0;
  let aiLines = 0;
  
  for (const [, fileState] of rollupResult.files) {
    if (fileState.totalLines > 0) {
      totalFiles++;
      totalLines += fileState.totalLines;
      
      const fileStats = getFileStats(fileState);
      aiLines += fileStats.aiLines;
    }
  }
  
  const humanLines = totalLines - aiLines;
  
  return {
    totalFiles,
    totalLines,
    aiLines,
    humanLines,
    aiPercentage: totalLines > 0 ? (aiLines / totalLines) * 100 : 0,
    humanPercentage: totalLines > 0 ? (humanLines / totalLines) * 100 : 0
  };
}