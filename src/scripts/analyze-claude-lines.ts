#!/usr/bin/env -S bun run
/**
 * Analyze Claude Code contributions across commits and map them to final diff lines.
 * 
 * This script is used by GitHub Actions to preserve Claude Code tracking data
 * when PRs are squashed, ensuring accurate attribution in the final commit.
 * 
 * NOTE: This script contains embedded logic from the claude-was-here shared module
 * to avoid import dependencies when installed in other repositories.
 */

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

interface ClaudeContribution {
  commitHash: string;
  filepath: string;
  ranges: string;
}

interface ContentSignatures {
  hashes: Set<string>;
}

interface ClaudeLineMapping {
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
const collectClaudeNotesFromCommits = async (
  testDir: string, 
  baseCommit: string, 
  headCommit: string
): Promise<{ contributions: ClaudeContribution[], contentSignatures: ContentSignatures }> => {
  const commitsResult = await execGitCommand(['log', '--format=%H', `${baseCommit}..${headCommit}`], testDir);
  const commits = commitsResult.stdout.split('\n').filter(hash => hash.trim());
  
  const contributions: ClaudeContribution[] = [];
  const contentSignatures: ContentSignatures = { hashes: new Set() };
  
  for (const commitHash of commits) {
    const notesResult = await execGitCommand(['notes', 'show', commitHash], testDir);
    if (notesResult.code === 0) {
      const noteLines = notesResult.stdout.split('\n');
      
      for (const line of noteLines) {
        if (line === 'claude-was-here' || line.startsWith('version:')) {
          continue;
        }
        
        // Handle content-signatures line
        if (line.startsWith('content-signatures:')) {
          const hashesStr = line.substring('content-signatures:'.length).trim();
          if (hashesStr) {
            const hashes = hashesStr.split(',').map(h => h.trim()).filter(h => h);
            hashes.forEach(hash => contentSignatures.hashes.add(hash));
          }
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
  
  return { contributions, contentSignatures };
};

// Note: Removed getFinalDiffLines - we now use git notes data directly

/**
 * Consolidate Claude contributions from git notes into final line mappings
 * This directly uses the line authorship data from git notes without pattern matching
 */
const consolidateClaudeContributions = async (
  testDir: string,
  contributions: ClaudeContribution[]
): Promise<ClaudeLineMapping> => {
  const finalClaudeLines: ClaudeLineMapping = {};
  
  // Parse ranges from string like "10-20,25-30" into line numbers
  const parseRanges = (ranges: string): number[] => {
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
  
  // Filter out files that don't exist and validate line numbers are within bounds
  const existingFiles: ClaudeLineMapping = {};
  for (const [filepath, lineSet] of Object.entries(finalClaudeLines)) {
    try {
      const fileContent = await readFile(join(testDir, filepath), 'utf-8');
      const totalLines = fileContent.split('\n').length;
      
      // Filter out line numbers that exceed the file's actual line count
      const validLines = new Set<number>();
      for (const lineNum of lineSet) {
        if (lineNum >= 1 && lineNum <= totalLines) {
          validLines.add(lineNum);
        }
      }
      
      // Only include the file if it has valid Claude lines
      if (validLines.size > 0) {
        existingFiles[filepath] = validLines;
      }
    } catch (error) {
      // File doesn't exist in final version, skip it
      continue;
    }
  }
  
  return existingFiles;
};

// Note: getFinalDiffLines function is no longer needed since we use git notes data directly

/**
 * Convert line numbers to compact range notation
 */
const convertLinesToRanges = (lines: number[]): string => {
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
const generateClaudeNote = (claudeLineMapping: ClaudeLineMapping, contentSignatures?: ContentSignatures): string => {
  let output = 'claude-was-here\nversion: 1.1\n';
  
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
  
  // Add content signatures if present
  if (contentSignatures && contentSignatures.hashes.size > 0) {
    output += '\n'; // Empty line separator
    output += `content-signatures: ${Array.from(contentSignatures.hashes).join(',')}\n`;
  }
  
  return output;
};

/**
 * Main analysis function that combines all steps
 */
const analyzePRSquashClaudeContributions = async (
  testDir: string,
  baseCommit: string,
  headCommit: string
): Promise<string> => {
  // Step 1: Collect Claude notes from all commits in the PR
  const { contributions, contentSignatures } = await collectClaudeNotesFromCommits(testDir, baseCommit, headCommit);
  
  // Step 2: Consolidate Claude contributions directly from git notes data
  const claudeLineMapping = await consolidateClaudeContributions(testDir, contributions);
  
  // Step 3: Generate the final note with preserved content signatures
  return generateClaudeNote(claudeLineMapping, contentSignatures);
};

async function main() {
  if (process.argv.length < 5) {
    console.error("Usage: bun run analyze-claude-lines.ts <claude_data_file> <base_commit> <latest_commit>");
    console.error("");
    console.error("This script analyzes Claude Code contributions across commits and maps them");
    console.error("to the final diff, generating accurate attribution for squashed commits.");
    process.exit(1);
  }
  
  const claudeDataFile = process.argv[2];
  const baseCommit = process.argv[3];
  const latestCommit = process.argv[4];
  
  try {
    // Verify the Claude data file exists
    await readFile(claudeDataFile, 'utf-8');
    console.error(`Processing Claude contributions from ${claudeDataFile}`);
    
    // Use the embedded analysis logic
    const noteContent = await analyzePRSquashClaudeContributions(
      process.cwd(),
      baseCommit, 
      latestCommit
    );
    
    // Output the final note content
    console.log(noteContent);
    
  } catch (error) {
    console.error('Error analyzing Claude contributions:', error);
    process.exit(1);
  }
}

main().catch(console.error);