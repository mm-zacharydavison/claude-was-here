import { writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { execCommand } from '../../helpers/exec.ts';

/**
 * Helper functions for testing human vs AI code authoring in E2E tests
 */

interface WriteAsHumanOptions {
  /** The working directory (git repository) */
  cwd: string;
  /** Path to the file relative to cwd */
  filePath: string;
  /** Content to write */
  content: string;
  /** Whether to append to existing content */
  append?: boolean;
}

interface WriteAsClaudeOptions extends WriteAsHumanOptions {
  /** Description of what Claude is being asked to do */
  task: string;
  /** Path to the claude-was-here CLI */
  cliPath: string;
}

/**
 * Write code as a human would - just writes the file without any Claude tracking
 */
export async function writeAsHuman(options: WriteAsHumanOptions): Promise<void> {
  const { cwd, filePath, content, append = false } = options;
  const fullPath = join(cwd, filePath);
  
  if (append && existsSync(fullPath)) {
    const existingContent = await readFile(fullPath, 'utf-8');
    await writeFile(fullPath, existingContent + content);
  } else {
    await writeFile(fullPath, content);
  }
  
  console.log(`👤 Human wrote to ${filePath} (${content.split('\\n').length} lines)`);
}

/**
 * Simulate Claude writing code by:
 * 1. Writing the file
 * 2. Triggering the track-changes command with proper hook data
 * 3. This creates the git notes that the real Claude Code would create
 */
export async function writeAsClaude(options: WriteAsClaudeOptions): Promise<void> {
  const { cwd, filePath, content, task, cliPath, append = false } = options;
  const fullPath = join(cwd, filePath);
  
  console.log(`🤖 Claude task: ${task}`);
  
  // Check if file exists for Edit vs Write tool simulation
  const fileExists = existsSync(fullPath);
  let oldContent = '';
  
  if (fileExists) {
    oldContent = await readFile(fullPath, 'utf-8');
  }
  
  // Write the new content
  const newContent = append && fileExists ? oldContent + content : content;
  await writeFile(fullPath, newContent);
  
  // Create hook data that matches what Claude Code would send
  const toolName = fileExists ? 'Edit' : 'Write';
  const hookData = {
    session_id: `e2e-test-session-${Date.now()}`,
    transcript_path: '/tmp/transcript.jsonl',
    cwd: cwd,
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: fileExists ? {
      file_path: filePath,
      old_string: oldContent,
      new_string: newContent
    } : {
      file_path: filePath,
      content: newContent
    },
    tool_response: {
      filePath: filePath,
      structuredPatch: createStructuredPatch(oldContent, newContent)
    }
  };
  
  // Write hook data to temp file and trigger track-changes
  const hookDataJson = JSON.stringify(hookData);
  const tempFile = join(cwd, `hook-data-${Date.now()}.json`);
  await writeFile(tempFile, hookDataJson);
  
  try {
    const result = await execCommand('sh', ['-c', `cat "${tempFile}" | bun "${cliPath}" track-changes`], cwd);
    if (result.code !== 0) {
      console.error(`⚠️  track-changes failed: ${result.stderr}`);
    } else {
      console.log(`✅ Claude completed: ${task} (tracked in claude-was-here)`);
    }
  } finally {
    // Clean up temp file
    await rm(tempFile).catch(() => {});
  }
}

/**
 * Create a mixed human+AI commit by having both human and Claude make changes
 */
export async function createMixedCommit(options: {
  cwd: string;
  cliPath: string;
  humanChanges: Array<{ filePath: string; content: string; description: string }>;
  claudeChanges: Array<{ filePath: string; content: string; task: string }>;
  commitMessage: string;
}): Promise<void> {
  const { cwd, cliPath, humanChanges, claudeChanges, commitMessage } = options;
  
  console.log(`🔄 Creating mixed human+AI commit: ${commitMessage}`);
  
  // Apply human changes first
  for (const change of humanChanges) {
    await writeAsHuman({
      cwd,
      filePath: change.filePath,
      content: change.content
    });
    console.log(`   👤 ${change.description}`);
  }
  
  // Apply Claude changes
  for (const change of claudeChanges) {
    await writeAsClaude({
      cwd,
      filePath: change.filePath,
      content: change.content,
      task: change.task,
      cliPath
    });
  }
  
  console.log(`📝 Ready to commit mixed authorship changes`);
}

/**
 * Helper to create structured patch data from old and new content
 */
function createStructuredPatch(oldContent: string, newContent: string) {
  const oldLines = oldContent.split('\\n');
  const newLines = newContent.split('\\n');
  
  // Simple patch generation - in reality this would be more sophisticated
  if (oldContent === '') {
    // New file
    return [{
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: newLines.length,
      lines: newLines.map(line => `+${line}`)
    }];
  } else {
    // File modification
    return [{
      oldStart: 1,
      oldLines: oldLines.length,
      newStart: 1,
      newLines: newLines.length,
      lines: [
        ...oldLines.map(line => `-${line}`),
        ...newLines.map(line => `+${line}`)
      ]
    }];
  }
}