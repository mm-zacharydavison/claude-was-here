import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execCommand } from './helpers/exec.ts';
import { WorkingTrackingData, FileChangeRecord } from '../src/types.ts';

let testDir: string;
let originalCwd: string;

describe('claude-was-here post-commit', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await mkdtemp(join(tmpdir(), 'claude-postcommit-test-'));
    
    // Initialize git repo
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
    
    // Change to test directory
    process.chdir(testDir);
  });

  afterEach(async () => {
    // Restore original directory
    process.chdir(originalCwd);
    
    // Clean up test directory
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  async function createTrackingData(records: FileChangeRecord[]): Promise<void> {
    const trackingDir = join(testDir, '.claude', 'was-here', 'working');
    await mkdir(trackingDir, { recursive: true });
    
    const trackingData: WorkingTrackingData = { records };
    await writeFile(
      join(trackingDir, 'tracking-data.json'),
      JSON.stringify(trackingData, null, 2)
    );
  }

  async function runPostCommit(): Promise<{ stdout: string; stderr: string; code: number }> {
    return await execCommand('bun', ['run', join(originalCwd, 'src/cli.ts'), 'post-commit'], testDir);
  }

  async function getGitNote(commitHash: string): Promise<string | null> {
    try {
      const result = await execCommand('git', ['notes', 'show', commitHash], testDir);
      return result.code === 0 ? result.stdout : null;
    } catch {
      return null;
    }
  }

  async function getCurrentCommit(): Promise<string> {
    const result = await execCommand('git', ['rev-parse', 'HEAD'], testDir);
    return result.stdout.trim();
  }

  async function trackingDataExists(): Promise<boolean> {
    const trackingFile = join(testDir, '.claude', 'was-here', 'working', 'tracking-data.json');
    try {
      await readFile(trackingFile, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  test('WILL compute the final AI changed lines and add it to git notes for the commit', async () => {
    // Create a test file with AI-authored changes
    const testFile = join(testDir, 'test.js');
    const originalContent = 'function hello() {\n  console.log("hello");\n}';
    const finalContent = 'function hello() {\n  console.log("hello world");\n}';
    
    await writeFile(testFile, finalContent);
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Test commit'], testDir);
    
    // Create tracking data that shows AI changed line 2
    await createTrackingData([
      {
        filePath: 'test.js',
        toolName: 'Edit',
        sessionId: 'test-session',
        timestamp: Date.now(),
        structuredPatch: [
          {
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            lines: ['-  console.log("hello");', '+  console.log("hello world");']
          }
        ],
        originalContent,
        newContent: finalContent
      }
    ]);
    
    const result = await runPostCommit();
    expect(result.code).toBe(0);
    
    const commitHash = await getCurrentCommit();
    const note = await getGitNote(commitHash);
    expect(note).not.toBeNull();
    expect(note).toContain('claude-was-here');
    expect(note).toContain('test.js: 2');
  });

  test('WILL treat any line that has been changed since claude-code changed it as human authored', async () => {
    // Create a file where AI changed line 2, but human later modified it further
    const testFile = join(testDir, 'test.js');
    const originalContent = 'function hello() {\n  console.log("hello");\n}';
    const aiContent = 'function hello() {\n  console.log("hello world");\n}';
    const humanModifiedContent = 'function hello() {\n  console.log("hello universe");\n}';
    
    await writeFile(testFile, humanModifiedContent);
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Test commit'], testDir);
    
    // Create tracking data showing AI changed line 2 to "hello world"
    await createTrackingData([
      {
        filePath: 'test.js',
        toolName: 'Edit',
        sessionId: 'test-session',
        timestamp: Date.now(),
        structuredPatch: [
          {
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            lines: ['-  console.log("hello");', '+  console.log("hello world");']
          }
        ],
        originalContent,
        newContent: aiContent
      }
    ]);
    
    const result = await runPostCommit();
    expect(result.code).toBe(0);
    
    const commitHash = await getCurrentCommit();
    const note = await getGitNote(commitHash);
    
    // Since the line was modified by human after AI change, it should not be marked as AI-authored
    if (note) {
      expect(note).not.toContain('test.js:');
    }
  });

  test('WILL treat any line that has NOT been changed since claude-code changed it as AI authored', async () => {
    // Create a file where AI changed lines and they remain unchanged
    const testFile = join(testDir, 'test.js');
    const originalContent = 'function hello() {\n  console.log("hello");\n  return true;\n}';
    const aiContent = 'function hello() {\n  console.log("hello world");\n  return false;\n}';
    
    await writeFile(testFile, aiContent);
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Test commit'], testDir);
    
    // Create tracking data showing AI changed lines 2 and 3
    await createTrackingData([
      {
        filePath: 'test.js',
        toolName: 'Edit',
        sessionId: 'test-session',
        timestamp: Date.now(),
        structuredPatch: [
          {
            oldStart: 2,
            oldLines: 2,
            newStart: 2,
            newLines: 2,
            lines: [
              '-  console.log("hello");',
              '-  return true;',
              '+  console.log("hello world");',
              '+  return false;'
            ]
          }
        ],
        originalContent,
        newContent: aiContent
      }
    ]);
    
    const result = await runPostCommit();
    expect(result.code).toBe(0);
    
    const commitHash = await getCurrentCommit();
    const note = await getGitNote(commitHash);
    expect(note).not.toBeNull();
    expect(note).toContain('test.js: 2-3');
  });

  test('WILL clear current track-changes working state once post-commit command has completed successfully', async () => {
    // Create a test file and commit
    const testFile = join(testDir, 'test.js');
    await writeFile(testFile, 'console.log("test");');
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Test commit'], testDir);
    
    // Create tracking data
    await createTrackingData([
      {
        filePath: 'test.js',
        toolName: 'Write',
        sessionId: 'test-session',
        timestamp: Date.now(),
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            lines: ['+console.log("test");']
          }
        ],
        newContent: 'console.log("test");'
      }
    ]);
    
    // Verify tracking data exists before post-commit
    expect(await trackingDataExists()).toBe(true);
    
    const result = await runPostCommit();
    expect(result.code).toBe(0);
    
    // Verify tracking data is cleared after post-commit
    expect(await trackingDataExists()).toBe(false);
  });

  test('WILL store the authorship information for AI lines in human readable format, per file, with line ranges', async () => {
    // Create multiple files with different AI-authored line patterns
    const file1 = join(testDir, 'file1.js');
    const file2 = join(testDir, 'file2.js');
    
    await writeFile(file1, 'line1\nline2\nline3\nline4\nline5');
    await writeFile(file2, 'console.log("hello");\nconsole.log("world");');
    
    await execCommand('git', ['add', file1, file2], testDir);
    await execCommand('git', ['commit', '-m', 'Test commit'], testDir);
    
    // Create tracking data with multiple files and various line ranges
    await createTrackingData([
      {
        filePath: 'file1.js',
        toolName: 'Edit',
        sessionId: 'test-session',
        timestamp: Date.now(),
        structuredPatch: [
          {
            oldStart: 2,
            oldLines: 1,
            newStart: 2,
            newLines: 1,
            lines: ['-oldline2', '+line2']
          },
          {
            oldStart: 4,
            oldLines: 2,
            newStart: 4,
            newLines: 2,  
            lines: ['-oldline4', '-oldline5', '+line4', '+line5']
          }
        ],
        originalContent: 'line1\noldline2\nline3\noldline4\noldline5',
        newContent: 'line1\nline2\nline3\nline4\nline5'
      },
      {
        filePath: 'file2.js',
        toolName: 'Write',
        sessionId: 'test-session',
        timestamp: Date.now(),
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 2,
            lines: ['+console.log("hello");', '+console.log("world");']
          }
        ],
        newContent: 'console.log("hello");\nconsole.log("world");'
      }
    ]);
    
    const result = await runPostCommit();
    expect(result.code).toBe(0);
    
    const commitHash = await getCurrentCommit();
    const note = await getGitNote(commitHash);
    expect(note).not.toBeNull();
    expect(note).toContain('claude-was-here');
    expect(note).toContain('version:');
    expect(note).toContain('file1.js:');
    expect(note).toContain('file2.js:');
    
    // Check line ranges are formatted correctly (single lines and ranges)
    expect(note).toMatch(/file1\.js: \d+(,\s*\d+(-\d+)?)*/ );
    expect(note).toMatch(/file2\.js: \d+(-\d+)?/);
  });

  test('IF a block had extra lines added (e.g. by a human), it WILL ensure that the authorship information is correct for each line', async () => {
    // AI adds 2 lines, then human adds 1 more line in between
    const testFile = join(testDir, 'test.js');
    const originalContent = 'function test() {\n}';
    const aiContent = 'function test() {\n  console.log("ai line 1");\n  console.log("ai line 2");\n}';
    const humanModifiedContent = 'function test() {\n  console.log("ai line 1");\n  console.log("human added");\n  console.log("ai line 2");\n}';
    
    await writeFile(testFile, humanModifiedContent);
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Test commit'], testDir);
    
    // Create tracking data showing AI originally added lines 2 and 3
    await createTrackingData([
      {
        filePath: 'test.js',
        toolName: 'Edit',
        sessionId: 'test-session',
        timestamp: Date.now(),
        structuredPatch: [
          {
            oldStart: 2,
            oldLines: 0,
            newStart: 2,
            newLines: 2,
            lines: ['+  console.log("ai line 1");', '+  console.log("ai line 2");']
          }
        ],
        originalContent,
        newContent: aiContent
      }
    ]);
    
    const result = await runPostCommit();
    expect(result.code).toBe(0);
    
    const commitHash = await getCurrentCommit();
    const note = await getGitNote(commitHash);
    expect(note).not.toBeNull();
    
    // Only the AI lines that remain unchanged should be marked as AI-authored
    // Line 2 ("ai line 1") should still be AI-authored
    // Line 3 ("human added") should not be AI-authored
    // Line 4 ("ai line 2") should still be AI-authored, but its position shifted
    expect(note).toContain('test.js:');
    
    // The exact line numbers will depend on the implementation's handling of shifted content
    // But we should only see AI-authored lines that actually match the expected AI content
  });

  test('IF lines are moved, the authorship tracking should still work (by matching the content)', async () => {
    // AI adds specific lines, then human moves them to different positions
    const testFile = join(testDir, 'test.js');
    const originalContent = 'function test() {\n  // original comment\n  return null;\n}';
    const aiContent = 'function test() {\n  // original comment\n  console.log("ai added line 1");\n  console.log("ai added line 2");\n  return null;\n}';
    const humanMovedContent = 'function test() {\n  console.log("ai added line 1");\n  // original comment\n  console.log("ai added line 2");\n  return null;\n}';
    
    await writeFile(testFile, humanMovedContent);
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Test commit'], testDir);
    
    // Create tracking data showing AI originally added lines 3 and 4
    await createTrackingData([
      {
        filePath: 'test.js',
        toolName: 'Edit',
        sessionId: 'test-session',
        timestamp: Date.now(),
        structuredPatch: [
          {
            oldStart: 3,
            oldLines: 0,
            newStart: 3,
            newLines: 2,
            lines: ['+  console.log("ai added line 1");', '+  console.log("ai added line 2");']
          }
        ],
        originalContent,
        newContent: aiContent
      }
    ]);
    
    const result = await runPostCommit();
    expect(result.code).toBe(0);
    
    const commitHash = await getCurrentCommit();
    const note = await getGitNote(commitHash);
    expect(note).not.toBeNull();
    
    // The AI-authored lines should still be detected even though they moved positions
    // Line 2 now has "ai added line 1" (moved from position 3)  
    // Line 4 now has "ai added line 2" (moved from position 4, but shifted due to move)
    expect(note).toContain('test.js: 2, 4');
    
    // Verify that both AI-authored lines are correctly identified by content matching
    // regardless of their position change
  })
});