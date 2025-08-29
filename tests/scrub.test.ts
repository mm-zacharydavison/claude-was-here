import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execCommand } from './helpers/exec.ts';

async function createTestRepo(): Promise<string> {
  const testDir = await mkdtemp(join(tmpdir(), 'claude-scrub-test-'));
  
  // Initialize git repo
  await execCommand('git', ['init'], testDir);
  await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
  await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
  
  return testDir;
}

async function addClaudeNoteToCommit(testDir: string, commitHash: string, noteContent: string): Promise<void> {
  // Create a temporary file with note content
  const noteFile = join(testDir, 'temp_note.txt');
  await writeFile(noteFile, noteContent);
  
  // Add the note to the commit
  await execCommand('git', ['notes', 'add', '-F', noteFile, commitHash], testDir);
  
  // Clean up temp file
  await rm(noteFile);
}

test('Scrub Command Tests > scrub removes claude-was-here notes', async () => {
  const testDir = await createTestRepo();
  
  try {
    // Create a test file and commit it
    const testFile = join(testDir, 'test.js');
    await writeFile(testFile, 'console.log("original");');
    await execCommand('git', ['add', testFile], testDir);
    const commitResult = await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
    expect(commitResult.code).toBe(0);
    
    // Get the commit hash
    const logResult = await execCommand('git', ['log', '--format=%H', '-1'], testDir);
    const commitHash = logResult.stdout.trim();
    
    // Add a claude-was-here note to the commit
    const claudeNote = `claude-was-here
version: 1.1
test.js: 1-5`;
    
    await addClaudeNoteToCommit(testDir, commitHash, claudeNote);
    
    // Verify the note exists
    const notesBefore = await execCommand('git', ['notes', 'show', commitHash], testDir);
    expect(notesBefore.code).toBe(0);
    expect(notesBefore.stdout).toContain('claude-was-here');
    
    // Run scrub command with --force flag to skip confirmation
    const scrubResult = await execCommand('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'scrub', '--force'], testDir);
    expect(scrubResult.code).toBe(0);
    expect(scrubResult.stdout).toContain('Successfully scrubbed');
    
    // Verify the note is removed
    const notesAfter = await execCommand('git', ['notes', 'show', commitHash], testDir);
    expect(notesAfter.code).not.toBe(0); // Should fail because no note exists
    
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}, 10000);

test('Scrub Command Tests > scrub handles repository with no claude notes', async () => {
  const testDir = await createTestRepo();
  
  try {
    // Create a test file and commit it (but don't add any claude notes)
    const testFile = join(testDir, 'test.js');
    await writeFile(testFile, 'console.log("original");');
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
    
    // Run scrub command with --force flag to skip confirmation
    const scrubResult = await execCommand('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'scrub', '--force'], testDir);
    expect(scrubResult.code).toBe(0);
    expect(scrubResult.stdout).toContain('No claude-was-here notes found');
    
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}, 10000);

test('Scrub Command Tests > scrub preserves non-claude notes', async () => {
  const testDir = await createTestRepo();
  
  try {
    // Create two commits
    const testFile = join(testDir, 'test.js');
    await writeFile(testFile, 'console.log("original");');
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'First commit'], testDir);
    
    const firstCommitResult = await execCommand('git', ['log', '--format=%H', '-1'], testDir);
    const firstCommit = firstCommitResult.stdout.trim();
    
    await writeFile(testFile, 'console.log("modified");');
    await execCommand('git', ['add', testFile], testDir);
    await execCommand('git', ['commit', '-m', 'Second commit'], testDir);
    
    const secondCommitResult = await execCommand('git', ['log', '--format=%H', '-1'], testDir);
    const secondCommit = secondCommitResult.stdout.trim();
    
    // Add a claude note to first commit and a regular note to second commit
    const claudeNote = `claude-was-here
version: 1.1
test.js: 1-2`;
    
    const regularNote = `This is a regular git note
Not related to Claude Code tracking at all
Just a normal note for testing purposes`;
    
    await addClaudeNoteToCommit(testDir, firstCommit, claudeNote);
    await addClaudeNoteToCommit(testDir, secondCommit, regularNote);
    
    // Verify both notes exist
    const claudeNoteBefore = await execCommand('git', ['notes', 'show', firstCommit], testDir);
    expect(claudeNoteBefore.code).toBe(0);
    expect(claudeNoteBefore.stdout).toContain('claude-was-here');
    
    const regularNoteBefore = await execCommand('git', ['notes', 'show', secondCommit], testDir);
    expect(regularNoteBefore.code).toBe(0);
    expect(regularNoteBefore.stdout).toContain('regular git note');
    
    // Run scrub command with --force flag to skip confirmation
    const scrubResult = await execCommand('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'scrub', '--force'], testDir);
    expect(scrubResult.code).toBe(0);
    expect(scrubResult.stdout).toContain('claude-was-here notes');
    
    // Verify claude note is removed but regular note remains
    const claudeNoteAfter = await execCommand('git', ['notes', 'show', firstCommit], testDir);
    expect(claudeNoteAfter.code).not.toBe(0); // Should fail because claude note is removed
    
    const regularNoteAfter = await execCommand('git', ['notes', 'show', secondCommit], testDir);
    expect(regularNoteAfter.code).toBe(0); // Should still exist
    expect(regularNoteAfter.stdout).toContain('regular git note');
    
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}, 10000);

test('Scrub Command Tests > scrub --force flag bypasses confirmation prompt', async () => {
  const testDir = await createTestRepo();
  
  try {
    // Create a test file and commit it
    const testFile = join(testDir, 'test.js');
    await writeFile(testFile, 'console.log("original");');
    await execCommand('git', ['add', testFile], testDir);
    const commitResult = await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
    expect(commitResult.code).toBe(0);
    
    // Get the commit hash
    const logResult = await execCommand('git', ['log', '--format=%H', '-1'], testDir);
    const commitHash = logResult.stdout.trim();
    
    // Add a claude-was-here note to the commit
    const claudeNote = `claude-was-here
version: 1.1
test.js: 1-5`;
    
    await addClaudeNoteToCommit(testDir, commitHash, claudeNote);
    
    // Verify the note exists
    const notesBefore = await execCommand('git', ['notes', 'show', commitHash], testDir);
    expect(notesBefore.code).toBe(0);
    expect(notesBefore.stdout).toContain('claude-was-here');
    
    // Run scrub command with --force flag (should not show confirmation prompt)
    const scrubResult = await execCommand('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'scrub', '--force'], testDir);
    expect(scrubResult.code).toBe(0);
    expect(scrubResult.stdout).toContain('Successfully scrubbed');
    // Should not contain confirmation text
    expect(scrubResult.stdout).not.toContain('This will permanently remove');
    expect(scrubResult.stdout).not.toContain('Are you sure you want to continue?');
    
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}, 10000);

test('Scrub Command Tests > scrub fails gracefully outside git repository', async () => {
  const testDir = await mkdtemp(join(tmpdir(), 'claude-scrub-nogit-test-'));
  
  try {
    // Run scrub command in non-git directory
    const scrubResult = await execCommand('bun', ['run', join(process.cwd(), 'src/cli.ts'), 'scrub', '--force'], testDir);
    expect(scrubResult.code).toBe(1);
    expect(scrubResult.stderr).toContain('Not in a git repository');
    
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}, 10000);