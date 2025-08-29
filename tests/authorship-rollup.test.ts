import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execCommand } from './helpers/exec.ts';
import { rollupAuthorship, getFileStats, getOverallStats } from '../src/lib/authorship-rollup.ts';

let testDir: string;
let originalCwd: string;

describe('Authorship Rollup', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await mkdtemp(join(tmpdir(), 'claude-rollup-test-'));
    
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

  async function addGitNote(commitHash: string, noteText: string): Promise<void> {
    await execCommand('git', ['notes', '--ref', 'claude-was-here', 'add', '-m', noteText, commitHash], testDir);
  }

  async function getCurrentCommit(): Promise<string> {
    const result = await execCommand('git', ['rev-parse', 'HEAD'], testDir);
    return result.stdout.trim();
  }

  async function commitFile(filePath: string, content: string, message: string): Promise<string> {
    await writeFile(join(testDir, filePath), content);
    await execCommand('git', ['add', filePath], testDir);
    await execCommand('git', ['commit', '-m', message], testDir);
    return await getCurrentCommit();
  }

  test('handles single commit with AI authorship', async () => {
    // Create initial file with AI authorship
    const commitHash = await commitFile('test.js', 'line1\nline2\nline3', 'Initial commit');
    
    await addGitNote(commitHash, `claude-was-here
version: 1.1
test.js: 2-3`);
    
    const result = await rollupAuthorship();
    
    expect(result.totalCommitsProcessed).toBe(1);
    expect(result.files.size).toBe(1);
    
    const fileState = result.files.get('test.js');
    expect(fileState).toBeDefined();
    expect(fileState!.totalLines).toBe(3);
    expect(fileState!.authorshipMap.size).toBe(2); // lines 2 and 3
    
    const stats = getFileStats(fileState!);
    expect(stats.aiLines).toBe(2);
    expect(stats.humanLines).toBe(1);
    expect(stats.aiPercentage).toBeCloseTo(66.7, 1);
  });

  test('handles multiple commits with cumulative AI authorship', async () => {
    // Commit 1: Initial file
    const commit1 = await commitFile('test.js', 'line1\nline2', 'Commit 1');
    await addGitNote(commit1, `claude-was-here
version: 1.1
test.js: 2`);
    
    // Commit 2: Add more lines
    const commit2 = await commitFile('test.js', 'line1\nline2\nline3\nline4', 'Commit 2');
    await addGitNote(commit2, `claude-was-here
version: 1.1
test.js: 3-4`);
    
    const result = await rollupAuthorship();
    
    expect(result.totalCommitsProcessed).toBe(2);
    
    const fileState = result.files.get('test.js');
    expect(fileState).toBeDefined();
    expect(fileState!.totalLines).toBe(4);
    expect(fileState!.authorshipMap.size).toBe(3); // lines 2, 3, 4
    
    const stats = getFileStats(fileState!);
    expect(stats.aiLines).toBe(3);
    expect(stats.humanLines).toBe(1);
    expect(stats.aiPercentage).toBe(75);
  });

  test('handles file modifications that remove AI-authored lines', async () => {
    // Commit 1: Create file with AI authorship on lines 2-4
    const commit1 = await commitFile('test.js', 'line1\nline2\nline3\nline4\nline5', 'Initial');
    await addGitNote(commit1, `claude-was-here
version: 1.1
test.js: 2-4`);
    
    // Simulate human editing: remove some lines, keep file with only 3 lines
    await writeFile(join(testDir, 'test.js'), 'line1\nline2\nline5');
    
    const result = await rollupAuthorship();
    
    const fileState = result.files.get('test.js');
    expect(fileState).toBeDefined();
    expect(fileState!.totalLines).toBe(3);
    
    const stats = getFileStats(fileState!);
    // Note: Current implementation tracks by line numbers only, not content
    // Lines 2-3 are within the file bounds (original lines 2-4 -> lines 2-3 remain valid)
    expect(stats.aiLines).toBe(2); // Lines 2 and 3 are still marked as AI-authored
    expect(stats.humanLines).toBe(1);
    expect(stats.aiPercentage).toBeCloseTo(66.7, 1);
  });

  test('handles multiple files with different authorship patterns', async () => {
    // Create multiple files in one commit
    await writeFile(join(testDir, 'file1.js'), 'line1\nline2\nline3');
    await writeFile(join(testDir, 'file2.js'), 'lineA\nlineB\nlineC\nlineD');
    await execCommand('git', ['add', 'file1.js', 'file2.js'], testDir);
    await execCommand('git', ['commit', '-m', 'Multiple files'], testDir);
    
    const commit1 = await getCurrentCommit();
    await addGitNote(commit1, `claude-was-here
version: 1.1
file1.js: 1-2
file2.js: 2, 4`);
    
    const result = await rollupAuthorship();
    
    expect(result.files.size).toBe(2);
    
    // Check file1.js
    const file1State = result.files.get('file1.js');
    const file1Stats = getFileStats(file1State!);
    expect(file1Stats.aiLines).toBe(2);
    expect(file1Stats.humanLines).toBe(1);
    
    // Check file2.js  
    const file2State = result.files.get('file2.js');
    const file2Stats = getFileStats(file2State!);
    expect(file2Stats.aiLines).toBe(2);
    expect(file2Stats.humanLines).toBe(2);
    
    // Check overall stats
    const overallStats = getOverallStats(result);
    expect(overallStats.totalFiles).toBe(2);
    expect(overallStats.totalLines).toBe(7); // 3 + 4
    expect(overallStats.aiLines).toBe(4); // 2 + 2
    expect(overallStats.humanLines).toBe(3); // 1 + 2
  });

  test.todo('handles time filtering correctly');

  test('handles commits without notes gracefully', async () => {
    // Create commits with and without notes
    await commitFile('test.js', 'line1\nline2', 'Commit without note');
    
    const commitWithNote = await commitFile('test.js', 'line1\nline2\nline3', 'Commit with note');
    await addGitNote(commitWithNote, `claude-was-here
version: 1.1
test.js: 3`);
    
    await commitFile('test.js', 'line1\nline2\nline3\nline4', 'Another commit without note');
    
    const result = await rollupAuthorship();
    
    expect(result.totalCommitsProcessed).toBe(3);
    expect(result.files.size).toBe(1);
    
    const fileState = result.files.get('test.js');
    const stats = getFileStats(fileState!);
    expect(stats.aiLines).toBe(1); // Only line 3 from the middle commit
    expect(stats.totalLines).toBe(4);
  });

  test('handles deleted files correctly', async () => {
    // Create file with AI authorship
    const commit1 = await commitFile('temp.js', 'line1\nline2', 'Create temp file');
    await addGitNote(commit1, `claude-was-here
version: 1.1
temp.js: 1-2`);
    
    // Delete the file
    await execCommand('git', ['rm', 'temp.js'], testDir);
    await execCommand('git', ['commit', '-m', 'Delete temp file'], testDir);
    
    const result = await rollupAuthorship();
    
    // File should still be tracked but with 0 current lines
    const fileState = result.files.get('temp.js');
    expect(fileState).toBeDefined();
    expect(fileState!.totalLines).toBe(0);
    
    const stats = getFileStats(fileState!);
    expect(stats.aiLines).toBe(0); // No lines exist anymore
    expect(stats.totalLines).toBe(0);
  });

  test('handles overlapping line ranges correctly', async () => {
    // Create file
    const commit1 = await commitFile('test.js', 'line1\nline2\nline3\nline4', 'Initial');
    await addGitNote(commit1, `claude-was-here
version: 1.1
test.js: 2-3`);
    
    // Add overlapping authorship
    const commit2 = await commitFile('test.js', 'line1\nline2\nline3\nline4\nline5', 'Add line');
    await addGitNote(commit2, `claude-was-here
version: 1.1
test.js: 3-5`);
    
    const result = await rollupAuthorship();
    
    const fileState = result.files.get('test.js');
    const stats = getFileStats(fileState!);
    
    // Lines 2, 3, 4, 5 should be AI-authored (union of ranges)
    expect(stats.aiLines).toBe(4);
    expect(stats.humanLines).toBe(1);
    expect(stats.totalLines).toBe(5);
  });

  test('processes commits in chronological order', async () => {
    // This test ensures commits are processed in order, not just by hash
    
    // Create initial file
    await commitFile('test.js', 'line1', 'First');
    
    // Create second commit with different date
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 2);
    
    await writeFile(join(testDir, 'test.js'), 'line1\nline2');
    await execCommand('git', ['add', 'test.js'], testDir);
    await execCommand('git', ['commit', '-m', 'Second (past)', '--date', pastDate.toISOString()], testDir);
    const commit2 = await getCurrentCommit();
    
    // Create third commit (most recent)
    await commitFile('test.js', 'line1\nline2\nline3', 'Third (recent)');
    const commit3 = await getCurrentCommit();
    
    // Add notes in reverse chronological order to test ordering
    await addGitNote(commit3, `claude-was-here
version: 1.1
test.js: 3`);
    
    await addGitNote(commit2, `claude-was-here
version: 1.1
test.js: 2`);
    
    const result = await rollupAuthorship();
    
    // Should process commits chronologically, so both lines 2 and 3 are AI-authored
    const fileState = result.files.get('test.js');
    const stats = getFileStats(fileState!);
    expect(stats.aiLines).toBe(2);
    expect(stats.totalLines).toBe(3);
  });
});