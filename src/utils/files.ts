import { mkdir, writeFile, chmod, access } from 'fs/promises';
import { join } from 'path';

export async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

export async function writeExecutableFile(path: string, content: string): Promise<void> {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function getClaudeWasHereDir(): string {
  return join(process.cwd(), '.claude', 'was-here');
}

export function getClaudeCacheDir(): string {
  return join(process.cwd(), '.claude', 'was-here', 'cache');
}

export function getClaudeHooksDir(): string {
  return join(process.cwd(), '.claude', 'hooks');
}

export function getGitHooksDir(): string {
  return join(process.cwd(), '.git', 'hooks');
}