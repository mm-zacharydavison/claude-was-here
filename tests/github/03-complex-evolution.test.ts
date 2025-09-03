import { test, expect, describe } from 'bun:test';
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execCommand } from '../helpers/exec.ts';
import { writeAsHuman, writeAsClaude, parseLineRangesFromNotes } from './helpers/code-authoring.ts';

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
  return `claude-complex-${timestamp}-${random}`;
};

describe('Complex Code Evolution Test', () => {
  test('WILL handle 6 commits with additions, deletions, and mutations', async () => {
    const ghAvailable = await isGhCliAvailable();
    if (!ghAvailable) {
      console.log('⏭️  Skipping test - GitHub CLI not available');
      return;
    }

    const originalCwd = process.cwd();
    const testRepoName = generateRepoName();
    const testDir = await mkdtemp(join(tmpdir(), 'claude-complex-'));
    
    try {
      process.chdir(testDir);
      
      // Initialize git repository
      await execCommand('git', ['init'], testDir);
      await execCommand('git', ['config', 'user.name', 'Complex Test'], testDir);
      await execCommand('git', ['config', 'user.email', 'complex@test.com'], testDir);
      
      // Create initial commit
      await writeFile(join(testDir, 'README.md'), '# Complex Evolution Test\n\nTesting complex code evolution with 6 commits.\n');
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
      
      // Create GitHub repository
      const createRepoResult = await execCommand('gh', ['repo', 'create', testRepoName, '--public', '--source', '.', '--push'], testDir);
      expect(createRepoResult.code).toBe(0);
      
      // Initialize claude-was-here with UPDATED scripts
      const cliPath = join(originalCwd, 'dist', 'cli.js');
      const initResult = await execCommand('bun', [cliPath, 'init'], testDir);
      expect(initResult.code).toBe(0);
      
      // Install GitHub Actions (this will use the UPDATED scripts without --first-parent)
      const installActionsResult = await execCommand('bun', [cliPath, 'install-github-actions'], testDir);
      expect(installActionsResult.code).toBe(0);
      
      await execCommand('git', ['add', '.github/'], testDir);
      await execCommand('git', ['commit', '-m', 'Add GitHub Actions with fixed consolidation'], testDir);
      await execCommand('git', ['push'], testDir);
      
      // Create feature branch and src directory
      await execCommand('git', ['checkout', '-b', 'feature/evolution'], testDir);
      await execCommand('mkdir', ['-p', 'src'], testDir);
      
      console.log('\n📝 Starting complex evolution with 6 commits...\n');
      
      // ========== COMMIT 1: Claude creates UserService ==========
      console.log('📦 Commit 1: Claude creates UserService');
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/UserService.ts',
        content: `export class UserService {
  private users: Map<string, any> = new Map();
  
  create(name: string): string {
    const id = Math.random().toString(36);
    this.users.set(id, { id, name });
    return id;
  }
  
  get(id: string): any {
    return this.users.get(id);
  }
}
`,
        task: 'Create UserService',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add UserService'], testDir);
      
      // ========== COMMIT 2: Human adds validation ==========
      console.log('📦 Commit 2: Human adds validation');
      await writeAsHuman({
        cwd: testDir,
        filePath: 'src/validation.ts',
        content: `export const isValidName = (name: string): boolean => {
  return name.length >= 2 && name.length <= 50;
};
`
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add validation'], testDir);
      
      // ========== COMMIT 3: Claude modifies UserService (mutation) ==========
      console.log('📦 Commit 3: Claude adds validation to UserService');
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/UserService.ts',
        content: `import { isValidName } from './validation';

export class UserService {
  private users: Map<string, any> = new Map();
  
  create(name: string): string {
    if (!isValidName(name)) {
      throw new Error('Invalid name');
    }
    const id = Math.random().toString(36);
    this.users.set(id, { id, name, created: new Date() });
    return id;
  }
  
  get(id: string): any {
    return this.users.get(id);
  }
  
  delete(id: string): boolean {
    return this.users.delete(id);
  }
}
`,
        task: 'Add validation and delete method',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Update UserService'], testDir);
      
      // ========== COMMIT 4: Human adds config ==========
      console.log('📦 Commit 4: Human adds config');
      await writeAsHuman({
        cwd: testDir,
        filePath: 'src/config.ts',
        content: `export const config = { maxUsers: 100 };
`
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add config'], testDir);
      
      // ========== COMMIT 5: Claude refactors with deletions and additions ==========
      console.log('📦 Commit 5: Claude refactors UserService');
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/UserService.ts',
        content: `import { isValidName } from './validation';
import { config } from './config';

interface User {
  id: string;
  name: string;
  created: Date;
}

export class UserService {
  private users: Map<string, User> = new Map();
  
  create(name: string): string {
    if (this.users.size >= config.maxUsers) {
      throw new Error('User limit reached');
    }
    if (!isValidName(name)) {
      throw new Error('Invalid name');
    }
    
    const id = Math.random().toString(36);
    const user: User = { id, name, created: new Date() };
    this.users.set(id, user);
    return id;
  }
  
  get(id: string): User | undefined {
    return this.users.get(id);
  }
  
  getAll(): User[] {
    return Array.from(this.users.values());
  }
  
  clear(): void {
    this.users.clear();
  }
}
`,
        task: 'Refactor with types and new methods',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Refactor UserService'], testDir);
      
      // ========== COMMIT 6: Mixed - Human adds test setup, Claude adds tests ==========
      console.log('📦 Commit 6: Mixed test file');
      
      // Human writes the test setup
      await writeAsHuman({
        cwd: testDir,
        filePath: 'src/UserService.test.ts',
        content: `import { describe, test, expect } from 'bun:test';
import { UserService } from './UserService';

`
      });
      
      // Claude adds the actual tests
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/UserService.test.ts',
        content: `import { describe, test, expect } from 'bun:test';
import { UserService } from './UserService';

describe('UserService', () => {
  test('creates user with valid name', () => {
    const service = new UserService();
    const id = service.create('John');
    expect(id).toBeDefined();
    expect(service.get(id)?.name).toBe('John');
  });
  
  test('rejects invalid name', () => {
    const service = new UserService();
    expect(() => service.create('x')).toThrow('Invalid name');
  });
  
  test('enforces user limit', () => {
    const service = new UserService();
    for (let i = 0; i < 100; i++) {
      service.create(\`User\${i}\`);
    }
    expect(() => service.create('Extra')).toThrow('User limit reached');
  });
});
`,
        task: 'Add test suite',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add tests'], testDir);
      
      // Push and create PR
      await execCommand('git', ['push', '--set-upstream', 'origin', 'feature/evolution'], testDir);
      
      const prResult = await execCommand('gh', ['pr', 'create', 
        '--title', 'Complex evolution',
        '--body', '6 commits with various changes'
      ], testDir);
      expect(prResult.code).toBe(0);
      
      const prUrl = prResult.stdout;
      const prNumber = prUrl.split('/').pop();
      
      // Wait for GitHub Actions
      console.log('\n⏳ Waiting for GitHub Actions...');
      await new Promise(resolve => setTimeout(resolve, 25000));
      
      // Merge the PR (keeping the branch for inspection)
      console.log('\n🔀 Merging PR with squash...');
      const mergeResult = await execCommand('gh', ['pr', 'merge', prNumber!, '--squash'], testDir);
      expect(mergeResult.code).toBe(0);
      
      // Wait for post-merge workflow
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      // Check merged result
      await execCommand('git', ['checkout', 'master'], testDir);
      await execCommand('git', ['pull'], testDir);
      
      const mergeHash = (await execCommand('git', ['rev-parse', 'HEAD'], testDir)).stdout;
      const notesResult = await execCommand('git', ['notes', 'show', mergeHash], testDir);
      
      console.log('\n📊 Final consolidated notes:');
      if (notesResult.code === 0) {
        console.log(notesResult.stdout);
        
        const lines = notesResult.stdout.split('\n');
        const trackedFiles = lines.filter(l => l.includes(':') && !l.includes('claude-was-here') && !l.includes('version'));
        
        console.log('\n📋 Files with Claude authorship:');
        trackedFiles.forEach(file => {
          console.log(`  ${file}`);
        });
        
        // Verify at least one Claude file is tracked
        expect(notesResult.stdout).toContain('UserService.ts');
        expect(notesResult.stdout).toContain('UserService.test.ts');
        
        // Human files should not be tracked
        expect(notesResult.stdout).not.toContain('validation.ts');
        expect(notesResult.stdout).not.toContain('config.ts');

        // Verify expected line attribution.
        const aiAuthoredRanges = {
          'UserService.ts': parseLineRangesFromNotes(notesResult.stdout, 'src/UserService.ts'),
          'UserService.test.ts': parseLineRangesFromNotes(notesResult.stdout, 'src/UserService.test.ts')
        }

        expect(aiAuthoredRanges['UserService.ts']).toEqual([
          // TODO: line range expectations.
        ])
        
        console.log('✅ Both Claude contributions properly consolidated');
      }
      
      // Run stats
      console.log('\n📈 Running stats...');
      const statsResult = await execCommand('bun', [cliPath, 'stats'], testDir);
      if (statsResult.code === 0) {
        console.log(statsResult.stdout);
        expect(statsResult.stdout).toContain('UserService.ts');
        expect(statsResult.stdout).toContain('UserService.test.ts');
        expect(statsResult.stdout).not.toContain('validation.ts');
        expect(statsResult.stdout).not.toContain('config.ts');
        console.log('✅ Stats correctly show both Claude-authored files');
      }
      
      const whoAmI = await execCommand('gh', ['api', 'user'], testDir);
      const user = whoAmI.code === 0 ? JSON.parse(whoAmI.stdout) : { login: 'unknown' };
      console.log(`\n✅ Complex evolution test completed`);
      console.log(`📝 Repository: https://github.com/${user.login}/${testRepoName}`);
      
    } finally {
      process.chdir(originalCwd);
      await rm(testDir, { recursive: true, force: true });
    }
  }, 180000);
});