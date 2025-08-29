import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

export const execGitCommand = (args: string[]): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());
    
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Git command failed: ${stderr}`));
    });
  });
};

export async function checkGitRepo(): Promise<boolean> {
  try {
    // Check if .git directory exists
    const gitDir = join(process.cwd(), '.git');
    return existsSync(gitDir);
  } catch {
    return false;
  }
}

export async function getCurrentCommitHash(): Promise<string> {
  return await execGitCommand(['rev-parse', 'HEAD']);
}

export async function addGitNote(commitHash: string, note: string, notesRef: string = 'claude-was-here'): Promise<void> {
  await execGitCommand(['notes', '--ref', notesRef, 'add', '-m', note, commitHash]);
}

export async function getGitNote(commitHash: string, notesRef: string = 'claude-was-here'): Promise<string | null> {
  try {
    return await execGitCommand(['notes', '--ref', notesRef, 'show', commitHash]);
  } catch {
    return null;
  }
}

export async function removeGitNote(commitHash: string, notesRef: string = 'claude-was-here'): Promise<void> {
  try {
    await execGitCommand(['notes', '--ref', notesRef, 'remove', commitHash]);
  } catch {
    // Note doesn't exist, ignore
  }
}