import { logger } from '../utils/logger.ts';

/**
 * Pre-push hook that pushes git notes to remote when pushing commits
 * This ensures notes are only pushed when commits are actually shared
 */
export async function prePushHook(): Promise<void> {
  try {
    // Push the notes to remote
    const { spawn } = require('child_process');
    const pushProc = spawn('git', ['push', '--no-verify', 'origin', 'refs/notes/commits'], { 
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false 
    });
    
    let pushOutput = '';
    let pushError = '';
    pushProc.stdout?.on('data', (data) => pushOutput += data.toString());
    pushProc.stderr?.on('data', (data) => pushError += data.toString());
    
    await new Promise((resolve) => {
      pushProc.on('close', (code) => {
        if (code === 0) {
          logger.log('[claude-was-here] 📤 Pushed git notes to remote.');
        } else {
          logger.warn(`[claude-was-here] ⚠️ Could not push git notes: ${pushError}`);
        }
        resolve(undefined);
      });
    });
  } catch (error) {
    logger.warn('[claude-was-here] ⚠️ Could not push git notes to remote:', error);
  }
}