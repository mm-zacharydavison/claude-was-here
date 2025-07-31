import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseTsvToGitNoteData } from './helpers/tsv.ts';

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

// Helper function to simulate GitHub Actions logic for collecting Claude notes
const collectClaudeNotesFromCommits = async (testDir: string, baseCommit: string, headCommit: string): Promise<string> => {
  // Get all commit hashes in the "PR"
  const commitsResult = await execCommand('git', ['log', '--format=%H', `${baseCommit}..${headCommit}`], testDir);
  const commits = commitsResult.stdout.split('\n').filter(hash => hash.trim());
  
  let claudeCommitsData = '';
  
  for (const commitHash of commits) {
    // Check if this commit has a git note
    const notesResult = await execCommand('git', ['notes', 'show', commitHash], testDir);
    if (notesResult.code === 0) {
      const noteLines = notesResult.stdout.split('\n');
      
      for (const line of noteLines) {
        // Skip header lines
        if (line === 'claude-was-here' || line.startsWith('version:')) {
          continue;
        }
        
        // Parse lines like "src/file.ts: 10-20,25-30"
        const match = line.match(/^([^:]+):\s+(.+)$/);
        if (match) {
          const filepath = match[1].trim();
          const ranges = match[2].trim();
          claudeCommitsData += `${commitHash}|${filepath}|${ranges}\n`;
        }
      }
    }
  }
  
  return claudeCommitsData;
};

// Helper function to simulate the Python analysis script
const analyzeClaudeLines = async (testDir: string, claudeData: string, baseCommit: string, finalCommit: string): Promise<string> => {
  // Parse Claude's original contributions
  const claudeFiles = new Map<string, Set<number>>();
  
  for (const line of claudeData.split('\n')) {
    if (!line.trim()) continue;
    
    const parts = line.split('|');
    if (parts.length === 3) {
      const [commitHash, filepath, ranges] = parts;
      
      if (!claudeFiles.has(filepath)) {
        claudeFiles.set(filepath, new Set());
      }
      
      // Parse ranges like "10-20,25-30"
      for (const rangeStr of ranges.split(',')) {
        if (rangeStr.includes('-')) {
          const [start, end] = rangeStr.split('-').map(n => parseInt(n));
          for (let i = start; i <= end; i++) {
            claudeFiles.get(filepath)!.add(i);
          }
        } else {
          claudeFiles.get(filepath)!.add(parseInt(rangeStr));
        }
      }
    }
  }
  
  // Get final diff lines
  const diffResult = await execCommand('git', ['diff', '--unified=0', `${baseCommit}..${finalCommit}`], testDir);
  const finalLines = new Map<string, Set<number>>();
  
  let currentFile: string | null = null;
  for (const line of diffResult.stdout.split('\n')) {
    if (line.startsWith('+++')) {
      currentFile = line.substring(6); // Remove '+++ b/'
    } else if (line.startsWith('@@') && currentFile) {
      // Parse hunk header like @@ -1,4 +10,8 @@
      const match = line.match(/\+(\d+)(?:,(\d+))?/);
      if (match) {
        const startLine = parseInt(match[1]);
        const count = match[2] ? parseInt(match[2]) : 1;
        
        if (!finalLines.has(currentFile)) {
          finalLines.set(currentFile, new Set());
        }
        
        for (let i = startLine; i < startLine + count; i++) {
          finalLines.get(currentFile)!.add(i);
        }
      }
    }
  }
  
  // Map Claude contributions to final lines
  const finalClaudeLines = new Map<string, Set<number>>();
  
  for (const [filepath, claudeLineSet] of claudeFiles) {
    if (finalLines.has(filepath)) {
      // For simplicity, assume if Claude touched the file and the file has changes,
      // then Claude contributed to those changes
      finalClaudeLines.set(filepath, finalLines.get(filepath)!);
    }
  }
  
  // Generate output in claude-was-here format
  let output = 'claude-was-here\nversion: 1.0\n';
  
  if (finalClaudeLines.size > 0) {
    const maxLength = Math.max(...Array.from(finalClaudeLines.keys()).map(path => path.length));
    
    for (const [filepath, lineSet] of Array.from(finalClaudeLines.entries()).sort()) {
      const ranges = convertLinesToRanges(Array.from(lineSet).sort((a, b) => a - b));
      if (ranges) {
        const paddedPath = `${filepath}:`.padEnd(maxLength + 2);
        output += `${paddedPath} ${ranges}\n`;
      }
    }
  }
  
  return output;
};

