import { readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';
import { readdir } from 'fs/promises';
import { ensureDirectory, getClaudeWasHereDir } from '../utils/files.ts';
import { getStagedFiles } from '../utils/git.ts';
import type { CommitSummary, FileMetadata } from '../types.ts';

export async function preCommitHook(): Promise<void> {
  try {
    // Create commit summary
    const summary = await createCommitSummary();
    
    // Store Claude Code metadata for post-commit hook
    if (summary.claude_modified_files > 0) {
      const metadataFile = join(getClaudeWasHereDir(), 'pending_commit_metadata.json');
      await writeFile(metadataFile, JSON.stringify(summary, null, 2));
    }
    
    // Clean up old metadata for committed files
    const wasHereDir = getClaudeWasHereDir();
    const stagedFiles = await getStagedFiles();
    
    for (const stagedFile of stagedFiles) {
      const metadataFile = join(wasHereDir, `${stagedFile.replace(/[/\\]/g, '_')}.json`);
      
      try {
        // Archive instead of delete
        const archiveDir = join(wasHereDir, 'archive');
        await ensureDirectory(archiveDir);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archiveName = `${stagedFile.replace(/[/\\]/g, '_')}_${timestamp}.json`;
        const archivePath = join(archiveDir, archiveName);
        
        await rename(metadataFile, archivePath);
      } catch {
        // File might not exist, ignore
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Pre-commit hook error:', error);
    process.exit(0); // Don't fail the commit on hook errors
  }
}

async function createCommitSummary(): Promise<CommitSummary> {
  const claudeLines = await getClaudeLines();
  const stagedFiles = await getStagedFiles();
  
  const summary: CommitSummary = {
    total_files: stagedFiles.length,
    claude_modified_files: 0,
    claude_modified_lines: 0,
    files: {}
  };
  
  for (const filePath of stagedFiles) {
    if (claudeLines.has(filePath)) {
      const lines = Array.from(claudeLines.get(filePath)!).sort((a, b) => a - b);
      summary.claude_modified_files++;
      summary.claude_modified_lines += lines.length;
      summary.files[filePath] = {
        claude_lines: lines,
        total_claude_lines: lines.length
      };
    }
  }
  
  // Save summary
  const summaryFile = join(getClaudeWasHereDir(), 'commit_summary.json');
  await ensureDirectory(getClaudeWasHereDir());
  await writeFile(summaryFile, JSON.stringify(summary, null, 2));
  
  return summary;
}

async function getClaudeLines(): Promise<Map<string, Set<number>>> {
  const claudeLines = new Map<string, Set<number>>();
  const wasHereDir = getClaudeWasHereDir();
  
  try {
    const files = await readdir(wasHereDir);
    
    for (const fileName of files) {
      if (!fileName.endsWith('.json') || fileName === 'hook_errors.log') {
        continue;
      }
      
      try {
        const filePath = join(wasHereDir, fileName);
        const content = await readFile(filePath, 'utf-8');
        const metadataList: FileMetadata[] = JSON.parse(content);
        
        for (const entry of metadataList) {
          const file = entry.file;
          const lines = entry.lines || [];
          
          if (file && lines.length > 0) {
            if (!claudeLines.has(file)) {
              claudeLines.set(file, new Set());
            }
            for (const line of lines) {
              claudeLines.get(file)!.add(line);
            }
          }
        }
      } catch {
        // Skip invalid files
        continue;
      }
    }
  } catch {
    // Directory might not exist
  }
  
  return claudeLines;
}