#!/usr/bin/env bun

/**
 * Cleanup script for E2E test repositories
 * Lists and optionally deletes test repositories created by GitHub E2E tests
 */

import { $ } from 'bun';

interface Repository {
  name: string;
  full_name: string;
  created_at: string;
  html_url: string;
}

async function isGhCliAvailable(): Promise<boolean> {
  try {
    const result = await $`gh --version`.nothrow().quiet();
    if (result.exitCode !== 0) return false;
    
    // Check if authenticated
    const authResult = await $`gh auth status`.nothrow().quiet();
    return authResult.exitCode === 0;
  } catch {
    return false;
  }
}

async function checkDeletePermissions(): Promise<boolean> {
  try {
    // Try to check current scopes by attempting to list a user's repositories
    // This is a simple test - the real test will be when we try to delete
    const result = await $`gh api user`.nothrow().quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function getTestRepositories(): Promise<Repository[]> {
  try {
    // Use gh repo list which is simpler and more reliable than the API
    const result = await $`gh repo list --limit 1000`.nothrow();
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list repositories: ${result.stderr}`);
    }
    
    // Parse the tab-separated output from gh repo list
    const lines = result.stdout.toString().trim().split('\n');
    const repos: Repository[] = [];
    
    for (const line of lines) {
      if (line.trim()) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const [full_name, description, visibility] = parts;
          const name = full_name.split('/')[1];
          
          // Create a simplified Repository object
          repos.push({
            name,
            full_name,
            created_at: new Date().toISOString(), // We don't have this from gh repo list
            html_url: `https://github.com/${full_name}`
          });
        }
      }
    }
    
    // Filter for E2E test repositories - catch all test naming patterns
    return repos.filter(repo => 
      // Legacy patterns
      repo.name.startsWith('claude-was-here-e2e-test-') ||
      repo.name.includes('claude-was-here-e2e') ||
      // Current test patterns
      repo.name.startsWith('claude-complex-test-') ||
      repo.name.startsWith('claude-multi-commit-') ||
      repo.name.startsWith('claude-fixed-consolidation-') ||
      repo.name.startsWith('claude-complex-') ||
      repo.name.startsWith('claude-was-here-basic-') ||
      // General pattern - any repo with timestamp suffix that looks like a test
      (repo.name.startsWith('claude-') && /\d{13}-\w{6,7}$/.test(repo.name))
    ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
  } catch (error) {
    throw new Error(`Failed to fetch repositories: ${error}`);
  }
}

async function confirmDeletion(repos: Repository[]): Promise<boolean> {
  if (repos.length === 0) {
    console.log('✅ No test repositories found to cleanup.');
    return false;
  }

  console.log(`\n📋 Found ${repos.length} test repositories to cleanup:`);
  console.log('=' + '='.repeat(80));
  
  repos.forEach((repo, i) => {
    const createdAt = new Date(repo.created_at).toLocaleString();
    console.log(`${i + 1}. ${repo.full_name}`);
    console.log(`   Created: ${createdAt}`);
    console.log(`   URL: ${repo.html_url}`);
    console.log('');
  });

  console.log('⚠️  This will permanently delete these repositories and all their data.');
  console.log('   This action cannot be undone.');
  
  // Prompt for confirmation
  const confirmation = prompt('\n❓ Do you want to delete these repositories? (y/N): ');
  
  if (!confirmation || confirmation.toLowerCase() !== 'y') {
    console.log('❌ Operation cancelled.');
    return false;
  }

  // Double confirmation for safety
  const doubleConfirmation = prompt('❓ Are you absolutely sure? Type "DELETE" to confirm: ');
  
  if (doubleConfirmation !== 'DELETE') {
    console.log('❌ Operation cancelled.');
    return false;
  }

  return true;
}

async function deleteRepository(repo: Repository): Promise<boolean> {
  try {
    console.log(`🗑️  Deleting ${repo.full_name}...`);
    
    const result = await $`gh repo delete ${repo.full_name} --yes`.nothrow();
    
    if (result.exitCode === 0) {
      console.log(`✅ Successfully deleted ${repo.full_name}`);
      return true;
    } else {
      const errorMessage = result.stderr.toString();
      
      if (errorMessage.includes('delete_repo')) {
        console.log(`❌ Failed to delete ${repo.full_name}: Missing delete_repo scope`);
        console.log(`   Run: gh auth refresh -h github.com -s delete_repo`);
        console.log(`   Then re-run this cleanup script`);
      } else if (errorMessage.includes('admin rights')) {
        console.log(`❌ Failed to delete ${repo.full_name}: Insufficient permissions`);
        console.log(`   You may need to be an admin of this repository`);
      } else {
        console.log(`❌ Failed to delete ${repo.full_name}: ${errorMessage}`);
      }
      return false;
    }
  } catch (error) {
    console.log(`❌ Error deleting ${repo.full_name}: ${error}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log('🧹 Claude Was Here - Test Repository Cleanup');
  console.log('=' + '='.repeat(50));

  // Check if GitHub CLI is available
  const ghAvailable = await isGhCliAvailable();
  if (!ghAvailable) {
    console.error('❌ GitHub CLI not available or not authenticated.');
    console.error('   Please install and authenticate: gh auth login');
    process.exit(1);
  }

  try {
    // Get test repositories
    console.log('🔍 Searching for test repositories...');
    const testRepos = await getTestRepositories();
    
    // Confirm deletion
    const shouldDelete = await confirmDeletion(testRepos);
    if (!shouldDelete) {
      process.exit(0);
    }

    // Delete repositories
    console.log('\n🗑️  Starting deletion process...');
    let deletedCount = 0;
    let failedCount = 0;

    for (const repo of testRepos) {
      const success = await deleteRepository(repo);
      if (success) {
        deletedCount++;
      } else {
        failedCount++;
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n📊 Cleanup Summary:');
    console.log(`✅ Successfully deleted: ${deletedCount} repositories`);
    if (failedCount > 0) {
      console.log(`❌ Failed to delete: ${failedCount} repositories`);
      console.log('\n💡 If you encountered permission errors:');
      console.log('   1. Run: gh auth refresh -h github.com -s delete_repo');
      console.log('   2. Re-run: bun run test:cleanup');
    }
    
    if (deletedCount > 0) {
      console.log('🎉 Cleanup completed!');
    } else if (failedCount === 0) {
      console.log('✅ No repositories needed cleanup.');
    }

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.main) {
  main().catch(console.error);
}