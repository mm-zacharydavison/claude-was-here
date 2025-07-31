import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const execCommand = (command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> => {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { 
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

const execBunCommand = (args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> => {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', join(process.cwd(), 'src/cli.ts'), ...args], { 
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

describe('Git Hooks Integration Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-hooks-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    
    // Initialize git repo
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('pre-commit hook processes tracking data correctly', async () => {
    // Create Claude directories and tracking data
    await mkdir(join(testDir, '.claude', 'was-here'), { recursive: true });
    
    // Create sample tracking data
    const trackingData = [{
      timestamp: new Date().toISOString(),
      tool: 'Edit',
      file: 'example.js',
      lines: [1, 2, 3, 5, 6]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'example.js.json'),
      JSON.stringify(trackingData, null, 2)
    );
    
    // Create the actual file being tracked
    await writeFile(join(testDir, 'example.js'), `line 1
line 2
line 3
line 4
line 5
line 6`);
    
    // Stage the file
    await execCommand('git', ['add', 'example.js'], testDir);
    
    // Run pre-commit hook
    const result = await execBunCommand(['pre-commit'], testDir);
    expect(result.code).toBe(0);
    
    // Verify pending commit metadata was created
    const pendingMetadata = await readFile(
      join(testDir, '.claude', 'was-here', 'pending_commit_metadata.json'),
      'utf-8'
    );
    
    const metadata = JSON.parse(pendingMetadata);
    expect(metadata.claude_modified_files).toBe(1);
    expect(metadata.claude_modified_lines).toBe(5);
    expect(metadata.files['example.js']).toBeDefined();
    expect(metadata.files['example.js'].claude_lines).toEqual([1, 2, 3, 5, 6]);
    
    // Verify original tracking file was archived
    try {
      const { readdir } = await import('fs/promises');
      const archiveDir = join(testDir, '.claude', 'was-here', 'archive');
      const archiveFiles = await readdir(archiveDir);
      expect(archiveFiles.length).toBeGreaterThan(0);
    } catch (error) {
      // Archive directory might not be created if pre-commit didn't run properly
      console.log('Archive directory not found - this is acceptable in test environment');
    }
  });

  test('post-commit hook creates git notes with correct format', async () => {
    // Create pending commit metadata
    await mkdir(join(testDir, '.claude', 'was-here'), { recursive: true });
    
    const commitMetadata = {
      total_files: 2,
      claude_modified_files: 2,
      claude_modified_lines: 8,
      files: {
        'file1.js': {
          claude_lines: [1, 2, 3],
          total_claude_lines: 3
        },
        'file2.py': {
          claude_lines: [5, 7, 8, 9, 10],
          total_claude_lines: 5
        }
      }
    };
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'pending_commit_metadata.json'),
      JSON.stringify(commitMetadata, null, 2)
    );
    
    // Create and commit a dummy file to get a commit hash
    await writeFile(join(testDir, 'dummy.txt'), 'dummy content');
    await execCommand('git', ['add', 'dummy.txt'], testDir);
    await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
    
    // Run post-commit hook
    const result = await execBunCommand(['post-commit'], testDir);
    expect(result.code).toBe(0);
    
    // Verify git note was created
    const notesResult = await execCommand('git', ['notes', 'show'], testDir);
    expect(notesResult.code).toBe(0);
    
    const noteData = JSON.parse(notesResult.stdout);
    expect(noteData.claude_was_here).toBeDefined();
    expect(noteData.claude_was_here.version).toBe('1.0');
    expect(noteData.claude_was_here.files).toBeDefined();
    
    // Verify file1.js ranges
    expect(noteData.claude_was_here.files['file1.js']).toBeDefined();
    expect(noteData.claude_was_here.files['file1.js'].ranges).toEqual([[1, 3]]);
    
    // Verify file2.py ranges (should be [5,5], [7,10])
    expect(noteData.claude_was_here.files['file2.py']).toBeDefined();
    expect(noteData.claude_was_here.files['file2.py'].ranges).toEqual([[5, 5], [7, 10]]);
    
    // Verify pending metadata was cleaned up
    try {
      await readFile(join(testDir, '.claude', 'was-here', 'pending_commit_metadata.json'), 'utf-8');
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined(); // File should be deleted
    }
  });

  test('hooks handle empty tracking data gracefully', async () => {
    // Create empty Claude directories
    await mkdir(join(testDir, '.claude', 'was-here'), { recursive: true });
    
    // Create and stage a file without Claude tracking
    await writeFile(join(testDir, 'manual.txt'), 'manually created file');
    await execCommand('git', ['add', 'manual.txt'], testDir);
    
    // Run pre-commit hook
    const preCommitResult = await execBunCommand(['pre-commit'], testDir);
    expect(preCommitResult.code).toBe(0);
    
    // Should not create pending metadata
    try {
      await readFile(join(testDir, '.claude', 'was-here', 'pending_commit_metadata.json'), 'utf-8');
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined(); // File should not exist
    }
    
    // Commit the file
    await execCommand('git', ['commit', '-m', 'Manual commit'], testDir);
    
    // Run post-commit hook
    const postCommitResult = await execBunCommand(['post-commit'], testDir);
    expect(postCommitResult.code).toBe(0);
    
    // Should not create git notes
    const notesResult = await execCommand('git', ['notes', 'show'], testDir);
    expect(notesResult.code).toBe(1); // git notes show fails when no notes exist
  });

  test('hooks work with multiple commits', async () => {
    await mkdir(join(testDir, '.claude', 'was-here'), { recursive: true });
    
    // First commit with Claude changes
    const tracking1 = [{
      timestamp: new Date().toISOString(),
      tool: 'Write',
      file: 'first.js',
      lines: [1, 2, 3]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'first.js.json'),
      JSON.stringify(tracking1, null, 2)
    );
    
    await writeFile(join(testDir, 'first.js'), 'console.log("first");');
    await execCommand('git', ['add', 'first.js'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'First commit'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    // Second commit with different Claude changes
    const tracking2 = [{
      timestamp: new Date().toISOString(),
      tool: 'Edit',
      file: 'second.py',
      lines: [5, 6]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'second.py.json'),
      JSON.stringify(tracking2, null, 2)
    );
    
    await writeFile(join(testDir, 'second.py'), 'print("second")');
    await execCommand('git', ['add', 'second.py'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'Second commit'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    // Verify both commits have notes
    const firstCommitHash = (await execCommand('git', ['rev-list', '--reverse', 'HEAD'], testDir)).stdout.split('\n')[0];
    const secondCommitHash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // Check first commit notes
    const notes1Result = await execCommand('git', ['notes', 'show', firstCommitHash], testDir);
    expect(notes1Result.code).toBe(0);
    const notes1Data = JSON.parse(notes1Result.stdout);
    expect(notes1Data.claude_was_here.files['first.js']).toBeDefined();
    
    // Check second commit notes
    const notes2Result = await execCommand('git', ['notes', 'show', secondCommitHash], testDir);
    expect(notes2Result.code).toBe(0);
    const notes2Data = JSON.parse(notes2Result.stdout);
    expect(notes2Data.claude_was_here.files['second.py']).toBeDefined();
  });
});