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

// TODO: Implement new git integration functions