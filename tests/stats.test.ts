import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execCommand } from './helpers/exec.ts';
import { WorkingTrackingData, FileChangeRecord } from '../src/types.ts';

let testDir: string;
let originalCwd: string;

describe('claude-was-here stats', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await mkdtemp(join(tmpdir(), 'claude-stats-test-'));
    
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

  async function runStats(options: string[] = []): Promise<{ stdout: string; stderr: string; code: number }> {
    return await execCommand('bun', ['run', join(originalCwd, 'src/cli.ts'), 'stats', ...options], testDir);
  }

  async function addGitNote(commitHash: string, noteText: string): Promise<void> {
    await execCommand('git', ['notes', 'add', '-m', noteText, commitHash], testDir);
  }

  async function getCurrentCommit(): Promise<string> {
    const result = await execCommand('git', ['rev-parse', 'HEAD'], testDir);
    return result.stdout.trim();
  }

  test('WILL calculate the stats data by parsing all git notes claude-was-here data', async () => {
    // Create test files with some content
    const file1 = join(testDir, 'test1.js');
    const file2 = join(testDir, 'test2.js');
    
    await writeFile(file1, 'line1\nline2\nline3\nline4');
    await writeFile(file2, 'console.log("hello");\nconsole.log("world");');
    
    await execCommand('git', ['add', file1, file2], testDir);
    await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
    
    const commitHash = await getCurrentCommit();
    
    // Add git notes with claude-was-here data
    const noteText = `claude-was-here
version: 1.1
test1.js: 2-3
test2.js: 1`;
    
    await addGitNote(commitHash, noteText);
    
    const result = await runStats();
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Claude Code Statistics');
    expect(result.stdout).toContain('Overall Repository Statistics');
    expect(result.stdout).toContain('AI-authored lines: 3/6');
    expect(result.stdout).toContain('test1.js: 2/4');
    expect(result.stdout).toContain('test2.js: 1/2');
  });

  test('Stats data should reflect the current state of the code (so if lines were removed, they should not be included in the stats)', async () => {
    // Create a file and commit it
    const testFile = join(testDir, 'test.js');
    await writeFile(testFile, 'line1\nline2\nline3\nline4\nline5');
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
    
    const commitHash = await getCurrentCommit();
    
    // Add git notes indicating lines 3-5 were AI-authored
    const noteText = `claude-was-here
version: 1.1
test.js: 3-5`;
    
    await addGitNote(commitHash, noteText);
    
    // Now modify the file to remove some lines (simulating human edits)
    await writeFile(testFile, 'line1\nline2\nline3');
    
    const result = await runStats();
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Claude Code Statistics');
    // Only line 3 should count as AI-authored now (lines 4-5 were removed)
    expect(result.stdout).toContain('AI-authored lines: 1/3');
    expect(result.stdout).toContain('test.js: 1/3');
  });

  test('WILL display overall authorship stats for the repo (human vs AI authored lines)', async () => {
    // Create multiple files with mixed authorship
    const file1 = join(testDir, 'human.js');
    const file2 = join(testDir, 'mixed.js');
    
    await writeFile(file1, 'function human() {\n  return "all human";\n}');
    await writeFile(file2, 'function mixed() {\n  return "ai line";\n  return "human line";\n}');
    
    await execCommand('git', ['add', file1, file2], testDir);
    await execCommand('git', ['commit', '-m', 'Mixed commit'], testDir);
    
    const commitHash = await getCurrentCommit();
    
    // Only mark one line as AI-authored in mixed.js
    const noteText = `claude-was-here
version: 1.1
mixed.js: 2`;
    
    await addGitNote(commitHash, noteText);
    
    const result = await runStats();
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Overall Repository Statistics');
    expect(result.stdout).toContain('AI-authored lines: 1/4'); // 1 AI line out of 4 total (only mixed.js is tracked)
    expect(result.stdout).toContain('25.0%'); // 1/4 = 25.0%
  });

  test('WILL display per file authorship state for the repo (human vs AI authored lines)', async () => {
    // Create files with different AI authorship percentages
    const highAiFile = join(testDir, 'high-ai.js');
    const lowAiFile = join(testDir, 'low-ai.js');
    const noAiFile = join(testDir, 'human-only.js');
    
    await writeFile(highAiFile, 'line1\nline2\nline3\nline4'); // 4 lines
    await writeFile(lowAiFile, 'line1\nline2\nline3\nline4\nline5'); // 5 lines  
    await writeFile(noAiFile, 'line1\nline2'); // 2 lines
    
    await execCommand('git', ['add', highAiFile, lowAiFile, noAiFile], testDir);
    await execCommand('git', ['commit', '-m', 'Mixed authorship'], testDir);
    
    const commitHash = await getCurrentCommit();
    
    // Mark different percentages of AI authorship
    const noteText = `claude-was-here
version: 1.1
high-ai.js: 1-3
low-ai.js: 5`;
    
    await addGitNote(commitHash, noteText);
    
    const result = await runStats();
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Per-File Statistics');
    expect(result.stdout).toContain('high-ai.js: 3/4 (75.0%)');
    expect(result.stdout).toContain('low-ai.js: 1/5 (20.0%)');
    // noAiFile should not appear in per-file stats since it has 0% AI
  });

  test('WILL allow filtering by time into the past (e.g. "1 week")', async () => {
    // Create a file with AI authorship
    const testFile = join(testDir, 'time-test.js');
    await writeFile(testFile, 'line1\nline2\nline3');
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Test commit'], testDir);
    
    const commitHash = await getCurrentCommit();
    await addGitNote(commitHash, `claude-was-here
version: 1.1
time-test.js: 1-2`);
    
    // Test with time filter (should work even if time filtering has issues)
    const result = await runStats(['--since', '1 week ago']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Claude Code Statistics (1 week ago)');
    expect(result.stdout).toContain('AI-authored lines: 2/3');
    
    // Test without time filter
    const allResult = await runStats();
    expect(allResult.code).toBe(0);
    expect(allResult.stdout).toContain('AI-authored lines: 2/3');
  });

  test('WILL show number of lines as AI/total', async () => {
    // Create files with clear AI/total ratios
    const testFile = join(testDir, 'ratio-test.js');
    await writeFile(testFile, '// line 1\n// line 2\n// line 3\n// line 4\n// line 5');
    
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Ratio test'], testDir);
    
    const commitHash = await getCurrentCommit();
    
    // Mark 2 out of 5 lines as AI-authored
    const noteText = `claude-was-here
version: 1.1
ratio-test.js: 2, 4`;
    
    await addGitNote(commitHash, noteText);
    
    const result = await runStats();
    
    expect(result.code).toBe(0);
    // Check overall ratio format
    expect(result.stdout).toContain('AI-authored lines: 2/5');
    // Check per-file ratio format
    expect(result.stdout).toContain('ratio-test.js: 2/5');
  });

  test('WILL show % of each file authored by AI', async () => {
    // Create files with specific percentages that are easy to verify
    const file25 = join(testDir, 'quarter.js'); // 25%
    const file50 = join(testDir, 'half.js'); // 50%
    const file100 = join(testDir, 'all.js'); // 100%
    
    await writeFile(file25, 'line1\nline2\nline3\nline4'); // 4 lines
    await writeFile(file50, 'line1\nline2'); // 2 lines
    await writeFile(file100, 'line1\nline2\nline3'); // 3 lines
    
    await execCommand('git', ['add', file25, file50, file100], testDir);
    await execCommand('git', ['commit', '-m', 'Percentage test'], testDir);
    
    const commitHash = await getCurrentCommit();
    
    const noteText = `claude-was-here
version: 1.1
quarter.js: 1
half.js: 1
all.js: 1-3`;
    
    await addGitNote(commitHash, noteText);
    
    const result = await runStats();
    
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('quarter.js: 1/4 (25.0%)');
    expect(result.stdout).toContain('half.js: 1/2 (50.0%)');
    expect(result.stdout).toContain('all.js: 3/3 (100.0%)');
    
    // Check overall percentage
    expect(result.stdout).toContain('(55.6%)'); // 5/9 = 55.6%
  });
});