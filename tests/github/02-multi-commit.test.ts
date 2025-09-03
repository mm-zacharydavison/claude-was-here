import { test, expect, describe } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execCommand } from '../helpers/exec.ts';
import { writeAsHuman, writeAsClaude } from './helpers/code-authoring.ts';

// Helper to check if gh CLI is available
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

const generateRepoName = (): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `claude-multi-commit-${timestamp}-${random}`;
};

describe('Multi-Commit GitHub Test', () => {
  test('WILL create 3 commits with different authorship patterns', async () => {
    const ghAvailable = await isGhCliAvailable();
    if (!ghAvailable) {
      console.log('⏭️  Skipping test - GitHub CLI not available');
      return;
    }

    const originalCwd = process.cwd();
    const testRepoName = generateRepoName();
    const testDir = await mkdtemp(join(tmpdir(), 'claude-multi-'));
    
    try {
      process.chdir(testDir);
      
      // Setup repository
      await execCommand('git', ['init'], testDir);
      await execCommand('git', ['config', 'user.name', 'Multi Test'], testDir);
      await execCommand('git', ['config', 'user.email', 'multi@test.com'], testDir);
      
      // Initial commit
      await writeAsHuman({
        cwd: testDir,
        filePath: 'README.md',
        content: '# Multi-Commit Test\n'
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
      
      // Create GitHub repo
      await execCommand('gh', ['repo', 'create', testRepoName, '--public', '--source', '.', '--push'], testDir);
      
      // Initialize claude-was-here
      const cliPath = join(originalCwd, 'dist', 'cli.js');
      await execCommand('bun', [cliPath, 'init'], testDir);
      await execCommand('bun', [cliPath, 'install-github-actions'], testDir);
      
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Setup'], testDir);
      await execCommand('git', ['push'], testDir);
      
      // Feature branch
      await execCommand('git', ['checkout', '-b', 'feature/multi'], testDir);
      await execCommand('mkdir', ['-p', 'src'], testDir);
      
      // Commit 1: Pure Claude
      console.log('📦 Commit 1: Pure Claude');
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/service.ts',
        content: `export class Service {\n  getData() {\n    return { id: 1 };\n  }\n}\n`,
        task: 'Create service class',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add service'], testDir);
      
      // Commit 2: Pure Human
      console.log('📦 Commit 2: Pure Human');
      await writeAsHuman({
        cwd: testDir,
        filePath: 'src/types.ts',
        content: `export interface Data {\n  id: number;\n}\n`
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add types'], testDir);
      
      // Commit 3: Mixed
      console.log('📦 Commit 3: Mixed authorship');
      await writeAsHuman({
        cwd: testDir,
        filePath: 'src/app.ts',
        content: `import { Service } from './service';\n\n`
      });
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/app.ts',
        content: `import { Service } from './service';\n\nconst service = new Service();\nconsole.log(service.getData());\n`,
        task: 'Add app logic',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add app'], testDir);
      
      // Push and create PR
      await execCommand('git', ['push', '--set-upstream', 'origin', 'feature/multi'], testDir);
      
      const prResult = await execCommand('gh', ['pr', 'create', 
        '--title', 'Multi-commit test',
        '--body', 'Testing multiple commit patterns'
      ], testDir);
      
      expect(prResult.code).toBe(0);
      
      // Wait and merge
      console.log('⏳ Waiting for GitHub Actions...');
      await new Promise(resolve => setTimeout(resolve, 20000));
      
      const prNumber = prResult.stdout.split('/').pop();
      await execCommand('gh', ['pr', 'merge', prNumber!, '--squash', '--delete-branch'], testDir);
      
      // Verify merged notes
      await execCommand('git', ['checkout', 'master'], testDir);
      await execCommand('git', ['pull'], testDir);
      
      const mergeHash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
      const notesResult = await execCommand('git', ['notes', 'show', mergeHash], testDir);
      
      if (notesResult.code === 0) {
        console.log('✅ Merged notes:', notesResult.stdout);
        expect(notesResult.stdout).toContain('src/service.ts');
        expect(notesResult.stdout).toContain('src/app.ts');
        expect(notesResult.stdout).not.toContain('src/types.ts');
      }
      
      const whoAmI = await execCommand('gh', ['api', 'user'], testDir);
      const user = whoAmI.code === 0 ? JSON.parse(whoAmI.stdout) : { login: 'unknown' };
      console.log(`📝 Repository: https://github.com/${user.login}/${testRepoName}`);
      
    } finally {
      process.chdir(originalCwd);
      await rm(testDir, { recursive: true, force: true });
    }
  }, 120000);
});