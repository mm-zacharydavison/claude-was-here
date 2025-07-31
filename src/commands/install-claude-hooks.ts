import { writeFile } from 'fs/promises';
import { join } from 'path';
import { ensureDirectory, getClaudeHooksDir } from '../utils/files.ts';

export async function installClaudeHooks(): Promise<void> {
  console.log('📦 Installing Claude Code hooks...');
  
  // Create .claude directory structure
  const claudeDir = join(process.cwd(), '.claude');
  const hooksDir = getClaudeHooksDir();
  const wasHereDir = join(claudeDir, 'was-here');
  
  await ensureDirectory(claudeDir);
  await ensureDirectory(hooksDir);
  await ensureDirectory(wasHereDir);
  
  // Create Claude Code settings.json
  const settingsFile = join(claudeDir, 'settings.json');
  const settings = {
    hooks: {
      PostToolUse: [
        {
          matcher: "(Edit|MultiEdit|Write)",
          hooks: [
            {
              type: "command",
              command: "claude-was-here track-changes"
            }
          ]
        }
      ]
    }
  };
  
  await writeFile(settingsFile, JSON.stringify(settings, null, 2));
  
  console.log('✅ Claude Code hooks installed');
}