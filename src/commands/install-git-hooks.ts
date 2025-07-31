import { join } from 'path';
import { readFile } from 'fs/promises';
import { ensureDirectory, writeExecutableFile, getGitHooksDir, fileExists } from '../utils/files.ts';
import { checkGitRepo } from '../utils/git.ts';

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
  
  console.log('✅ Git hooks installed');
}