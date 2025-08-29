import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { execCommand, isGitAvailable } from './helpers/exec.ts';
import { installGitHubActions } from '../src/commands/install-github-actions.ts';

let testDir: string;
let originalCwd: string;

describe('claude-was-here install-github-actions', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await mkdtemp(join(tmpdir(), 'claude-github-actions-test-'));
    
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

  test('WILL install the GitHub Actions', async () => {
    // Run the install command
    await installGitHubActions();
    
    // Check that the workflow files were created
    expect(existsSync(join(testDir, '.github', 'workflows', 'preserve-claude-notes-pre.yml'))).toBe(true);
    expect(existsSync(join(testDir, '.github', 'workflows', 'preserve-claude-notes-post.yml'))).toBe(true);
    
    // Verify no scripts directory is created since we use npx
    expect(existsSync(join(testDir, '.github', 'scripts'))).toBe(false);
  });

  test('WILL not require claude-was-here to be installed (workflows use npx for runtime installation)', async () => {
    await installGitHubActions();
    
    // Check that the workflows use npx to run claude-was-here commands
    const preWorkflowContent = await readFile(join(testDir, '.github', 'workflows', 'preserve-claude-notes-pre.yml'), 'utf-8');
    const postWorkflowContent = await readFile(join(testDir, '.github', 'workflows', 'preserve-claude-notes-post.yml'), 'utf-8');
    
    // Verify workflows use npx to install and run claude-was-here commands
    expect(preWorkflowContent).toContain('npx @zdavison/claude-was-here@latest github-synchronize-pr');
    expect(postWorkflowContent).toContain('npx @zdavison/claude-was-here@latest github-squash-pr');
    
    // Verify no local scripts are needed
    expect(existsSync(join(testDir, '.github', 'scripts'))).toBe(false);
  });
});

describe('GitHub Action: Pull Request [opened, synchronize]', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await mkdtemp(join(tmpdir(), 'claude-pr-rollup-test-'));
    
    // Initialize git repo with branches
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
    
    // Create an initial commit on main
    await writeFile(join(testDir, 'README.md'), '# Test Project\n');
    await execCommand('git', ['add', 'README.md'], testDir);
    await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
    
    // Change to test directory for subsequent operations
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  test('WILL rollup all authorship information in commits in the PR into a latest state', async () => {
    // Create a feature branch with multiple Claude commits
    await execCommand('git', ['checkout', '-b', 'feature-branch'], testDir);
    
    // Commit 1: Create file1.ts with Claude notes
    await writeFile(join(testDir, 'file1.ts'), 'console.log("hello");\nconsole.log("world");\n');
    await execCommand('git', ['add', 'file1.ts'], testDir);
    await execCommand('git', ['commit', '-m', 'Add file1.ts'], testDir);
    
    const commit1Hash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // Add Claude note to commit 1
    const note1Text = 'claude-was-here\nversion: 1.1\nfile1.ts: 1-2';
    await execCommand('git', ['notes', '--ref', 'claude-was-here', 'add', '-m', note1Text, commit1Hash], testDir);
    
    // Commit 2: Create file2.ts with Claude notes
    await writeFile(join(testDir, 'file2.ts'), 'function test() {\n  return true;\n}\n');
    await execCommand('git', ['add', 'file2.ts'], testDir);
    await execCommand('git', ['commit', '-m', 'Add file2.ts'], testDir);
    
    const commit2Hash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // Add Claude note to commit 2
    const note2Text = 'claude-was-here\nversion: 1.1\nfile2.ts: 1-3';
    await execCommand('git', ['notes', '--ref', 'claude-was-here', 'add', '-m', note2Text, commit2Hash], testDir);
    
    // Get the base commit (main branch) - use master instead of HEAD~2
    const baseCommit = (await execCommand('git', ['merge-base', 'feature-branch', 'master'], testDir)).stdout;
    
    // Build the CLI first
    await execCommand('bun', ['run', 'build'], originalCwd);
    
    // Test the CLI command that would be used by GitHub Actions
    const cliPath = join(originalCwd, 'dist', 'cli.js');
    const result = await execCommand('bun', [cliPath, 'github-synchronize-pr', '--base', baseCommit, '--head', commit2Hash], testDir);
    
    expect(result.code).toBe(0);
    
    // Verify the command created the JSON data file
    const dataFilePath = join(testDir, 'claude-notes-data.json');
    expect(existsSync(dataFilePath)).toBe(true);
    
    // Verify the data file contains consolidated Claude contributions
    const dataContent = await readFile(dataFilePath, 'utf-8');
    const data = JSON.parse(dataContent);
    
    expect(data.baseCommit).toBe(baseCommit);
    expect(data.headCommit).toBe(commit2Hash);
    expect(data.contributions).toBeDefined();
    expect(data.contributions.length).toBeGreaterThan(0);
    
    // Check that both files are represented in the contributions
    const filepaths = data.contributions.map((c: any) => c.filepath);
    expect(filepaths).toContain('file1.ts');
    expect(filepaths).toContain('file2.ts');
  });
});

