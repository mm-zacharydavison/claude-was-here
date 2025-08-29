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
 * This function processes ALL commits chronologically and tracks file evolution:
 * 1. Process every commit chronologically, not just ones with authorship data
 * 2. For each file, maintain a line-by-line authorship state 
 * 3. When a commit has authorship data, update authorship for specified lines
 * 4. When a commit modifies a file (with or without authorship data), invalidate
 *    authorship for lines that may have changed
 * 5. Return final state that reflects current file contents with accurate authorship
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
  
  // Track authorship state evolution for each file
  const fileStates = new Map<string, FileAuthorshipState>();
  
  // Get list of all files that were modified across all commits
  const allModifiedFiles = new Set<string>();
  for (const commit of commits) {
    try {
      // Get list of files changed in this commit
      const output = await execGitCommand(['diff-tree', '--no-commit-id', '--name-only', '-r', commit.hash]);
      if (output) {
        output.split('\n').forEach(file => {
          if (file.trim()) {
            allModifiedFiles.add(file.trim());
          }
        });
      }
    } catch {
      // If we can't get file list, continue
    }
    
    // Also add files from authorship data
    if (commit.authorshipData) {
      commit.authorshipData.files.forEach(fileInfo => {
        allModifiedFiles.add(fileInfo.filePath);
      });
    }
  }
  
  // Initialize file states for all modified files
  for (const filePath of allModifiedFiles) {
    fileStates.set(filePath, {
      filePath,
      totalLines: 0,
      authorshipMap: new Map()
    });
  }
  
  // Track which files have had non-authorship commits since their last authorship commit
  const filesWithInterveningChanges = new Map<string, boolean>();
  
  // Process commits chronologically and track file evolution
  for (let commitIndex = 0; commitIndex < commits.length; commitIndex++) {
    const commit = commits[commitIndex];
    
    // Get files modified in this commit
    const filesModifiedInCommit = new Set<string>();
    try {
      // Try diff-tree first
      const output = await execGitCommand(['diff-tree', '--no-commit-id', '--name-only', '-r', commit.hash]);
      if (output && output.trim()) {
        output.split('\n').forEach(file => {
          if (file.trim()) {
            filesModifiedInCommit.add(file.trim());
          }
        });
      } else {
        // If diff-tree returns empty (initial commit), get all files in the commit
        const lsOutput = await execGitCommand(['ls-tree', '--name-only', '-r', commit.hash]);
        if (lsOutput) {
          lsOutput.split('\n').forEach(file => {
            if (file.trim()) {
              filesModifiedInCommit.add(file.trim());
            }
          });
        }
      }
    } catch {
      // Continue if we can't get the file list
    }
    
    // For each file modified in this commit, handle authorship
    for (const filePath of filesModifiedInCommit) {
      const fileState = fileStates.get(filePath);
      if (!fileState) continue;
      
      // Get file content at this commit
      let fileContentAtCommit: string | null = null;
      try {
        const output = await execGitCommand(['show', `${commit.hash}:${filePath}`]);
        fileContentAtCommit = output;
      } catch {
        // File might have been deleted or other git error
        continue;
      }
      
      if (!fileContentAtCommit) continue;
      
      const linesAtCommit = fileContentAtCommit.split('\n');
      
      // If this commit has authorship data for this file, apply it
      if (commit.authorshipData) {
        const fileAuthorship = commit.authorshipData.files.find(f => f.filePath === filePath);
        if (fileAuthorship) {
          const aiLines = expandLineRanges(fileAuthorship.aiAuthoredRanges);
          
          // Only clear existing authorship if there were intervening changes
          // that could have invalidated the previous authorship
          if (filesWithInterveningChanges.get(filePath)) {
            fileState.authorshipMap.clear();
            filesWithInterveningChanges.set(filePath, false);
          }
          
          // Add/update authorship based on this commit
          for (const lineNumber of aiLines) {
            if (lineNumber > 0 && lineNumber <= linesAtCommit.length) {
              fileState.authorshipMap.set(lineNumber, {
                lineNumber,
                isAiAuthored: true,
                commitHash: commit.hash,
                timestamp: commit.timestamp + commitIndex
              });
            }
          }
        } else {
          // File was modified but no authorship data for this file in this commit
          // Mark that this file has intervening changes
          filesWithInterveningChanges.set(filePath, true);
        }
      } else {
        // File was modified but no authorship data at all for this commit
        // Mark that this file has intervening changes that could invalidate authorship
        filesWithInterveningChanges.set(filePath, true);
      }
    }
  }
  
  // Final validation: ensure authorship only applies to lines that exist in current files
  for (const [filePath, fileState] of fileStates) {
    const currentLineCount = await getCurrentLineCount(filePath);
    fileState.totalLines = currentLineCount;
    
    if (currentLineCount === 0) {
      // File was deleted, clear all authorship
      fileState.authorshipMap.clear();
      continue;
    }
    
    // Remove authorship entries for lines that no longer exist
    const validAuthorship = new Map<number, AuthorshipEntry>();
    for (const [lineNumber, entry] of fileState.authorshipMap) {
      if (lineNumber > 0 && lineNumber <= currentLineCount) {
        validAuthorship.set(lineNumber, entry);
      }
    }
    fileState.authorshipMap = validAuthorship;
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