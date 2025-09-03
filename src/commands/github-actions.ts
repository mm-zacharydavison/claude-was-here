import { writeFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { logger } from '../utils/logger.ts';

/**
 * Execute a git command and return result with stdout, stderr, and code
 */
const execGitCommand = (args: string[]): Promise<{ stdout: string; stderr: string; code: number }> => {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());
    
    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code || 0 });
    });
  });
};

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
 * Collect Claude notes from all commits in a range and output consolidated data
 * Used by GitHub Actions on PR synchronize events
 */
export async function githubSynchronizePR(baseCommit: string, headCommit: string): Promise<void> {
  try {
    // Get all commits in the range
    const commitsResult = await execGitCommand(['log', '--format=%H', `${baseCommit}..${headCommit}`]);
    if (!commitsResult || commitsResult.code !== 0) {
      throw new Error(`Failed to get commits: ${commitsResult?.stderr || 'Unknown error'}`);
    }
    const commits = commitsResult.stdout.split('\n').filter(hash => hash.trim());
    
    const contributions: ClaudeContribution[] = [];
    const contentSignatures: ContentSignatures = { hashes: new Set() };
    
    // Process each commit's notes
    for (const commitHash of commits) {
      const notesResult = await execGitCommand(['notes', 'show', commitHash]);
      if (notesResult.code === 0) {
        const noteLines = notesResult.stdout.split('\n');
        
        for (const line of noteLines) {
          // Skip header lines
          if (line === 'claude-was-here' || line.startsWith('version:')) {
            continue;
          }
          
          // Skip empty lines
          if (!line.trim()) {
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
          
          // Parse file:ranges lines
          const match = line.match(/^([^:]+):\s+(.+)$/);
          if (match) {
            const filepath = match[1].trim();
            const ranges = match[2].trim();
            if (filepath && ranges) { // Only add if both filepath and ranges are non-empty
              contributions.push({ commitHash, filepath, ranges });
            }
          }
        }
      }
    }
    
    // Output the collected data as a JSON artifact for the next workflow
    const outputData = {
      baseCommit,
      headCommit,
      contributions,
      contentSignatures: Array.from(contentSignatures.hashes)
    };
    
    // Write to a file that GitHub Actions can use as an artifact
    const outputPath = join(process.cwd(), 'claude-notes-data.json');
    await writeFile(outputPath, JSON.stringify(outputData, null, 2));
    
  } catch (error) {
    logger.error('❌ Error collecting Claude notes:', error);
    process.exit(1);
  }
}

/**
 * Apply consolidated Claude notes to a squashed merge commit
 * Used by GitHub Actions on PR closed (merged) events
 */
export async function githubSquashPR(dataFilePath: string, baseCommit: string, mergeCommit: string): Promise<void> {
  try {
    // Read the data file from the previous workflow
    const { readFile } = await import('fs/promises');
    const dataContent = await readFile(dataFilePath, 'utf-8');
    const data = JSON.parse(dataContent);
    
    // Consolidate all Claude contributions into final line mappings
    const claudeLineMapping = await consolidateClaudeContributions(data.contributions);
    
    // Generate the final Claude note
    const noteContent = generateClaudeNote(claudeLineMapping, { hashes: new Set(data.contentSignatures) });
    
    // Write note to temporary file
    const noteFilePath = join(process.cwd(), 'final-claude-note.txt');
    await writeFile(noteFilePath, noteContent);
    
    // Apply the note to the merge commit
    const addNoteResult = await execGitCommand(['notes', 'add', '-F', noteFilePath, mergeCommit]);
    if (addNoteResult.code !== 0) {
      throw new Error(`Failed to add note to commit: ${addNoteResult.stderr}`);
    }
    
    // Push the notes to remote
    const pushResult = await execGitCommand(['push', 'origin', 'refs/notes/commits']);
    if (pushResult.code !== 0) {
      logger.warn('⚠️  Warning: Could not push git notes to remote:', pushResult.stderr);
    }
    
  } catch (error) {
    logger.error('❌ Error applying Claude notes to squashed commit:', error);
    process.exit(1);
  }
}

/**
 * Consolidate Claude contributions from multiple commits into final line mappings
 */
async function consolidateClaudeContributions(contributions: ClaudeContribution[]): Promise<ClaudeLineMapping> {
  const finalClaudeLines: ClaudeLineMapping = {};
  
  // Parse ranges from string like "10-20,25-30" into line numbers
  const parseRanges = (ranges: string): number[] => {
    const lines: number[] = [];
    
    // Handle empty or whitespace-only ranges
    if (!ranges || !ranges.trim()) {
      return lines;
    }
    
    for (const rangeStr of ranges.split(',')) {
      const trimmed = rangeStr.trim();
      if (!trimmed) continue; // Skip empty range parts
      
      if (trimmed.includes('-')) {
        const [startStr, endStr] = trimmed.split('-');
        const start = parseInt(startStr);
        const end = parseInt(endStr);
        
        // Validate that both start and end are valid numbers
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            lines.push(i);
          }
        }
      } else {
        const lineNum = parseInt(trimmed);
        if (!isNaN(lineNum)) {
          lines.push(lineNum);
        }
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
  const { readFile } = await import('fs/promises');
  const existingFiles: ClaudeLineMapping = {};
  for (const [filepath, lineSet] of Object.entries(finalClaudeLines)) {
    try {
      const fileContent = await readFile(join(process.cwd(), filepath), 'utf-8');
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
      console.warn(`⚠️  Skipping ${filepath} - file not found in final version`);
      continue;
    }
  }
  
  return existingFiles;
}

/**
 * Convert line numbers to compact range notation
 */
function convertLinesToRanges(lines: number[]): string {
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
}

/**
 * Generate a claude-was-here note in the standard format
 */
function generateClaudeNote(claudeLineMapping: ClaudeLineMapping, contentSignatures?: ContentSignatures): string {
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
}