describe('GitHub Action: Pull Request [closed (merged)]', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await mkdtemp(join(tmpdir(), 'claude-pr-merge-test-'));
    
    // Initialize git repo with branches
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
    
    // Create an initial commit on main
    await writeFile(join(testDir, 'README.md'), '# Test Project\n');
    await execCommand('git', ['add', 'README.md'], testDir);
    await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
    
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  test('WILL add the latest rolled up state stored from the [opened, synchronize] action to the final squashed merge commit as a git note', async () => {
    // Create a more complex scenario to test line range consolidation
    
    // Create feature branch with multiple Claude commits that modify different parts
    await execCommand('git', ['checkout', '-b', 'feature-branch'], testDir);
    
    // Commit 1: Add initial file with Claude authoring lines 1-3
    const initialContent = `// Header comment\nexport function feature() {\n  console.log("starting");\n  return "v1";\n}`;
    await writeFile(join(testDir, 'feature.ts'), initialContent);
    await execCommand('git', ['add', 'feature.ts'], testDir);
    await execCommand('git', ['commit', '-m', 'Add initial feature'], testDir);
    const commit1Hash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // Add Claude note to commit 1 (Claude authored lines 2-4: the function definition)
    const note1Text = 'claude-was-here\nversion: 1.1\nfeature.ts: 2-4';
    await execCommand('git', ['notes', '--ref', 'claude-was-here', 'add', '-m', note1Text, commit1Hash], testDir);
    
    // Commit 2: Add more functionality, Claude authors lines 5-7
    const extendedContent = `// Header comment\nexport function feature() {\n  console.log("starting");\n  return "v1";\n}\n\n// Added by Claude\nexport function helper() {\n  return "helper";\n}`;
    await writeFile(join(testDir, 'feature.ts'), extendedContent);
    await execCommand('git', ['add', 'feature.ts'], testDir);
    await execCommand('git', ['commit', '-m', 'Add helper function'], testDir);
    const commit2Hash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // Add Claude note to commit 2 (Claude authored the new lines 7-9)
    const note2Text = 'claude-was-here\nversion: 1.1\nfeature.ts: 7-9';
    await execCommand('git', ['notes', '--ref', 'claude-was-here', 'add', '-m', note2Text, commit2Hash], testDir);
    
    // Commit 3: Claude modifies line 4 (changing return value) 
    const modifiedContent = `// Header comment\nexport function feature() {\n  console.log("starting");\n  return "v2"; // Updated by Claude\n}\n\n// Added by Claude\nexport function helper() {\n  return "helper";\n}`;
    await writeFile(join(testDir, 'feature.ts'), modifiedContent);
    await execCommand('git', ['add', 'feature.ts'], testDir);
    await execCommand('git', ['commit', '-m', 'Update return value'], testDir);
    const commit3Hash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    
    // Add Claude note to commit 3 (Claude modified line 4)
    const note3Text = 'claude-was-here\nversion: 1.1\nfeature.ts: 4';
    await execCommand('git', ['notes', '--ref', 'claude-was-here', 'add', '-m', note3Text, commit3Hash], testDir);
    
    // Switch back to main and create a squashed merge commit
    await execCommand('git', ['checkout', 'master'], testDir);
    
    // Final squashed content (same as the final feature branch content)
    await writeFile(join(testDir, 'feature.ts'), modifiedContent);
    await execCommand('git', ['add', 'feature.ts'], testDir);
    await execCommand('git', ['commit', '-m', 'Add feature with helper (#1)'], testDir);
    
    const mergeCommitHash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    const baseCommit = (await execCommand('git', ['rev-parse', 'HEAD~2'], testDir)).stdout;
    
    // Build the CLI first
    await execCommand('bun', ['run', 'build'], originalCwd);
    
    // Create consolidated data that github-synchronize-pr would generate
    // This should consolidate all Claude contributions from the 3 commits
    const claudeNotesData = {
      baseCommit,
      headCommit: commit3Hash,
      contributions: [
        { commitHash: commit1Hash, filepath: 'feature.ts', ranges: '2-4' },
        { commitHash: commit2Hash, filepath: 'feature.ts', ranges: '7-9' },
        { commitHash: commit3Hash, filepath: 'feature.ts', ranges: '4' }
      ],
      contentSignatures: []
    };
    const claudeDataFile = join(testDir, 'claude-notes-data.json');
    await writeFile(claudeDataFile, JSON.stringify(claudeNotesData, null, 2));
    
    // Test the github-squash-pr command
    const cliPath = join(originalCwd, 'dist', 'cli.js');
    const result = await execCommand('bun', [cliPath, 'github-squash-pr', '--data-file', claudeDataFile, '--base', baseCommit, '--merge', mergeCommitHash], testDir);
    
    expect(result.code).toBe(0);
    
    // Verify the consolidated git note has the correct line ranges
    const noteResult = await execCommand('git', ['notes', '--ref', 'claude-was-here', 'show', mergeCommitHash], testDir);
    expect(noteResult.code).toBe(0);
    
    // Parse the note content to verify structure
    const noteLines = noteResult.stdout.split('\n');
    expect(noteLines[0]).toBe('claude-was-here');
    expect(noteLines[1]).toBe('version: 1.1');
    
    // Find the feature.ts line - should consolidate overlapping/duplicate ranges
    const featureLines = noteLines.filter(line => line.startsWith('feature.ts:'));
    expect(featureLines).toHaveLength(1);
    
    // Expected consolidation:
    // - commit1: lines 2-4 
    // - commit2: lines 7-9
    // - commit3: line 4 (overlaps with commit1, should be deduplicated)
    // Final result should be: 2-4,7-9 (consolidated and deduplicated)
    const featureLine = featureLines[0];
    expect(featureLine).toMatch(/feature\.ts:\s+2-4,7-9/);
    
    // Verify the final file content matches what we expect
    const finalContent = await readFile(join(testDir, 'feature.ts'), 'utf-8');
    const finalLines = finalContent.split('\n');
    expect(finalLines).toHaveLength(10);
    expect(finalLines[3]).toContain('v2'); // Verify Claude's change is present
    expect(finalLines[7]).toContain('helper'); // Verify Claude's addition is present
  });
});