/**
 * Shared logic for analyzing Claude contributions across commits and mapping them to final diff lines.
 * This module is used by both tests and GitHub Actions to ensure consistent behavior.
 */

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

export interface ClaudeContribution {
  commitHash: string;
  filepath: string;
  ranges: string;
}

export interface ClaudeLineMapping {
  [filepath: string]: Set<number>;
}

/**
 * Execute a git command and return the result
 */
const execGitCommand = (args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> => {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { 
      cwd, 
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());
    
    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code || 0 });
    });
  });
};

/**
 * Collect Claude notes from all commits in a range
 */
export const collectClaudeNotesFromCommits = async (
  testDir: string, 
  baseCommit: string, 
  headCommit: string
): Promise<ClaudeContribution[]> => {
  const commitsResult = await execGitCommand(['log', '--format=%H', `${baseCommit}..${headCommit}`], testDir);
  const commits = commitsResult.stdout.split('\n').filter(hash => hash.trim());
  
  const contributions: ClaudeContribution[] = [];
  
  for (const commitHash of commits) {
    const notesResult = await execGitCommand(['notes', 'show', commitHash], testDir);
    if (notesResult.code === 0) {
      const noteLines = notesResult.stdout.split('\n');
      
      for (const line of noteLines) {
        if (line === 'claude-was-here' || line.startsWith('version:')) {
          continue;
        }
        
        const match = line.match(/^([^:]+):\s+(.+)$/);
        if (match) {
          const filepath = match[1].trim();
          const ranges = match[2].trim();
          contributions.push({ commitHash, filepath, ranges });
        }
      }
    }
  }
  
  return contributions;
};

/**
 * Parse range strings like "10-20,25-30" into line numbers
 */
export const parseRanges = (ranges: string): number[] => {
  const lines: number[] = [];
  
  for (const rangeStr of ranges.split(',')) {
    const trimmed = rangeStr.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(n => parseInt(n));
      for (let i = start; i <= end; i++) {
        lines.push(i);
      }
    } else {
      lines.push(parseInt(trimmed));
    }
  }
  
  return lines;
};

/**
 * Consolidate Claude contributions from git notes into final line mappings
 * This directly uses the line authorship data from git notes without pattern matching
 */
export const consolidateClaudeContributions = async (
  testDir: string,
  contributions: ClaudeContribution[]
): Promise<ClaudeLineMapping> => {
  const finalClaudeLines: ClaudeLineMapping = {};
  
  // Consolidate all Claude contributions by file
  for (const contribution of contributions) {
    const { filepath, ranges } = contribution;
    
    // Initialize file set if not exists
    if (!finalClaudeLines[filepath]) {
      finalClaudeLines[filepath] = new Set();
    }
    
    // Parse the ranges and add all Claude-authored lines
    const lines = parseRanges(ranges);
    for (const lineNum of lines) {
      finalClaudeLines[filepath].add(lineNum);
    }
  }
  
  // Filter out files that don't exist in the final version
  const existingFiles: ClaudeLineMapping = {};
  for (const [filepath, lineSet] of Object.entries(finalClaudeLines)) {
    try {
      await readFile(join(testDir, filepath), 'utf-8');
      existingFiles[filepath] = lineSet;
    } catch (error) {
      // File doesn't exist in final version, skip it
      continue;
    }
  }
  
  return existingFiles;
};

/**
 * Convert line numbers to compact range notation
 */
export const convertLinesToRanges = (lines: number[]): string => {
  if (lines.length === 0) return '';
  
  const sortedLines = [...new Set(lines)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sortedLines[0];
  let end = sortedLines[0];
  
  for (let i = 1; i < sortedLines.length; i++) {
    if (sortedLines[i] === end + 1) {
      end = sortedLines[i];
    } else {
      if (start === end) {
        ranges.push(start.toString());
      } else {
        ranges.push(`${start}-${end}`);
      }
      start = end = sortedLines[i];
    }
  }
  
  // Add final range
  if (start === end) {
    ranges.push(start.toString());
  } else {
    ranges.push(`${start}-${end}`);
  }
  
  return ranges.join(',');
};

/**
 * Generate a claude-was-here note in the standard format
 */
export const generateClaudeNote = (claudeLineMapping: ClaudeLineMapping): string => {
  let output = 'claude-was-here\nversion: 1.0\n';
  
  const filesWithLines = Object.keys(claudeLineMapping).filter(
    filepath => claudeLineMapping[filepath].size > 0
  );
  
  if (filesWithLines.length > 0) {
    const maxLength = Math.max(...filesWithLines.map(path => path.length));
    
    for (const filepath of filesWithLines.sort()) {
      const lineSet = claudeLineMapping[filepath];
      const ranges = convertLinesToRanges(Array.from(lineSet));
      if (ranges) {
        const paddedPath = `${filepath}:`.padEnd(maxLength + 2);
        output += `${paddedPath} ${ranges}\n`;
      }
    }
  }
  
  return output;
};

/**
 * Main analysis function that combines all steps
 */
export const analyzePRSquashClaudeContributions = async (
  testDir: string,
  baseCommit: string,
  headCommit: string
): Promise<string> => {
  // Step 1: Collect Claude notes from all commits in the PR
  const contributions = await collectClaudeNotesFromCommits(testDir, baseCommit, headCommit);
  
  // Step 2: Consolidate Claude contributions directly from git notes data
  const claudeLineMapping = await consolidateClaudeContributions(testDir, contributions);
  
  // Step 3: Generate the final note
  return generateClaudeNote(claudeLineMapping);
};