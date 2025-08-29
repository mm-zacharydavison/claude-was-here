#!/usr/bin/env bun
/**
 * Standalone script for GitHub Actions to collect Claude notes from PR commits
 * This gets bundled and copied to .github/scripts/ when running install-github-actions
 */

import { githubSynchronizePR } from '../commands/github-actions.ts';

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--base' || args[2] !== '--head') {
  console.error('Usage: github-synchronize-pr --base <commit> --head <commit>');
  process.exit(1);
}

const baseCommit = args[1];
const headCommit = args[3];

// Run the command
githubSynchronizePR(baseCommit, headCommit).catch((error) => {
  console.error('Failed:', error);
  process.exit(1);
});