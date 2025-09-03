import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { execCommand } from '../helpers/exec.ts';
import { writeAsHuman, writeAsClaude, createMixedCommit } from './helpers/code-authoring.ts';

let testDir: string;
let originalCwd: string;
let testRepoName: string;
let testOrgName: string;

// Helper to check if gh CLI is available and authenticated
const isGhCliAvailable = async (): Promise<boolean> => {
  try {
    const result = await execCommand('gh', ['--version'], process.cwd());
    if (result.code !== 0) return false;
    
    const authResult = await execCommand('gh', ['auth', 'status'], process.cwd());
    return authResult.code === 0;
  } catch {
    return false;
  }
};

// Helper to generate unique repository name
const generateRepoName = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `claude-was-here-basic-${timestamp}-${random}`;
};

describe('Basic GitHub PR Test', () => {
  beforeAll(async () => {
    const ghAvailable = await isGhCliAvailable();
    if (!ghAvailable) {
      console.log('Skipping GitHub tests: gh CLI not available or not authenticated');
      return;
    }

    originalCwd = process.cwd();
    testRepoName = generateRepoName();
    
    // Get authenticated user
    const whoAmI = await execCommand('gh', ['api', 'user'], process.cwd());
    if (whoAmI.code === 0) {
      const user = JSON.parse(whoAmI.stdout);
      testOrgName = user.login;
    }
  });

  afterAll(async () => {
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
    
    if (testRepoName) {
      console.log(`\n📝 Test repository created: https://github.com/${testOrgName}/${testRepoName}`);
      console.log(`   To clean up later: bun run test:cleanup`);
    }
  });

  test('WILL create basic PR with mixed human+AI authorship', async () => {
    const ghAvailable = await isGhCliAvailable();
    if (!ghAvailable) {
      console.log('⏭️  Skipping test - GitHub CLI not available');
      return;
    }

    testDir = await mkdtemp(join(tmpdir(), 'claude-basic-pr-'));
    process.chdir(testDir);
    
    // Initialize repository
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Basic PR Test'], testDir);
    await execCommand('git', ['config', 'user.email', 'basic-pr@test.com'], testDir);
    
    // Initial commit
    await writeFile(join(testDir, 'README.md'), '# Basic PR Test\n');
    await execCommand('git', ['add', '.'], testDir);
    await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
    
    // Create GitHub repository
    await execCommand('gh', ['repo', 'create', testRepoName, '--public', '--source', '.', '--push'], testDir);
    
    // Initialize claude-was-here
    const cliPath = join(originalCwd, 'dist', 'cli.js');
    await execCommand('bun', [cliPath, 'init'], testDir);
    await execCommand('bun', [cliPath, 'install-github-actions'], testDir);
    
    await execCommand('git', ['add', '.github/'], testDir);
    await execCommand('git', ['commit', '-m', 'Add GitHub Actions'], testDir);
    await execCommand('git', ['push'], testDir);
    
    // Create feature branch
    await execCommand('git', ['checkout', '-b', 'feature/basic-test'], testDir);
    await execCommand('mkdir', ['-p', 'src'], testDir);
    
    // Create mixed commit
    await createMixedCommit({
      cwd: testDir,
      cliPath,
      humanChanges: [{
        filePath: 'src/utils.ts',
        content: `export const VERSION = '1.0.0';\n`,
        description: 'Add version constant'
      }],
      claudeChanges: [{
        filePath: 'src/main.ts',
        content: `import { VERSION } from './utils';\n\nconsole.log('App version:', VERSION);\n`,
        task: 'Create main entry point'
      }],
      commitMessage: 'Add basic application structure'
    });
    
    await execCommand('git', ['add', '.'], testDir);
    await execCommand('git', ['commit', '-m', 'Add basic application structure'], testDir);
    
    // Verify git notes
    const commitHash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
    const notesResult = await execCommand('git', ['notes', 'show', commitHash], testDir);
    
    if (notesResult.code === 0) {
      console.log('✅ Git notes created:', notesResult.stdout);
      expect(notesResult.stdout).toContain('src/main.ts');
      expect(notesResult.stdout).not.toContain('src/utils.ts');
    }
    
    // Push and create PR
    await execCommand('git', ['push', '--set-upstream', 'origin', 'feature/basic-test'], testDir);
    
    const prResult = await execCommand('gh', ['pr', 'create', 
      '--title', 'Basic mixed authorship test',
      '--body', 'Testing basic human + AI authorship'
    ], testDir);
    
    expect(prResult.code).toBe(0);
    console.log('✅ Basic PR test completed');
  }, 90000);
});