import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseTsvToGitNoteData } from './helpers/tsv.ts';
import { analyzePRSquashClaudeContributions } from '../src/lib/pr-squash-analysis.ts';

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
    const finalClaudeNote = await analyzePRSquashClaudeContributions(testDir, baseCommit, headCommit);
    
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
    const finalClaudeNote = await analyzePRSquashClaudeContributions(testDir, baseCommit, headCommit);
    
    // === VERIFY RESULTS ===
    // When a file is completely removed in the final diff, it shouldn't appear in the final note
    expect(finalClaudeNote).toContain('claude-was-here');
    expect(finalClaudeNote).toContain('version: 1.0');
    expect(finalClaudeNote).not.toContain('temp.js');
  });

  test('PR squash correctly attributes mixed human and Claude authorship', async () => {
    await mkdir(join(testDir, '.claude', 'was-here'), { recursive: true });
    
    const baseCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // === COMMIT 1: Human creates initial file structure ===
    const initialFile = `// Human-written header comment
function processData(input) {
  // Human logic
  if (!input) {
    return null;
  }
  return input.toUpperCase();
}

// Human utility function
function validateInput(data) {
  return data && data.length > 0;
}`;
    
    await writeFile(join(testDir, 'processor.js'), initialFile);
    await execCommand('git', ['add', 'processor.js'], testDir);
    await execCommand('git', ['commit', '-m', 'Human: Add initial processor functions'], testDir);
    
    // === COMMIT 2: Claude adds error handling and new function ===
    const claudeEnhanced = `// Human-written header comment
function processData(input) {
  // Human logic
  if (!input) {
    console.error("Invalid input provided"); // Claude added
    return null;
  }
  return input.toUpperCase();
}

// Human utility function
function validateInput(data) {
  return data && data.length > 0;
}

// Claude: Add logging function
function logResult(result) {
  const timestamp = new Date().toISOString();
  console.log(\`[\${timestamp}] Result: \${result}\`);
  return result;
}`;
    
    await writeFile(join(testDir, 'processor.js'), claudeEnhanced);
    
    // Track Claude's contributions: line 5 (error log) and lines 15-20 (new function)
    const tracking2 = [{
      timestamp: new Date().toISOString(),
      tool: 'Edit',
      file: 'processor.js',
      lines: [5, 15, 16, 17, 18, 19, 20]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'processor.js.json'),
      JSON.stringify(tracking2, null, 2)
    );
    
    await execCommand('git', ['add', 'processor.js'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'Claude: Add error handling and logging'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    // === COMMIT 3: Human modifies Claude's function and adds new logic ===
    const humanModified = `// Human-written header comment
function processData(input) {
  // Human logic
  if (!input) {
    console.error("Invalid input provided"); // Claude added
    return null;
  }
  // Human: Add lowercase option
  if (input.startsWith('lower:')) {
    return input.substring(6).toLowerCase();
  }
  return input.toUpperCase();
}

// Human utility function
function validateInput(data) {
  return data && data.length > 0;
}

// Claude: Add logging function
function logResult(result) {
  const timestamp = new Date().toISOString();
  console.log(\`[\${timestamp}] Result: \${result}\`);
  // Human: Add debug mode
  if (process.env.DEBUG) {
    console.debug('Stack trace:', new Error().stack);
  }
  return result;
}

// Human: Add export
module.exports = { processData, validateInput, logResult };`;
    
    await writeFile(join(testDir, 'processor.js'), humanModified);
    await execCommand('git', ['add', 'processor.js'], testDir);
    await execCommand('git', ['commit', '-m', 'Human: Add lowercase option and debug mode'], testDir);
    
    // === COMMIT 4: Claude refactors and optimizes ===
    const claudeRefactored = `// Human-written header comment
const DEFAULT_OPTIONS = { uppercase: true }; // Claude added

function processData(input, options = DEFAULT_OPTIONS) { // Claude modified
  // Human logic
  if (!input) {
    console.error("Invalid input provided"); // Claude added
    return null;
  }
  // Human: Add lowercase option
  if (input.startsWith('lower:')) {
    return input.substring(6).toLowerCase();
  }
  // Claude: Use options parameter
  return options.uppercase ? input.toUpperCase() : input;
}

// Human utility function  
function validateInput(data) {
  // Claude: Add type checking
  if (typeof data !== 'string') {
    return false;
  }
  return data && data.length > 0;
}

// Claude: Add logging function
function logResult(result) {
  const timestamp = new Date().toISOString();
  console.log(\`[\${timestamp}] Result: \${result}\`);
  // Human: Add debug mode
  if (process.env.DEBUG) {
    console.debug('Stack trace:', new Error().stack);
  }
  return result;
}

// Claude: Add helper function for processing arrays
function processArray(items, options) {
  return items.map(item => processData(item, options));
}

// Human: Add export
module.exports = { processData, validateInput, logResult, processArray }; // Claude modified`;
    
    await writeFile(join(testDir, 'processor.js'), claudeRefactored);
    
    // Track Claude's new contributions
    const tracking4 = [{
      timestamp: new Date().toISOString(),
      tool: 'Edit',
      file: 'processor.js',
      lines: [2, 4, 15, 20, 21, 22, 38, 39, 40, 43]
    }];
    
    await writeFile(
      join(testDir, '.claude', 'was-here', 'processor.js.json'),
      JSON.stringify(tracking4, null, 2)
    );
    
    await execCommand('git', ['add', 'processor.js'], testDir);
    await execBunCommand(['pre-commit'], testDir);
    await execCommand('git', ['commit', '-m', 'Claude: Refactor with options and add array processing'], testDir);
    await execBunCommand(['post-commit'], testDir);
    
    const headCommit = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // === SIMULATE GITHUB ACTIONS WORKFLOW ===
    
    // Use the shared analysis logic (consolidates git notes data)
    const finalClaudeNote = await analyzePRSquashClaudeContributions(testDir, baseCommit, headCommit);
    
    // Step 3: Simulate squash merge
    await execCommand('git', ['reset', '--soft', baseCommit], testDir);
    await execCommand('git', ['commit', '-m', 'Squashed PR: Enhanced processor with mixed authorship'], testDir);
    
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
    
    // The final file should have mixed authorship tracked
    const finalFileData = squashedNoteData.claude_was_here.files['processor.js'];
    expect(finalFileData).toBeDefined();
    expect(finalFileData.ranges.length).toBeGreaterThan(0);
    
    // Read the final file content to verify
    const finalFileContent = await readFile(join(testDir, 'processor.js'), 'utf-8');
    const finalLines = finalFileContent.split('\n');
    
    // Count Claude-attributed lines from the note
    let claudeLineNumbers = new Set<number>();
    for (const range of finalFileData.ranges) {
      if (Array.isArray(range) && range.length === 2) {
        for (let i = range[0]; i <= range[1]; i++) {
          claudeLineNumbers.add(i);
        }
      }
    }
    
    // Verify specific Claude contributions are tracked
    // The analysis should now properly detect mixed authorship:
    // - Claude should be credited with specific patterns/lines they added
    // - But not with all lines (human also contributed)
    expect(claudeLineNumbers.size).toBeGreaterThan(0);
    expect(claudeLineNumbers.size).toBeLessThan(finalLines.length);
    
    // Verify that Claude is credited with reasonable amount (not too little, not everything)
    const claudePercentage = (claudeLineNumbers.size / finalLines.length) * 100;
    expect(claudePercentage).toBeGreaterThan(5);  // Should have meaningful contribution
    expect(claudePercentage).toBeLessThan(90);    // But not overwhelming majority
    
    // Verify the note format is correct
    expect(squashedNoteResult.stdout).toContain('claude-was-here');
    expect(squashedNoteResult.stdout).toContain('version:');
    expect(squashedNoteResult.stdout).toContain('processor.js:');
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
    const finalClaudeNote = await analyzePRSquashClaudeContributions(testDir, baseCommit, headCommit);
    
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
  });
});