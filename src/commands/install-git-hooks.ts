import { join } from 'path';
import { readFile } from 'fs/promises';
import { ensureDirectory, writeExecutableFile, getGitHooksDir, fileExists } from '../utils/files.ts';
import { checkGitRepo, execGitCommandWithResult } from '../utils/git.ts';

async function installHookWithPreservation(hookPath: string, claudeHookCommand: string): Promise<void> {
  let finalContent: string;
  
  if (await fileExists(hookPath)) {
    // Read existing hook content
    const existingContent = await readFile(hookPath, 'utf-8');
    
    // Check if claude-was-here is already installed
    if (existingContent.includes(claudeHookCommand)) {
      console.log(`⚠️  Claude hook already present in ${hookPath.split('/').pop()}`);
      return;
    }
    
    // Preserve existing hook and append claude-was-here
    finalContent = existingContent.trimEnd() + `\n\n# Added by claude-was-here\n${claudeHookCommand}\n`;
  } else {
    // Create new hook with shebang
    finalContent = `#!/bin/bash\n${claudeHookCommand}\n`;
  }
  
  await writeExecutableFile(hookPath, finalContent);
}

async function configureGitPushForNotes(): Promise<void> {
  console.log('⚙️  Configuring git to auto-push notes...');
  
  try {
    // Check if push refspecs are already configured
    const { stdout: pushRefspecs } = await execGitCommandWithResult(['config', '--get-all', 'remote.origin.push']);
    const currentPushRefspecs = pushRefspecs ? pushRefspecs.split('\n').filter(line => line.trim()) : [];
    
    // Check if fetch refspecs are already configured
    const { stdout: fetchRefspecs } = await execGitCommandWithResult(['config', '--get-all', 'remote.origin.fetch']);
    const currentFetchRefspecs = fetchRefspecs ? fetchRefspecs.split('\n').filter(line => line.trim()) : [];
    
    // Check if notes refspec is already present
    const notesRefspec = '+refs/notes/commits:refs/notes/commits';
    const pushAlreadyConfigured = currentPushRefspecs.includes(notesRefspec);
    const fetchAlreadyConfigured = currentFetchRefspecs.includes(notesRefspec);
    
    if (pushAlreadyConfigured && fetchAlreadyConfigured) {
      console.log('✅ Git notes auto-push and auto-fetch already configured');
      return;
    }
    
    // If no push refspecs are configured, set up the standard ones
    if (currentPushRefspecs.length === 0) {
      await execGitCommandWithResult(['config', 'remote.origin.push', '+refs/heads/*:refs/heads/*']);
    }
    
    // Add the notes refspec for pushing if not already configured
    if (!pushAlreadyConfigured) {
      await execGitCommandWithResult(['config', '--add', 'remote.origin.push', notesRefspec]);
    }
    
    // Configure automatic fetching of notes if not already configured
    if (!fetchAlreadyConfigured) {
      await execGitCommandWithResult(['config', '--add', 'remote.origin.fetch', notesRefspec]);
    }
    
    console.log('✅ Git configured to auto-push and auto-fetch notes');
    
  } catch (error) {
    // If git config fails (e.g., no remote named origin), warn but don't fail
    console.log('⚠️  Could not configure automatic notes push/fetch (no origin remote?)');
  }
}

export async function installGitHooks(): Promise<void> {
  console.log('📦 Installing git hooks...');
  
  if (!(await checkGitRepo())) {
    throw new Error('Not in a git repository. Run "git init" first.');
  }
  
  const gitHooksDir = getGitHooksDir();
  await ensureDirectory(gitHooksDir);
  
  // Install pre-commit hook
  const preCommitHook = join(gitHooksDir, 'pre-commit');
  await installHookWithPreservation(preCommitHook, 'claude-was-here pre-commit');
  
  // Install post-commit hook
  const postCommitHook = join(gitHooksDir, 'post-commit');
  await installHookWithPreservation(postCommitHook, 'claude-was-here post-commit');
  
  // Configure git to automatically push notes
  await configureGitPushForNotes();
  
  console.log('✅ Git hooks installed');
}