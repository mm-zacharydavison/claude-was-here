import { readFile, unlink, readdir, rmdir } from 'fs/promises';
import { join } from 'path';
import { getClaudeWasHereDir } from '../utils/files.ts';
import { getCurrentCommitHash, addGitNote } from '../utils/git.ts';
import type { CommitSummary, LineRange } from '../types.ts';

export async function postCommitHook(): Promise<void> {
  try {
    // Get latest commit hash
    const commitHash = await getCurrentCommitHash();
    
    // Check for pending metadata
    const metadataFile = join(getClaudeWasHereDir(), 'pending_commit_metadata.json');
    
    let metadata: CommitSummary;
    try {
      const content = await readFile(metadataFile, 'utf-8');
      metadata = JSON.parse(content);
    } catch {
      // No pending metadata
      return;
    }
    
    // Create enhanced git note with both traditional and hash-based info
    const noteContent = await createEnhancedGitNote(metadata);
    
    // Add note to git
    await addGitNote(commitHash, noteContent);
    
    // Clean up temp files (unless DEBUG is set)
    await cleanupTempFiles(metadataFile);
    
    process.exit(0);
  } catch (error) {
    console.error('Post-commit hook error:', error);
    process.exit(0); // Don't fail on hook errors
  }
}

async function createEnhancedGitNote(metadata: CommitSummary): Promise<string> {
  const lines: string[] = ['claude-was-here', 'version: 1.2']; // Bump version for unified tracking
  
  // Calculate the maximum filename length for alignment
  const filePaths = Object.keys(metadata.files);
  if (filePaths.length === 0) {
    return lines.join('\n');
  }
  
  const maxLength = Math.max(...filePaths.map(path => path.length));
  
  // Simple, unified tracking format
  for (const [filePath, fileData] of Object.entries(metadata.files)) {
    const lineNumbers = fileData.claude_lines;
    const ranges = convertLinesToRanges(lineNumbers);
    
    // Simple range format
    const rangeStr = ranges.map(([start, end]) => `${start}-${end}`).join(',');
    const paddedPath = `${filePath}:`.padEnd(maxLength + 2);
    
    lines.push(`${paddedPath} ${rangeStr}`);
  }
  
  return lines.join('\n');
}

async function cleanupTempFiles(metadataFile: string): Promise<void> {
  // Skip cleanup if DEBUG environment variable is set
  if (process.env.DEBUG) {
    console.log('DEBUG mode: Skipping temp file cleanup');
    return;
  }

  const wasHereDir = getClaudeWasHereDir();
  
  try {
    // Clean up pending metadata file
    await unlink(metadataFile).catch(() => {}); // Ignore if already deleted
    
    // Clean up other temp files
    const tempFiles = [
      'commit_summary.json',
    ];
    
    // Note: debug.log is only created when DEBUG is set, and when DEBUG is set,
    // we skip all cleanup anyway, so no need to include debug.log here
    
    for (const tempFile of tempFiles) {
      const filePath = join(wasHereDir, tempFile);
      await unlink(filePath).catch(() => {}); // Ignore if file doesn't exist
    }
    
    // Clean up individual file metadata JSON files
    try {
      const files = await readdir(wasHereDir);
      for (const file of files) {
        // Clean up .json files that look like file metadata (not archive files)
        if (file.endsWith('.json') && !file.includes('_202')) { // Skip archive files with timestamps
          const filePath = join(wasHereDir, file);
          await unlink(filePath).catch(() => {});
        }
      }
    } catch {
      // Directory might not exist or be readable
    }
    
    // Clean up archive directory and all its contents
    try {
      const archiveDir = join(wasHereDir, 'archive');
      await rmdir(archiveDir, { recursive: true }).catch(() => {}); // Ignore if doesn't exist
    } catch {
      // Archive directory cleanup failed, continue
    }
    
  } catch (error) {
    // Don't fail the hook if cleanup fails
    console.error('Warning: Could not clean up all temp files:', error);
  }
}

function convertLinesToRanges(lines: number[]): LineRange[] {
  if (lines.length === 0) return [];
  
  const ranges: LineRange[] = [];
  let start = lines[0];
  let end = lines[0];
  
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === end + 1) {
      end = lines[i];
    } else {
      // Close current range
      ranges.push([start, end]);
      start = end = lines[i];
    }
  }
  
  // Add final range
  ranges.push([start, end]);
  
  return ranges;
}