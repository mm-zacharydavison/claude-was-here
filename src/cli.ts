#!/usr/bin/env bun
import { Command } from 'commander';
import { installClaudeHooks } from './commands/install-claude-hooks.ts';
import { installGitHooks } from './commands/install-git-hooks.ts';
import { installBinary } from './commands/install-binary.ts';
import { trackChanges } from './commands/track-changes.ts';
import { preCommitHook } from './commands/pre-commit.ts';
import { postCommitHook } from './commands/post-commit.ts';
import { showStats } from './commands/stats.ts';

const program = new Command();

program
  .name('claude-was-here')
  .description('Track lines changed by Claude Code using git hooks and git notes')
  .version('1.0.0');

const initAction = async () => {
  console.log('🤖 claude-was-here - Initialization');
  console.log('=' + '='.repeat(40));
  
  try {
    await installBinary();
    await installClaudeHooks();
    await installGitHooks();
    
    console.log('\n🎉 Initialization completed successfully!');
    console.log('\nWhat was installed:');
    console.log('📁 ~/.local/bin/claude-was-here - Binary installed to PATH');
    console.log('📁 .claude/settings.json - Claude Code hook configuration');
    console.log('📁 .git/hooks/pre-commit - Consolidates metadata before commits');
    console.log('📁 .git/hooks/post-commit - Stores structured data in git notes');
    console.log('📁 .claude/was-here/ - Directory for temporary metadata');
    console.log('\n🚀 The system is now ready to track Claude Code changes!');
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  }
};

program
  .command('init')
  .description('Initialize claude-was-here by installing hooks and configuration')
  .action(initAction);

program
  .command('install-claude-hooks')
  .description('Install only Claude Code hooks')
  .action(async () => {
    try {
      await installClaudeHooks();
      console.log('✅ Claude Code hooks installed');
    } catch (error) {
      console.error('❌ Failed to install Claude hooks:', error);
      process.exit(1);
    }
  });

program
  .command('install-git-hooks')
  .description('Install only git hooks')
  .action(async () => {
    try {
      await installGitHooks();
      console.log('✅ Git hooks installed');
    } catch (error) {
      console.error('❌ Failed to install git hooks:', error);
      process.exit(1);
    }
  });

// Internal commands used by hooks
program
  .command('track-changes')
  .description('Internal: Track file changes (used by Claude Code hook)')
  .action(async () => {
    await trackChanges();
  });

program
  .command('pre-commit')
  .description('Internal: Pre-commit hook logic')
  .action(async () => {
    await preCommitHook();
  });

program
  .command('post-commit')
  .description('Internal: Post-commit hook logic')
  .action(async () => {
    await postCommitHook();
  });

program
  .command('stats')
  .description('Show statistics about Claude Code contributions')
  .option('--since <period>', 'Time period to analyze (e.g., "1 week", "2 months", "1 year")', '1 week')
  .action(async (options) => {
    await showStats(options);
  });

program.parse();