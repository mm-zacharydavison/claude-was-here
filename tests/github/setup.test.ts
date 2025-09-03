import { test, expect, describe } from 'bun:test';
import { execCommand } from '../helpers/exec.ts';

// Helper functions for GitHub CLI testing
export const isGhCliAvailable = async (): Promise<boolean> => {
  try {
    const result = await execCommand('gh', ['--version'], process.cwd());
    return result.code === 0;
  } catch {
    return false;
  }
};

export const isGhAuthenticated = async (): Promise<boolean> => {
  try {
    const result = await execCommand('gh', ['auth', 'status'], process.cwd());
    return result.code === 0;
  } catch {
    return false;
  }
};

export const getCurrentGhUser = async (): Promise<string | null> => {
  try {
    const result = await execCommand('gh', ['api', 'user'], process.cwd());
    if (result.code === 0) {
      const user = JSON.parse(result.stdout);
      return user.login;
    }
  } catch {
    // Ignore
  }
  return null;
};

describe('GitHub CLI Setup', () => {
  test('WILL check if GitHub CLI is available', async () => {
    const isAvailable = await isGhCliAvailable();
    
    if (!isAvailable) {
      console.log('⚠️  GitHub CLI not found. To install:');
      console.log('   - macOS: brew install gh');
      console.log('   - Ubuntu/Debian: apt install gh');
      console.log('   - Other: https://cli.github.com/');
      console.log('   GitHub E2E tests will be skipped.');
    } else {
      console.log('✅ GitHub CLI is available');
      
      // If available, check version
      const versionResult = await execCommand('gh', ['--version'], process.cwd());
      console.log(`   Version: ${versionResult.stdout.split('\n')[0]}`);
    }
    
    // This test passes regardless of availability - it's informational
    expect(true).toBe(true);
  });

  test('WILL check GitHub CLI authentication status', async () => {
    const cliAvailable = await isGhCliAvailable();
    
    if (!cliAvailable) {
      console.log('⏭️  Skipping auth check - GitHub CLI not available');
      return;
    }
    
    const isAuthenticated = await isGhAuthenticated();
    
    if (!isAuthenticated) {
      console.log('⚠️  GitHub CLI not authenticated. To authenticate:');
      console.log('   gh auth login');
      console.log('   GitHub E2E tests will be skipped.');
    } else {
      console.log('✅ GitHub CLI is authenticated');
      
      const user = await getCurrentGhUser();
      if (user) {
        console.log(`   Authenticated as: ${user}`);
      }
    }
    
    // This test passes regardless of authentication - it's informational
    expect(true).toBe(true);
  });

  test('WILL verify GitHub API access', async () => {
    const cliAvailable = await isGhCliAvailable();
    const authenticated = await isGhAuthenticated();
    
    if (!cliAvailable || !authenticated) {
      console.log('⏭️  Skipping GitHub API test - CLI not available or not authenticated');
      return;
    }
    // Test basic API access
    const userResult = await execCommand('gh', ['api', 'user'], process.cwd());
    expect(userResult.code).toBe(0);
    
    const user = JSON.parse(userResult.stdout);
    expect(user.login).toBeDefined();
    expect(typeof user.login).toBe('string');
    expect(user.login.length).toBeGreaterThan(0);
    
    // Test that we can list repositories (should work even if empty)
    const reposResult = await execCommand('gh', ['api', 'user/repos', '--paginate'], process.cwd());
    expect(reposResult.code).toBe(0);
    
    // Should return valid JSON (array)
    const repos = JSON.parse(reposResult.stdout);
    expect(Array.isArray(repos)).toBe(true);
    
    console.log(`✅ GitHub API access verified for user: ${user.login}`);
    console.log(`   Found ${repos.length} repositories`);
  });
});

describe('GitHub CLI Operations', () => {
  test('WILL test repository creation and deletion (dry run)', async () => {
    const cliAvailable = await isGhCliAvailable();
    const authenticated = await isGhAuthenticated();
    
    if (!cliAvailable || !authenticated) {
      console.log('⏭️  Skipping CLI operations test - CLI not available or not authenticated');
      return;
    }
    // This test verifies the GitHub CLI commands work without actually creating a repository
    
    // Test help command for repo create (should always work)
    const createHelpResult = await execCommand('gh', ['repo', 'create', '--help'], process.cwd());
    expect(createHelpResult.code).toBe(0);
    expect(createHelpResult.stdout).toContain('Create a new GitHub repository');
    
    // Test help command for repo delete (should always work)
    const deleteHelpResult = await execCommand('gh', ['repo', 'delete', '--help'], process.cwd());
    expect(deleteHelpResult.code).toBe(0);
    expect(deleteHelpResult.stdout).toContain('Delete a GitHub repository');
    
    // Test PR creation help
    const prHelpResult = await execCommand('gh', ['pr', 'create', '--help'], process.cwd());
    expect(prHelpResult.code).toBe(0);
    expect(prHelpResult.stdout).toContain('Create a pull request');
    
    // Test workflow run listing help
    const runHelpResult = await execCommand('gh', ['run', 'list', '--help'], process.cwd());
    expect(runHelpResult.code).toBe(0);
    expect(runHelpResult.stdout).toContain('List recent workflow runs');
    
    console.log('✅ All required GitHub CLI commands are available');
  });
});

// Export helper functions for use in other tests
export { execCommand };