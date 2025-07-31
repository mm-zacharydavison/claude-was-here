import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { gitNoteDataToTsv } from './helpers/tsv.ts';

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

describe('Stats Command Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `stats-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    
    // Initialize git repo
    await execGitCommand(['init'], testDir);
    await execGitCommand(['config', 'user.name', 'Test User'], testDir);
    await execGitCommand(['config', 'user.email', 'test@example.com'], testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('stats command shows no commits message when no commits exist', async () => {
    const result = await execBunCommand(['stats'], testDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No commits found in the specified time period');
  });

  test('stats command shows correct percentage for Claude-authored files', async () => {
    // Create a file
    await writeFile(join(testDir, 'sample.js'), `console.log("line 1");
console.log("line 2");
console.log("line 3");
console.log("line 4");
console.log("line 5");`);
    
    await execGitCommand(['add', 'sample.js'], testDir);
    await execGitCommand(['commit', '-m', 'Initial commit'], testDir);
    
    // Add git note with Claude metadata
    const noteData = {
      claude_was_here: {
        version: "1.0",
        files: {
          "sample.js": {
            ranges: [[1, 2], [4, 4]]  // Lines 1-2 and line 4 are Claude-authored
          }
        }
      }
    };
    
    await execGitCommand(['notes', 'add', '-m', gitNoteDataToTsv(noteData)], testDir);
    
    // Run stats command
    const result = await execBunCommand(['stats'], testDir);
    expect(result.code).toBe(0);
    
    // Should show 3 out of 5 lines (60%)
    expect(result.stdout).toContain('Claude-authored lines: 3');
    expect(result.stdout).toContain('Total lines: 5');
    expect(result.stdout).toContain('Percentage: 60%');
  });

  test('stats command respects --since parameter', async () => {
    // First set a specific commit date for the old commit using environment variable
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30); // 30 days ago
    
    // Create a file and commit it with old date
    await writeFile(join(testDir, 'old.js'), 'console.log("old");');
    await execGitCommand(['add', 'old.js'], testDir);
    
    // Use GIT_COMMITTER_DATE to set the commit date
    const proc = spawn('git', ['commit', '-m', 'Old commit'], { 
      cwd: testDir,
      env: { 
        ...process.env,
        GIT_COMMITTER_DATE: oldDate.toISOString(),
        GIT_AUTHOR_DATE: oldDate.toISOString()
      },
      stdio: 'ignore'
    });
    await new Promise((resolve) => proc.on('close', resolve));
    
    // Add Claude metadata to old commit
    const oldCommit = (await execGitCommand(['rev-parse', 'HEAD'], testDir)).stdout;
    const oldNoteData = {
      claude_was_here: {
        version: "1.0",
        files: {
          "old.js": {
            ranges: [[1, 1]]
          }
        }
      }
    };
    await execGitCommand(['notes', 'add', '-m', gitNoteDataToTsv(oldNoteData), oldCommit], testDir);
    
    // Create another file and commit it recently
    await writeFile(join(testDir, 'new.js'), 'console.log("new");');
    await execGitCommand(['add', 'new.js'], testDir);
    await execGitCommand(['commit', '-m', 'New commit'], testDir);
    
    // Add Claude metadata to new commit
    const newCommit = (await execGitCommand(['rev-parse', 'HEAD'], testDir)).stdout;
    const newNoteData = {
      claude_was_here: {
        version: "1.0",
        files: {
          "new.js": {
            ranges: [[1, 1]]
          }
        }
      }
    };
    await execGitCommand(['notes', 'add', '-m', gitNoteDataToTsv(newNoteData), newCommit], testDir);
    
    // Run stats with --since="1 week"
    const result = await execBunCommand(['stats', '--since=1 week'], testDir);
    expect(result.code).toBe(0);
    
    // Should only show stats for new.js, not old.js
    expect(result.stdout).toContain('new.js');
    expect(result.stdout).not.toContain('old.js');
    expect(result.stdout).toContain('Analyzing 1 commits');
  });

  test('stats command handles multiple files and commits', async () => {
    // First commit with two files
    await writeFile(join(testDir, 'file1.js'), `line1
line2
line3`);
    await writeFile(join(testDir, 'file2.js'), `lineA
lineB`);
    
    await execGitCommand(['add', '.'], testDir);
    await execGitCommand(['commit', '-m', 'First commit'], testDir);
    
    const commit1 = (await execGitCommand(['rev-parse', 'HEAD'], testDir)).stdout;
    const note1 = {
      claude_was_here: {
        version: "1.0",
        files: {
          "file1.js": {
            ranges: [[1, 2]]  // Lines 1-2
          },
          "file2.js": {
            ranges: [[1, 1]]  // Line 1
          }
        }
      }
    };
    await execGitCommand(['notes', 'add', '-m', gitNoteDataToTsv(note1), commit1], testDir);
    
    // Second commit modifying file1
    await writeFile(join(testDir, 'file1.js'), `line1
line2
line3
line4
line5`);
    
    await execGitCommand(['add', 'file1.js'], testDir);
    await execGitCommand(['commit', '-m', 'Second commit'], testDir);
    
    const commit2 = (await execGitCommand(['rev-parse', 'HEAD'], testDir)).stdout;
    const note2 = {
      claude_was_here: {
        version: "1.0",
        files: {
          "file1.js": {
            ranges: [[4, 5]]  // Lines 4-5
          }
        }
      }
    };
    await execGitCommand(['notes', 'add', '-m', gitNoteDataToTsv(note2), commit2], testDir);
    
    // Run stats
    const result = await execBunCommand(['stats'], testDir);
    expect(result.code).toBe(0);
    
    // Should show combined stats
    expect(result.stdout).toContain('Analyzing 2 commits');
    expect(result.stdout).toContain('file1.js: 4/5 lines (80%)');  // Lines 1-2, 4-5 out of 5
    expect(result.stdout).toContain('file2.js: 1/2 lines (50%)');  // Line 1 out of 2
  });

  test('stats command handles files that no longer exist', async () => {
    // Create and commit a file
    await writeFile(join(testDir, 'deleted.js'), 'console.log("will be deleted");');
    await execGitCommand(['add', 'deleted.js'], testDir);
    await execGitCommand(['commit', '-m', 'Add file'], testDir);
    
    // Add Claude metadata
    const commit = (await execGitCommand(['rev-parse', 'HEAD'], testDir)).stdout;
    const noteData = {
      claude_was_here: {
        version: "1.0",
        files: {
          "deleted.js": {
            ranges: [[1, 1]]
          }
        }
      }
    };
    await execGitCommand(['notes', 'add', '-m', gitNoteDataToTsv(noteData), commit], testDir);
    
    // Delete the file and commit
    await execGitCommand(['rm', 'deleted.js'], testDir);
    await execGitCommand(['commit', '-m', 'Delete file'], testDir);
    
    // Run stats
    const result = await execBunCommand(['stats'], testDir);
    expect(result.code).toBe(0);
    
    // Should handle deleted file gracefully
    expect(result.stdout).toContain('deleted.js: 1/1 lines (100%)');
  });

  test('stats command with various --since formats', async () => {
    // Create a file
    await writeFile(join(testDir, 'test.js'), 'console.log("test");');
    await execGitCommand(['add', 'test.js'], testDir);
    await execGitCommand(['commit', '-m', 'Test commit'], testDir);
    
    // Test various time formats
    const timeFormats = ['1 day', '2 weeks', '1 month', '6 months', '1 year'];
    
    for (const format of timeFormats) {
      const result = await execBunCommand(['stats', `--since=${format}`], testDir);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`Since: ${format}`);
    }
  });
});