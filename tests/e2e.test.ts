import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseTsvToGitNoteData } from './helpers/tsv.ts';

// Helper function to execute commands
const execCommand = (command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> => {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { 
      cwd, 
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${join(process.cwd(), 'tests/bin')}:${process.env.PATH}` }
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

// Helper to get the path to the claude-was-here binary in the project root
const getBinaryPath = () => {
  // Always use the project root directory, not the test directory
  const projectRoot = process.cwd();
  return join(projectRoot, 'claude-was-here');
};

const verifyBinaryExists = async () => {
  const realBinary = getBinaryPath();
  const { access } = await import('fs/promises');
  try {
    await access(realBinary);
    return realBinary;
  } catch (error) {
    throw new Error(`claude-was-here binary not found at ${realBinary}. Run 'bun run build:binary' first.`);
  }
};

// Helper to simulate Claude Code hook input
const simulateClaudeEdit = async (testDir: string, filePath: string, oldString: string, newString: string) => {
  const hookInput = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,  // Use relative path instead of absolute
      old_string: oldString,
      new_string: newString
    }
  });
  
  const proc = spawn('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'track-changes'], {
    cwd: testDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_CWD: testDir }
  });
  
  proc.stdin.write(hookInput);
  proc.stdin.end();
  
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());
    
    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code || 0 });
    });
  });
};

describe('claude-was-here E2E Tests', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `claude-was-here-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    // Don't change process.cwd() - this breaks binary path resolution
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('End-to-end workflow: install, track changes, commit, verify notes', async () => {
    // Step 1: Verify binary exists
    await verifyBinaryExists();
    
    // Step 2: Initialize git repository
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
    
    // Step 3: Install claude-was-here using bun run
    const installResult = await execCommand('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'init'], testDir);
    if (installResult.code !== 0) {
      console.error('Install failed:', installResult.stderr);
      console.log('Install stdout:', installResult.stdout);
    }
    expect(installResult.code).toBe(0);
    expect(installResult.stdout).toContain('Initialization completed successfully!');
    
    // Verify installation
    const claudeSettings = await readFile(join(testDir, '.claude', 'settings.json'), 'utf-8');
    const settings = JSON.parse(claudeSettings);
    expect(settings.hooks.PostToolUse).toBeDefined();
    
    // Step 4: Create a test file
    const testFile = 'example.js';
    const initialContent = `function hello() {
    console.log("Hello, World!");
}`;
    await writeFile(join(testDir, testFile), initialContent);
    
    // Step 5: Simulate Claude Code making changes
    const oldString = 'console.log("Hello, World!");';
    const newString = `console.log("Hello, World!");
    console.log("This line was added by Claude!");`;
    
    // Update the file to reflect the change
    const updatedContent = initialContent.replace(oldString, newString);
    await writeFile(join(testDir, testFile), updatedContent);
    
    // Simulate the Claude hook being triggered
    const hookResult = await simulateClaudeEdit(testDir, testFile, oldString, newString);
    if (hookResult.code !== 0) {
      console.error('Hook simulation failed:', hookResult.stderr);
      console.log('Hook simulation stdout:', hookResult.stdout);
    }
    expect(hookResult.code).toBe(0);
    
    // Verify tracking data was created
    const trackingFiles = await readFile(join(testDir, '.claude', 'was-here', 'example.js.json'), 'utf-8');
    const trackingData = JSON.parse(trackingFiles);
    expect(trackingData).toHaveLength(1);
    expect(trackingData[0].tool).toBe('Edit');
    expect(trackingData[0].file).toBe('example.js');
    expect(trackingData[0].lines).toBeDefined();
    
    // Step 6: Stage and commit the file
    await execCommand('git', ['add', testFile], testDir);
    const commitResult = await execCommand('git', ['commit', '-m', 'Add example with Claude changes'], testDir);
    expect(commitResult.code).toBe(0);
    
    // Step 7: Verify git notes were created
    const notesResult = await execCommand('git', ['notes', 'show'], testDir);
    if (notesResult.code !== 0) {
      console.error('Git notes show failed:', notesResult.stderr);
      console.log('Git notes stdout:', notesResult.stdout);
      // Check if this is just "no notes found" vs a real error
      if (notesResult.stderr.includes('no note found')) {
        throw new Error('Expected git notes to be created but none were found');
      }
    }
    expect(notesResult.code).toBe(0);
    
    const noteData = parseTsvToGitNoteData(notesResult.stdout);
    expect(noteData.claude_was_here).toBeDefined();
    expect(noteData.claude_was_here.version).toBe('1.1');
    expect(noteData.claude_was_here.files).toBeDefined();
    expect(noteData.claude_was_here.files[testFile]).toBeDefined();
    expect(noteData.claude_was_here.files[testFile].ranges).toBeDefined();
    expect(noteData.claude_was_here.files[testFile].ranges.length).toBeGreaterThan(0);
  });

  test('Multiple files with different line ranges', async () => {
    // Setup
    await verifyBinaryExists();
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
    await execCommand('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'init'], testDir);
    
    // Create multiple test files and simulate Claude changes
    const files = [
      { name: 'file1.js', content: 'console.log("file1");' },
      { name: 'file2.py', content: 'print("file2")' },
      { name: 'file3.ts', content: 'console.log("file3");' }
    ];
    
    for (const file of files) {
      await writeFile(join(testDir, file.name), file.content);
      
      // Update file with new content first
      const newContent = file.content + '\n// Added by Claude';
      await writeFile(join(testDir, file.name), newContent);
      
      // Then simulate Claude editing each file
      await simulateClaudeEdit(testDir, file.name, file.content, newContent);
    }
    
    // Commit all files
    await execCommand('git', ['add', '.'], testDir);
    await execCommand('git', ['commit', '-m', 'Multiple files edited by Claude'], testDir);
    
    // Verify notes contain all files
    const notesResult = await execCommand('git', ['notes', 'show'], testDir);
    if (notesResult.code !== 0) {
      console.error('Git notes show failed:', notesResult.stderr);
      console.log('Git notes stdout:', notesResult.stdout);
      if (notesResult.stderr.includes('no note found')) {
        throw new Error('Expected git notes to be created but none were found');
      }
    }
    expect(notesResult.code).toBe(0);
    
    const noteData = parseTsvToGitNoteData(notesResult.stdout);
    expect(Object.keys(noteData.claude_was_here.files)).toHaveLength(3);
    
    for (const file of files) {
      expect(noteData.claude_was_here.files[file.name]).toBeDefined();
      expect(noteData.claude_was_here.files[file.name].ranges).toBeDefined();
    }
  });

  test('No notes created when no Claude changes', async () => {
    // Setup
    await verifyBinaryExists();
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
    await execCommand('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'init'], testDir);
    
    // Create and commit a file without Claude involvement
    await writeFile(join(testDir, 'manual.txt'), 'This was created manually');
    await execCommand('git', ['add', 'manual.txt'], testDir);
    await execCommand('git', ['commit', '-m', 'Manual file creation'], testDir);
    
    // Verify no notes were created
    const notesResult = await execCommand('git', ['notes', 'show'], testDir);
    expect(notesResult.code).toBe(1); // git notes show fails when no notes exist
    expect(notesResult.stderr).toContain('no note found');
  });

  test('Line ranges are correctly calculated', async () => {
    // Setup
    await verifyBinaryExists();
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
    await execCommand('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'init'], testDir);
    
    // Create file with specific content
    const fileName = 'ranges.js';
    const content = `line 1
line 2
line 3
line 4
line 5
line 6
line 7
line 8`;
    
    await writeFile(join(testDir, fileName), content);
    
    // Simulate Claude editing non-consecutive lines (1, 3, 4, 5, 8)
    const hookInputs = [
      { line: 1, content: 'line 1 - modified' },
      { line: 3, content: 'line 3 - modified' },
      { line: 4, content: 'line 4 - modified' },
      { line: 5, content: 'line 5 - modified' },
      { line: 8, content: 'line 8 - modified' }
    ];
    
    // Create tracking data manually for precise control
    const trackingData = [{
      timestamp: new Date().toISOString(),
      tool: 'Edit',
      file: fileName,
      lines: [1, 3, 4, 5, 8]
    }];
    
    await mkdir(join(testDir, '.claude', 'was-here'), { recursive: true });
    await writeFile(
      join(testDir, '.claude', 'was-here', 'ranges.js.json'),
      JSON.stringify(trackingData, null, 2)
    );
    
    // Commit the file
    await execCommand('git', ['add', fileName], testDir);
    await execCommand('git', ['commit', '-m', 'Test range calculation'], testDir);
    
    // Verify ranges are correctly calculated
    const notesResult = await execCommand('git', ['notes', 'show'], testDir);
    if (notesResult.code !== 0) {
      console.error('Git notes show failed:', notesResult.stderr);
      console.log('Git notes stdout:', notesResult.stdout);
      if (notesResult.stderr.includes('no note found')) {
        throw new Error('Expected git notes to be created but none were found');
      }
    }
    expect(notesResult.code).toBe(0);
    
    const noteData = parseTsvToGitNoteData(notesResult.stdout);
    const ranges = noteData.claude_was_here.files[fileName].ranges;
    
    // Should create ranges: [1,1], [3,5], [8,8]
    expect(ranges).toEqual([[1, 1], [3, 5], [8, 8]]);
  });
});