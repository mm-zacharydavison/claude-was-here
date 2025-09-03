import { test, expect, describe } from 'bun:test';
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execCommand } from '../helpers/exec.ts';
import { writeAsHuman, writeAsClaude, createMixedCommit } from './helpers/code-authoring.ts';

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
  return `claude-multi-pr-${timestamp}-${random}`;
};

describe('Multiple PR Series Test', () => {
  test('handles 3 separate PRs with mixed authorship', async () => {
    const ghAvailable = await isGhCliAvailable();
    if (!ghAvailable) {
      console.log('⏭️  Skipping test - GitHub CLI not available');
      return;
    }

    const originalCwd = process.cwd();
    const testRepoName = generateRepoName();
    const testDir = await mkdtemp(join(tmpdir(), 'claude-multi-pr-'));
    
    try {
      process.chdir(testDir);
      
      // Initialize git repository
      await execCommand('git', ['init'], testDir);
      await execCommand('git', ['config', 'user.name', 'Multi PR Test'], testDir);
      await execCommand('git', ['config', 'user.email', 'multi-pr@test.com'], testDir);
      
      // Create initial commit
      await writeFile(join(testDir, 'README.md'), '# Multiple PR Test\n\nTesting series of PRs with mixed authorship.\n');
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Initial commit'], testDir);
      
      // Create GitHub repository
      const createRepoResult = await execCommand('gh', ['repo', 'create', testRepoName, '--public', '--source', '.', '--push'], testDir);
      expect(createRepoResult.code).toBe(0);
      
      // Initialize claude-was-here
      const cliPath = join(originalCwd, 'dist', 'cli.js');
      const initResult = await execCommand('bun', [cliPath, 'init'], testDir);
      expect(initResult.code).toBe(0);
      
      // Install GitHub Actions
      const installActionsResult = await execCommand('bun', [cliPath, 'install-github-actions'], testDir);
      expect(installActionsResult.code).toBe(0);
      
      await execCommand('git', ['add', '.github/'], testDir);
      await execCommand('git', ['commit', '-m', 'Add GitHub Actions'], testDir);
      await execCommand('git', ['push'], testDir);
      
      // Create src directory
      await execCommand('mkdir', ['-p', 'src'], testDir);
      
      console.log('\n🚀 Starting Multiple PR Test with 3 PRs...\n');
      
      // ============================================================================
      // PR 1: Add basic service with mixed AI/Human authorship
      // ============================================================================
      console.log('📦 PR 1: Creating basic service with mixed authorship');
      await execCommand('git', ['checkout', '-b', 'feature/basic-service'], testDir);
      
      // Commit 1.1: Human creates interface
      console.log('  📝 Commit 1.1: Human creates interface');
      await writeAsHuman({
        cwd: testDir,
        filePath: 'src/types.ts',
        content: `export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface CreateUserRequest {
  name: string;
  email: string;
}
`
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add user types'], testDir);
      
      // Commit 1.2: Claude creates service implementation
      console.log('  📝 Commit 1.2: Claude creates service');
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/UserService.ts',
        content: `import { User, CreateUserRequest } from './types';

export class UserService {
  private users: Map<string, User> = new Map();
  private counter = 0;

  create(request: CreateUserRequest): User {
    const user: User = {
      id: \`user-\${++this.counter}\`,
      name: request.name,
      email: request.email,
      createdAt: new Date()
    };
    
    this.users.set(user.id, user);
    return user;
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return undefined;
  }

  getAll(): User[] {
    return Array.from(this.users.values());
  }
}
`,
        task: 'Implement UserService class',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add UserService implementation'], testDir);
      
      // Commit 1.3: Mixed commit - Human adds validation, Claude adds error handling
      console.log('  📝 Commit 1.3: Mixed validation and error handling');
      
      await createMixedCommit({
        cwd: testDir,
        cliPath,
        humanChanges: [{
          filePath: 'src/validation.ts',
          content: `export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validateName = (name: string): boolean => {
  return name.trim().length >= 2 && name.trim().length <= 100;
};
`,
          description: 'Human adds validation utilities'
        }],
        claudeChanges: [{
          filePath: 'src/UserService.ts',
          content: `import { User, CreateUserRequest } from './types';
import { validateEmail, validateName } from './validation';

export class UserService {
  private users: Map<string, User> = new Map();
  private counter = 0;

  create(request: CreateUserRequest): User {
    if (!validateName(request.name)) {
      throw new Error('Invalid name: must be 2-100 characters');
    }
    
    if (!validateEmail(request.email)) {
      throw new Error('Invalid email format');
    }
    
    if (this.findByEmail(request.email)) {
      throw new Error('Email already exists');
    }

    const user: User = {
      id: \`user-\${++this.counter}\`,
      name: request.name.trim(),
      email: request.email.toLowerCase(),
      createdAt: new Date()
    };
    
    this.users.set(user.id, user);
    return user;
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    for (const user of this.users.values()) {
      if (user.email === email.toLowerCase()) {
        return user;
      }
    }
    return undefined;
  }

  getAll(): User[] {
    return Array.from(this.users.values());
  }
}
`,
          task: 'Add validation and error handling to UserService'
        }],
        commitMessage: 'Add validation and error handling'
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add validation and error handling'], testDir);
      
      // Push and create PR 1
      await execCommand('git', ['push', '--set-upstream', 'origin', 'feature/basic-service'], testDir);
      const pr1Result = await execCommand('gh', ['pr', 'create', 
        '--title', 'Add basic user service',
        '--body', 'Initial user service with mixed authorship'
      ], testDir);
      expect(pr1Result.code).toBe(0);
      
      const pr1Number = pr1Result.stdout.split('/').pop();
      console.log(`  ✅ PR 1 created: ${pr1Number}`);
      
      // Wait for GitHub Actions and merge PR 1
      console.log('  ⏳ Waiting for GitHub Actions...');
      await new Promise(resolve => setTimeout(resolve, 25000));
      
      console.log('  🔀 Merging PR 1 (keeping branch for inspection)...');
      const merge1Result = await execCommand('gh', ['pr', 'merge', pr1Number!, '--squash'], testDir);
      expect(merge1Result.code).toBe(0);
      
      await new Promise(resolve => setTimeout(resolve, 15000));
      await execCommand('git', ['checkout', 'master'], testDir);
      await execCommand('git', ['pull'], testDir);
      
      // ============================================================================
      // PR 2: Modify and delete lines with AI
      // ============================================================================
      console.log('\n📦 PR 2: Modifying and deleting lines with AI');
      await execCommand('git', ['checkout', '-b', 'feature/service-updates'], testDir);
      
      // Commit 2.1: Claude refactors UserService (modifications and deletions)
      console.log('  📝 Commit 2.1: Claude refactors UserService');
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/UserService.ts',
        content: `import { User, CreateUserRequest } from './types';
import { validateEmail, validateName } from './validation';

export interface UserServiceConfig {
  maxUsers: number;
  allowDuplicateNames: boolean;
}

export class UserService {
  private users: Map<string, User> = new Map();
  private counter = 0;
  private config: UserServiceConfig;

  constructor(config: UserServiceConfig = { maxUsers: 1000, allowDuplicateNames: true }) {
    this.config = config;
  }

  create(request: CreateUserRequest): User {
    if (this.users.size >= this.config.maxUsers) {
      throw new Error(\`Maximum users limit reached (\${this.config.maxUsers})\`);
    }
    
    if (!validateName(request.name)) {
      throw new Error('Invalid name: must be 2-100 characters');
    }
    
    if (!validateEmail(request.email)) {
      throw new Error('Invalid email format');
    }
    
    if (this.findByEmail(request.email)) {
      throw new Error('Email already exists');
    }

    if (!this.config.allowDuplicateNames && this.findByName(request.name.trim())) {
      throw new Error('Name already exists');
    }

    const user: User = {
      id: \`user-\${++this.counter}\`,
      name: request.name.trim(),
      email: request.email.toLowerCase(),
      createdAt: new Date()
    };
    
    this.users.set(user.id, user);
    return user;
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    return Array.from(this.users.values())
      .find(user => user.email === email.toLowerCase());
  }
  
  findByName(name: string): User | undefined {
    return Array.from(this.users.values())
      .find(user => user.name === name);
  }

  getAll(): User[] {
    return Array.from(this.users.values())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  
  delete(id: string): boolean {
    return this.users.delete(id);
  }
  
  clear(): void {
    this.users.clear();
    this.counter = 0;
  }
  
  getStats() {
    return {
      total: this.users.size,
      maxUsers: this.config.maxUsers,
      allowDuplicateNames: this.config.allowDuplicateNames
    };
  }
}
`,
        task: 'Refactor UserService with config, new methods, and optimizations',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Refactor UserService with configuration'], testDir);
      
      // Commit 2.2: Claude removes validation.ts and integrates inline
      console.log('  📝 Commit 2.2: Claude removes validation file');
      await execCommand('git', ['rm', 'src/validation.ts'], testDir);
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/UserService.ts',
        content: `import { User, CreateUserRequest } from './types';

// Inline validation utilities
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateName = (name: string): boolean => {
  return name.trim().length >= 2 && name.trim().length <= 100;
};

export interface UserServiceConfig {
  maxUsers: number;
  allowDuplicateNames: boolean;
}

export class UserService {
  private users: Map<string, User> = new Map();
  private counter = 0;
  private config: UserServiceConfig;

  constructor(config: UserServiceConfig = { maxUsers: 1000, allowDuplicateNames: true }) {
    this.config = config;
  }

  create(request: CreateUserRequest): User {
    if (this.users.size >= this.config.maxUsers) {
      throw new Error(\`Maximum users limit reached (\${this.config.maxUsers})\`);
    }
    
    if (!validateName(request.name)) {
      throw new Error('Invalid name: must be 2-100 characters');
    }
    
    if (!validateEmail(request.email)) {
      throw new Error('Invalid email format');
    }
    
    if (this.findByEmail(request.email)) {
      throw new Error('Email already exists');
    }

    if (!this.config.allowDuplicateNames && this.findByName(request.name.trim())) {
      throw new Error('Name already exists');
    }

    const user: User = {
      id: \`user-\${++this.counter}\`,
      name: request.name.trim(),
      email: request.email.toLowerCase(),
      createdAt: new Date()
    };
    
    this.users.set(user.id, user);
    return user;
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    return Array.from(this.users.values())
      .find(user => user.email === email.toLowerCase());
  }
  
  findByName(name: string): User | undefined {
    return Array.from(this.users.values())
      .find(user => user.name === name);
  }

  getAll(): User[] {
    return Array.from(this.users.values())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  
  delete(id: string): boolean {
    return this.users.delete(id);
  }
  
  clear(): void {
    this.users.clear();
    this.counter = 0;
  }
  
  getStats() {
    return {
      total: this.users.size,
      maxUsers: this.config.maxUsers,
      allowDuplicateNames: this.config.allowDuplicateNames
    };
  }
}
`,
        task: 'Inline validation and remove separate validation file',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Inline validation and remove separate file'], testDir);
      
      // Push and create PR 2
      await execCommand('git', ['push', '--set-upstream', 'origin', 'feature/service-updates'], testDir);
      const pr2Result = await execCommand('gh', ['pr', 'create', 
        '--title', 'Update user service with config and optimizations',
        '--body', 'AI-driven refactoring with modifications and deletions'
      ], testDir);
      expect(pr2Result.code).toBe(0);
      
      const pr2Number = pr2Result.stdout.split('/').pop();
      console.log(`  ✅ PR 2 created: ${pr2Number}`);
      
      // Wait for GitHub Actions and merge PR 2
      console.log('  ⏳ Waiting for GitHub Actions...');
      await new Promise(resolve => setTimeout(resolve, 25000));
      
      console.log('  🔀 Merging PR 2 (keeping branch for inspection)...');
      const merge2Result = await execCommand('gh', ['pr', 'merge', pr2Number!, '--squash'], testDir);
      expect(merge2Result.code).toBe(0);
      
      await new Promise(resolve => setTimeout(resolve, 15000));
      await execCommand('git', ['checkout', 'master'], testDir);
      await execCommand('git', ['pull'], testDir);
      
      // ============================================================================
      // PR 3: Mixed human and AI additions and modifications
      // ============================================================================
      console.log('\n📦 PR 3: Mixed human and AI additions and modifications');
      await execCommand('git', ['checkout', '-b', 'feature/tests-and-docs'], testDir);
      
      // Commit 3.1: Human adds documentation
      console.log('  📝 Commit 3.1: Human adds documentation');
      await writeAsHuman({
        cwd: testDir,
        filePath: 'src/UserService.md',
        content: `# UserService Documentation

## Overview

The UserService class provides user management functionality with configurable options.

## Configuration

- \`maxUsers\`: Maximum number of users allowed (default: 1000)
- \`allowDuplicateNames\`: Whether duplicate names are allowed (default: true)

## Methods

- \`create(request)\`: Create a new user
- \`findById(id)\`: Find user by ID
- \`findByEmail(email)\`: Find user by email
- \`findByName(name)\`: Find user by name
- \`getAll()\`: Get all users (sorted by creation date)
- \`delete(id)\`: Delete a user
- \`clear()\`: Remove all users
- \`getStats()\`: Get service statistics
`
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add UserService documentation'], testDir);
      
      // Commit 3.2: Claude adds comprehensive tests
      console.log('  📝 Commit 3.2: Claude adds tests');
      await writeAsClaude({
        cwd: testDir,
        filePath: 'src/UserService.test.ts',
        content: `import { describe, test, expect, beforeEach } from 'bun:test';
import { UserService } from './UserService';
import type { CreateUserRequest } from './types';

describe('UserService', () => {
  let service: UserService;
  
  beforeEach(() => {
    service = new UserService();
  });
  
  describe('create', () => {
    test('creates user with valid data', () => {
      const request: CreateUserRequest = {
        name: 'John Doe',
        email: 'john@example.com'
      };
      
      const user = service.create(request);
      expect(user.id).toMatch(/^user-\\d+$/);
      expect(user.name).toBe('John Doe');
      expect(user.email).toBe('john@example.com');
      expect(user.createdAt).toBeInstanceOf(Date);
    });
    
    test('normalizes email to lowercase', () => {
      const user = service.create({
        name: 'John Doe',
        email: 'JOHN@EXAMPLE.COM'
      });
      expect(user.email).toBe('john@example.com');
    });
    
    test('trims whitespace from name', () => {
      const user = service.create({
        name: '  John Doe  ',
        email: 'john@example.com'
      });
      expect(user.name).toBe('John Doe');
    });
    
    test('rejects invalid email', () => {
      expect(() => service.create({
        name: 'John Doe',
        email: 'invalid-email'
      })).toThrow('Invalid email format');
    });
    
    test('rejects invalid name', () => {
      expect(() => service.create({
        name: 'x',
        email: 'john@example.com'
      })).toThrow('Invalid name: must be 2-100 characters');
    });
    
    test('rejects duplicate email', () => {
      service.create({ name: 'John', email: 'john@example.com' });
      expect(() => service.create({
        name: 'Jane',
        email: 'john@example.com'
      })).toThrow('Email already exists');
    });
    
    test('respects maxUsers limit', () => {
      const limitedService = new UserService({ maxUsers: 2, allowDuplicateNames: true });
      limitedService.create({ name: 'User 1', email: 'user1@example.com' });
      limitedService.create({ name: 'User 2', email: 'user2@example.com' });
      
      expect(() => limitedService.create({
        name: 'User 3',
        email: 'user3@example.com'
      })).toThrow('Maximum users limit reached (2)');
    });
  });
  
  describe('finding users', () => {
    beforeEach(() => {
      service.create({ name: 'John Doe', email: 'john@example.com' });
      service.create({ name: 'Jane Smith', email: 'jane@example.com' });
    });
    
    test('finds user by email', () => {
      const user = service.findByEmail('john@example.com');
      expect(user?.name).toBe('John Doe');
    });
    
    test('finds user by name', () => {
      const user = service.findByName('Jane Smith');
      expect(user?.email).toBe('jane@example.com');
    });
    
    test('returns undefined for non-existent user', () => {
      expect(service.findByEmail('nonexistent@example.com')).toBeUndefined();
      expect(service.findByName('Nonexistent')).toBeUndefined();
    });
  });
  
  describe('user management', () => {
    test('deletes user successfully', () => {
      const user = service.create({ name: 'John', email: 'john@example.com' });
      expect(service.delete(user.id)).toBe(true);
      expect(service.findById(user.id)).toBeUndefined();
    });
    
    test('returns false when deleting non-existent user', () => {
      expect(service.delete('non-existent')).toBe(false);
    });
    
    test('clears all users', () => {
      service.create({ name: 'User 1', email: 'user1@example.com' });
      service.create({ name: 'User 2', email: 'user2@example.com' });
      
      service.clear();
      expect(service.getAll()).toHaveLength(0);
      expect(service.getStats().total).toBe(0);
    });
  });
  
  describe('getStats', () => {
    test('returns correct statistics', () => {
      const stats = service.getStats();
      expect(stats.total).toBe(0);
      expect(stats.maxUsers).toBe(1000);
      expect(stats.allowDuplicateNames).toBe(true);
    });
  });
});
`,
        task: 'Create comprehensive test suite for UserService',
        cliPath
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add comprehensive UserService tests'], testDir);
      
      // Commit 3.3: Mixed commit - Human adds config file, Claude updates types
      console.log('  📝 Commit 3.3: Mixed configuration updates');
      await createMixedCommit({
        cwd: testDir,
        cliPath,
        humanChanges: [{
          filePath: 'src/config.ts',
          content: `export const DEFAULT_CONFIG = {
  maxUsers: 1000,
  allowDuplicateNames: true,
  emailDomainWhitelist: [] as string[],
  requireEmailVerification: false
} as const;

export type AppConfig = typeof DEFAULT_CONFIG;
`,
          description: 'Human adds configuration constants'
        }],
        claudeChanges: [{
          filePath: 'src/types.ts',
          content: `export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  isEmailVerified?: boolean;
  lastLoginAt?: Date;
}

export interface CreateUserRequest {
  name: string;
  email: string;
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
}

export interface UserSearchFilters {
  nameContains?: string;
  emailContains?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  isEmailVerified?: boolean;
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}
`,
          task: 'Extend types with additional interfaces for advanced features'
        }],
        commitMessage: 'Add configuration and extend type definitions'
      });
      await execCommand('git', ['add', '.'], testDir);
      await execCommand('git', ['commit', '-m', 'Add configuration and extend type definitions'], testDir);
      
      // Push and create PR 3
      await execCommand('git', ['push', '--set-upstream', 'origin', 'feature/tests-and-docs'], testDir);
      const pr3Result = await execCommand('gh', ['pr', 'create', 
        '--title', 'Add tests, documentation and extended configuration',
        '--body', 'Mixed human and AI contributions for testing and documentation'
      ], testDir);
      expect(pr3Result.code).toBe(0);
      
      const pr3Number = pr3Result.stdout.split('/').pop();
      console.log(`  ✅ PR 3 created: ${pr3Number}`);
      
      // Wait for GitHub Actions and merge PR 3
      console.log('  ⏳ Waiting for GitHub Actions...');
      await new Promise(resolve => setTimeout(resolve, 25000));
      
      console.log('  🔀 Merging PR 3 (keeping branch for inspection)...');
      const merge3Result = await execCommand('gh', ['pr', 'merge', pr3Number!, '--squash'], testDir);
      expect(merge3Result.code).toBe(0);
      
      await new Promise(resolve => setTimeout(resolve, 15000));
      await execCommand('git', ['checkout', 'master'], testDir);
      await execCommand('git', ['pull'], testDir);
      
      // ============================================================================
      // Verification: Check final authorship data in notes
      // ============================================================================
      console.log('\n🔍 Verifying final authorship data in git notes...');
      
      const commitsResult = await execCommand('git', ['log', '--oneline', '-10'], testDir);
      console.log('Recent commits:');
      console.log(commitsResult.stdout);
      
      const logResult = await execCommand('git', ['log', '--format=%H', '-5'], testDir);
      const commitHashes = logResult.stdout.trim().split('\n');
      
      console.log('\n📊 Checking notes for each squash commit:');
      const allNotes: string[] = [];
      
      for (let i = 0; i < Math.min(3, commitHashes.length); i++) {
        const hash = commitHashes[i];
        const shortHash = hash.substring(0, 7);
        const notesResult = await execCommand('git', ['notes', 'show', hash], testDir);
        
        if (notesResult.code === 0) {
          console.log(`\\n📝 Notes for ${shortHash}:`);
          console.log(notesResult.stdout);
          allNotes.push(notesResult.stdout);
        } else {
          console.log(`\\n📝 No notes found for ${shortHash}`);
        }
      }
      
      // Verify Claude authorship tracking
      const allNotesText = allNotes.join('\n');
      
      // Files that should have Claude authorship:
      expect(allNotesText).toContain('UserService.ts'); // Claude created and modified
      expect(allNotesText).toContain('UserService.test.ts'); // Claude created tests
      expect(allNotesText).toContain('types.ts'); // Claude modified types
      
      // Files that should NOT have Claude authorship (human-only):
      expect(allNotesText).not.toContain('UserService.md'); // Human documentation
      expect(allNotesText).not.toContain('config.ts'); // Human config file
      
      console.log('\\n✅ Verification Results:');
      console.log('- UserService.ts: Claude authorship tracked ✓');
      console.log('- UserService.test.ts: Claude authorship tracked ✓');  
      console.log('- types.ts: Claude authorship tracked ✓');
      console.log('- UserService.md: Human-only (not tracked) ✓');
      console.log('- config.ts: Human-only (not tracked) ✓');
      
      // Run final stats
      console.log('\\n📈 Final stats across all PRs:');
      const statsResult = await execCommand('bun', [cliPath, 'stats'], testDir);
      if (statsResult.code === 0) {
        console.log(statsResult.stdout);
        
        // Verify expected files appear in stats
        expect(statsResult.stdout).toContain('UserService.ts');
        expect(statsResult.stdout).toContain('UserService.test.ts');
        expect(statsResult.stdout).toContain('types.ts');
        
        // Human-only files should not appear
        expect(statsResult.stdout).not.toContain('UserService.md');
        expect(statsResult.stdout).not.toContain('config.ts');
      }
      
      const whoAmI = await execCommand('gh', ['api', 'user'], testDir);
      const user = whoAmI.code === 0 ? JSON.parse(whoAmI.stdout) : { login: 'unknown' };
      console.log(`\\n✅ Multiple PR series test completed successfully!`);
      console.log(`📝 Repository: https://github.com/${user.login}/${testRepoName}`);
      
    } finally {
      process.chdir(originalCwd);
      await rm(testDir, { recursive: true, force: true });
    }
  }, 300000); // 5 minute timeout for multiple PRs
});