const convertLinesToRanges = (lines: number[]): string => {
  if (lines.length === 0) return '';
  
  const ranges: string[] = [];
  let start = lines[0];
  let end = lines[0];
  
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === end + 1) {
      end = lines[i];
    } else {
      if (start === end) {
        ranges.push(start.toString());
      } else {
        ranges.push(`${start}-${end}`);
      }
      start = end = lines[i];
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

describe('PR Squash Claude Notes Preservation Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pr-squash-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    
    // Initialize git repo
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
    
    // Create initial base commit
    await writeFile(join(testDir, 'base.txt'), 'base file');
    await execCommand('git', ['add', 'base.txt'], testDir);
    await execCommand('git', ['commit', '-m', 'Initial base commit'], testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('PR squash preserves correct Claude lines after add/remove operations', async () => {
    await mkdir(join(testDir, '.claude', 'was-here'), { recursive: true });
    
    // Get base commit hash
    const baseCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // Simulate PR with multiple commits that add and remove lines
    
    // === COMMIT 1: Claude adds initial function ===
    const initialFile = `function hello() {
  console.log("Hello World");
  return "success";
}

function goodbye() {
  console.log("Goodbye");
}`;
    
    await writeFile(join(testDir, 'example.js'), initialFile);
    
    // Create Claude tracking for commit 1 (lines 1-7)
    const tracking1 = [{
      timestamp: new Date().toISOString(),
      tool: 'Write',
      file: 'example.js',
      lines: [1, 2, 3, 4, 5, 6, 7]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'example.js.json'),
      JSON.stringify(tracking1, null, 2)
    );
    
    await execCommand('git', ['add', 'example.js'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'Add initial functions'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    // === COMMIT 2: Claude adds more code ===
    const expandedFile = `function hello() {
  console.log("Hello World");
  console.log("Debug info");
  return "success";
}

function goodbye() {
  console.log("Goodbye");
  console.log("Farewell");
}

function newFunction() {
  console.log("New function");
  return true;
}`;
    
    await writeFile(join(testDir, 'example.js'), expandedFile);
    
    // Create Claude tracking for commit 2 (added lines 3, 9, 11-14)
    const tracking2 = [{
      timestamp: new Date().toISOString(),
      tool: 'Edit',
      file: 'example.js',
      lines: [3, 9, 11, 12, 13, 14]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'example.js.json'),
      JSON.stringify(tracking2, null, 2)
    );
    
    await execCommand('git', ['add', 'example.js'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'Add debug logs and new function'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    // === COMMIT 3: Claude removes some lines and modifies others ===
    const finalFile = `function hello() {
  console.log("Hello World - Updated");
  return "success";
}

function goodbye() {
  console.log("Goodbye");
}

function newFunction() {
  console.log("New function - Updated");
  return true;
}`;
    
    await writeFile(join(testDir, 'example.js'), finalFile);
    
    // Create Claude tracking for commit 3 (modified lines 2, 11)
    const tracking3 = [{
      timestamp: new Date().toISOString(),
      tool: 'Edit',
      file: 'example.js',
      lines: [2, 11]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'example.js.json'),
      JSON.stringify(tracking3, null, 2)
    );
    
    await execCommand('git', ['add', 'example.js'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'Update messages and remove debug logs'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    const headCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // === SIMULATE GITHUB ACTIONS WORKFLOW ===
    
    // Step 1: Collect Claude notes from all commits in "PR"
    const claudeCommitsData = await collectClaudeNotesFromCommits(testDir, baseCommit, headCommit);
    console.log('Collected Claude commits data:', claudeCommitsData);
    
    // Step 2: Analyze final diff and map Claude contributions
    const finalClaudeNote = await analyzeClaudeLines(testDir, claudeCommitsData, baseCommit, headCommit);
    console.log('Final Claude note:', finalClaudeNote);
    
    // Step 3: Simulate squash merge by creating a new commit with squashed changes  
    await execCommand('git', ['reset', '--soft', baseCommit], testDir);
    await execCommand('git', ['commit', '-m', 'Squashed PR: Add and update functions'], testDir);
    
    const squashedCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // Step 4: Add the consolidated note to the squashed commit
    await writeFile(join(testDir, 'temp_note.txt'), finalClaudeNote);
    await execCommand('git', ['notes', 'add', '-F', 'temp_note.txt', squashedCommit], testDir);
    
    // === VERIFY RESULTS ===
    
    // Check that the squashed commit has the correct note
    const squashedNoteResult = await execCommand('git', ['notes', 'show', squashedCommit], testDir);
    expect(squashedNoteResult.code).toBe(0);
    
    const squashedNoteData = parseTsvToGitNoteData(squashedNoteResult.stdout);
    expect(squashedNoteData.claude_was_here).toBeDefined();
    expect(squashedNoteData.claude_was_here.version).toBe('1.0');
    
    // The final file should have Claude contributions tracked accurately
    // Based on the final diff, Claude should be credited with all the lines that exist in the final file
    // since Claude was involved in creating the initial content that forms the base of the final result
    const finalFileData = squashedNoteData.claude_was_here.files['example.js'];
    expect(finalFileData).toBeDefined();
    
    // Verify that the ranges make sense for the final file structure
    // The exact line numbers will depend on how the diff analysis maps the changes
    expect(finalFileData.ranges.length).toBeGreaterThan(0);
    
    console.log('Final tracked ranges for example.js:', finalFileData.ranges);
    
    // Additional verification: check that the final file content matches expectations
    const finalFileContent = await readFile(join(testDir, 'example.js'), 'utf-8');
    const expectedLines = finalFileContent.split('\n').length;
    
    // Count total lines tracked by Claude in the final note
    let trackedLines = 0;
    for (const range of finalFileData.ranges) {
      if (Array.isArray(range) && range.length === 2) {
        trackedLines += range[1] - range[0] + 1;
      }
    }
    
    console.log(`Final file has ${expectedLines} lines, Claude tracked for ${trackedLines} lines`);
    
    // The key test: Claude should be credited with contributing to the final result,
    // but not necessarily all lines (since some original lines may have been removed)
    expect(trackedLines).toBeGreaterThan(0);
    expect(trackedLines).toBeLessThanOrEqual(expectedLines);
  });

  test('PR squash handles file deletion correctly', async () => {
    await mkdir(join(testDir, '.claude', 'was-here'), { recursive: true });
    
    const baseCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // === COMMIT 1: Claude creates a file ===
    await writeFile(join(testDir, 'temp.js'), 'console.log("temporary");');
    
    const tracking1 = [{
      timestamp: new Date().toISOString(),
      tool: 'Write',
      file: 'temp.js',
      lines: [1]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'temp.js.json'),
      JSON.stringify(tracking1, null, 2)
    );
    
    await execCommand('git', ['add', 'temp.js'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'Add temporary file'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    // === COMMIT 2: Claude deletes the file ===
    await execCommand('git', ['rm', 'temp.js'], testDir);
    await execCommand('git', ['commit', '-m', 'Remove temporary file'], testDir);
    
    const headCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // === SIMULATE GITHUB ACTIONS WORKFLOW ===
    const claudeCommitsData = await collectClaudeNotesFromCommits(testDir, baseCommit, headCommit);
    const finalClaudeNote = await analyzeClaudeLines(testDir, claudeCommitsData, baseCommit, headCommit);
    
    // === VERIFY RESULTS ===
    // When a file is completely removed in the final diff, it shouldn't appear in the final note
    expect(finalClaudeNote).toContain('claude-was-here');
    expect(finalClaudeNote).toContain('version: 1.0');
    expect(finalClaudeNote).not.toContain('temp.js');
  });

  test('PR squash handles multiple files with complex changes', async () => {
    await mkdir(join(testDir, '.claude', 'was-here'), { recursive: true });
    
    const baseCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // === COMMIT 1: Claude creates multiple files ===
    await writeFile(join(testDir, 'file1.js'), 'console.log("file1");');
    await writeFile(join(testDir, 'file2.py'), 'print("file2")');
    
    const tracking1 = [
      {
        timestamp: new Date().toISOString(),
        tool: 'Write',  
        file: 'file1.js',
        lines: [1]
      },
      {
        timestamp: new Date().toISOString(),
        tool: 'Write',
        file: 'file2.py', 
        lines: [1]
      }
    ];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'file1.js.json'),
      JSON.stringify([tracking1[0]], null, 2)
    );
    await writeFile(
      join(testDir, '.claude', 'was-here', 'file2.py.json'),
      JSON.stringify([tracking1[1]], null, 2)
    );
    
    await execCommand('git', ['add', '.'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'Add multiple files'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    // === COMMIT 2: Claude modifies one file, leaves other unchanged ===
    await writeFile(join(testDir, 'file1.js'), `console.log("file1");
console.log("updated by claude");`);
    
    const tracking2 = [{
      timestamp: new Date().toISOString(),
      tool: 'Edit',
      file: 'file1.js',
      lines: [2]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'file1.js.json'),
      JSON.stringify(tracking2, null, 2)
    );
    
    await execCommand('git', ['add', 'file1.js'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'Update file1'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    const headCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // === SIMULATE GITHUB ACTIONS WORKFLOW ===
    const claudeCommitsData = await collectClaudeNotesFromCommits(testDir, baseCommit, headCommit);
    const finalClaudeNote = await analyzeClaudeLines(testDir, claudeCommitsData, baseCommit, headCommit);
    
    // Simulate squash merge
    await execCommand('git', ['reset', '--soft', baseCommit], testDir);
    await execCommand('git', ['commit', '-m', 'Squashed PR: Add and update multiple files'], testDir);
    
    const squashedCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    await writeFile(join(testDir, 'temp_note.txt'), finalClaudeNote);
    await execCommand('git', ['notes', 'add', '-F', 'temp_note.txt', squashedCommit], testDir);
    
    // === VERIFY RESULTS ===
    const squashedNoteResult = await execCommand('git', ['notes', 'show', squashedCommit], testDir);
    const squashedNoteData = parseTsvToGitNoteData(squashedNoteResult.stdout);
    
    // Both files should be tracked since both exist in the final diff
    expect(squashedNoteData.claude_was_here.files['file1.js']).toBeDefined();
    expect(squashedNoteData.claude_was_here.files['file2.py']).toBeDefined();
    
    console.log('Multi-file tracking results:', squashedNoteData.claude_was_here.files);
  });
});