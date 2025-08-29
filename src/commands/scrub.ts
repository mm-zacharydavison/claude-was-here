import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Prompt user for confirmation with yes/no question
 */
async function promptForConfirmation(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    rl.question(message + ' (y/N): ', (answer: string) => {
      rl.close();
      const input = answer.toLowerCase().trim();
      resolve(input === 'y' || input === 'yes');
    });
  });
}

/**
 * Scrub all claude-was-here notes data from the repository
 */
export async function scrubClaudeData(skipConfirmation: boolean = false): Promise<void> {
  // Check if we're in a git repository
  if (!existsSync(join(process.cwd(), '.git'))) {
    throw new Error('Not in a git repository. Please run this command from the root of your git repository.');
  }

  // Check if claude-was-here notes exist
  const hasNotes = checkForClaudeNotes();
  
  if (!hasNotes) {
    console.log('✅ No claude-was-here notes found in repository.');
    return;
  }

  // Show warning and ask for confirmation
  if (!skipConfirmation) {
    console.log('⚠️  This will permanently remove all claude-was-here data from your repository:');
    console.log('   • All claude-was-here git notes will be deleted');
    console.log('   • Tracking data directory will be removed');
    console.log('   • This action cannot be undone');
    console.log();
    
    const confirmed = await promptForConfirmation('Are you sure you want to continue?');
    
    if (!confirmed) {
      console.log('❌ Operation cancelled by user.');
      return;
    }
  }

  console.log('🧹 Scrubbing all claude-was-here data from repository...');
  
  try {

    // Remove all claude-was-here git notes
    console.log('🗑️  Removing claude-was-here git notes...');
    removeClaudeNotes();
    
    // Remove tracking data directory if it exists
    const trackingDir = join(process.cwd(), '.claude', 'was-here');
    if (existsSync(trackingDir)) {
      console.log('🗑️  Removing tracking data directory...');
      execSync(`rm -rf "${trackingDir}"`, { stdio: 'inherit' });
    }
    
    console.log('✅ Successfully scrubbed all claude-was-here data from repository.');
    console.log('\n📝 Note: This operation:');
    console.log('   • Removed all claude-was-here git notes from commits');
    console.log('   • Removed temporary tracking data directory');
    console.log('   • Did NOT remove git hooks or GitHub Actions workflows');
    console.log('\n💡 To completely remove claude-was-here:');
    console.log('   • Manually remove git hooks from .git/hooks/');
    console.log('   • Manually remove GitHub Actions workflows from .github/workflows/');
    
  } catch (error) {
    console.error('❌ Error scrubbing claude-was-here data:', error instanceof Error ? error.message : error);
    throw error;
  }
}

/**
 * Check if any claude-was-here notes exist in the repository
 */
function checkForClaudeNotes(): boolean {
  try {
    // List all commits that have notes
    const result = execSync('git notes list', { encoding: 'utf-8', stdio: 'pipe' });
    
    if (!result.trim()) {
      return false; // No notes at all
    }
    
    // Check each commit with notes to see if any contain claude-was-here data
    const noteCommits = result.trim().split('\n');
    
    for (const line of noteCommits) {
      const [, commitHash] = line.split(' ');
      if (commitHash) {
        try {
          const noteContent = execSync(`git notes show "${commitHash}"`, { encoding: 'utf-8', stdio: 'pipe' });
          if (noteContent.includes('claude-was-here')) {
            return true;
          }
        } catch {
          // Continue if we can't read a specific note
          continue;
        }
      }
    }
    
    return false;
  } catch {
    // If git notes list fails, assume no notes exist
    return false;
  }
}

/**
 * Remove all claude-was-here git notes from the repository
 */
function removeClaudeNotes(): void {
  try {
    // List all commits that have notes
    const result = execSync('git notes list', { encoding: 'utf-8', stdio: 'pipe' });
    
    if (!result.trim()) {
      return; // No notes to remove
    }
    
    const noteCommits = result.trim().split('\n');
    let removedCount = 0;
    
    for (const line of noteCommits) {
      const [, commitHash] = line.split(' ');
      if (commitHash) {
        try {
          const noteContent = execSync(`git notes show "${commitHash}"`, { encoding: 'utf-8', stdio: 'pipe' });
          
          // Only remove notes that contain claude-was-here data
          if (noteContent.includes('claude-was-here')) {
            execSync(`git notes remove "${commitHash}"`, { stdio: 'pipe' });
            removedCount++;
            console.log(`   Removed note from commit ${commitHash.substring(0, 8)}`);
          }
        } catch {
          // Continue if we can't read or remove a specific note
          continue;
        }
      }
    }
    
    if (removedCount > 0) {
      console.log(`   Removed ${removedCount} claude-was-here notes`);
      
      // Push the removal to remote if notes ref exists
      try {
        execSync('git push origin :refs/notes/commits', { stdio: 'pipe' });
        console.log('   Pushed note removals to remote repository');
      } catch {
        console.log('   ⚠️  Could not push note removals to remote (you may need to push manually)');
      }
    }
    
  } catch (error) {
    throw new Error(`Failed to remove claude-was-here notes: ${error instanceof Error ? error.message : error}`);
  }
}