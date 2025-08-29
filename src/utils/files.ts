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

// TODO: Define new tracking directories

export function getClaudeHooksDir(): string {
  return join(process.cwd(), '.claude', 'hooks');
}

export function getGitHooksDir(): string {
  return join(process.cwd(), '.git', 'hooks');
}